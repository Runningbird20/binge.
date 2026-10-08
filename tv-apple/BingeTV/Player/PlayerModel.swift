import Foundation
import SwiftUI

struct PlayRequest: Identifiable {
    let id = UUID()
    let title: Title
    var season: Int?
    var episode: Int?
    var startAt: Double?
    // Episode counts per season, for Up Next.
    var seasons: [TMDBDetails.Season] = []
}

// Drives the server's own player page from the Siri remote. The <video> is
// in the page's top level for every server in StreamServer.all, so play,
// pause, seek and progress all go through one small script.
@MainActor
final class PlayerModel: ObservableObject {
    struct Playback: Decodable, Equatable {
        var t: Double = 0
        var d: Double = 0
        var paused = true
        var ended = false
        var video = false
    }

    @Published private(set) var request: PlayRequest
    @Published private(set) var server: StreamServer
    @Published private(set) var playback = Playback()
    @Published private(set) var started = false
    @Published var notice: String?
    @Published var hudVisible = true
    @Published var upNextCountdown: Int?

    let servers: [StreamServer]
    private(set) var web: LegacyWebView?
    private weak var app: AppModel?
    private var manualServer = false
    private var failed = Set<String>()
    private var loadStarted = Date()
    private var startApplied = false
    private var lastSaved = Date.distantPast
    private var lastProgressAt = Date()
    private var lastTime: Double = 0
    private var lastKick = Date.distantPast
    private var timer: Timer?
    private var hudHideAt = Date().addingTimeInterval(5)

    static let failoverSeconds: TimeInterval = 45

    init(request: PlayRequest, app: AppModel) {
        self.request = request
        self.app = app
        servers = StreamServer.ranked(for: request.title)
        server = servers[0]
    }

    var isEpisode: Bool { request.title.kind == .tvShow }
    var episodeLabel: String? {
        guard isEpisode, let s = request.season, let e = request.episode else { return nil }
        return "S\(s):E\(e)"
    }

    // MARK: Lifecycle

    func attach() -> UIView {
        if let web { return web.view }
        let fresh = LegacyWebView(allowedHost: nil)
        web = fresh
        loadCurrent()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        if isEpisode, request.seasons.isEmpty, let tmdbId = request.title.tmdbId {
            Task {
                let details: TMDBDetails? = try? await TMDB.shared.get("tv/\(tmdbId)")
                request.seasons = (details?.seasons ?? []).filter { $0.seasonNumber > 0 }
            }
        }
        return fresh?.view ?? UIView()
    }

    func close() {
        timer?.invalidate()
        timer = nil
        saveProgress(force: true)
        web?.run("var v=document.querySelector('video'); if(v){v.pause()}")
    }

    private func loadCurrent() {
        guard let tmdbId = request.title.tmdbId else {
            notice = "This title has no streaming id yet."
            return
        }
        let url = server.build(tmdbId, request.title.kind, request.season ?? 1, request.episode ?? 1)
        web?.setAllowedHost(url.host)
        web?.load(url)
        loadStarted = Date()
        started = false
        startApplied = false
        lastTime = 0
        playback = Playback()
        showHUD()
    }

    // MARK: Remote

    func togglePlay() {
        if let countdown = upNextCountdown, countdown >= 0 { playNext(); return }
        web?.run("var v=document.querySelector('video'); if(v){ if(v.paused){v.play()} else {v.pause()} }")
        showHUD()
    }

    func seek(by seconds: Double) {
        web?.run("var v=document.querySelector('video'); if(v){ v.currentTime=Math.max(0, Math.min((v.duration||1e9)-1, v.currentTime+(\(seconds)))) }")
        showHUD()
    }

    func showHUD() {
        hudVisible = true
        hudHideAt = Date().addingTimeInterval(4)
    }

    func choose(_ next: StreamServer) {
        manualServer = true
        server = next
        notice = nil
        loadCurrent()
    }

    func play(season: Int, episode: Int) {
        saveProgress(force: true)
        request.season = season
        request.episode = episode
        request.startAt = nil
        upNextCountdown = nil
        manualServer = false
        failed = []
        loadCurrent()
    }

    // MARK: Polling

    private static let probe = """
    (function(){var v=document.querySelector('video');if(!v)return JSON.stringify({video:false});
    return JSON.stringify({video:true,t:v.currentTime||0,d:isFinite(v.duration)?v.duration:0,paused:v.paused,ended:v.ended})})()
    """

    private func tick() {
        guard let json = web?.run(Self.probe), let data = json.data(using: .utf8),
              let state = try? JSONDecoder().decode(Playback.self, from: data) else { return }
        playback = state

        if state.t > lastTime + 0.2 {
            lastProgressAt = Date()
            if !started, state.t > 1 {
                started = true
                notice = nil
                StreamServer.rememberWorking(server, for: request.title)
            }
        }
        lastTime = state.t

        // Some servers wait for a click before playing; we allow autoplay,
        // so start it once the video has loaded.
        if !started, state.video, state.paused, state.d > 0, Date().timeIntervalSince(lastKick) > 3 {
            lastKick = Date()
            web?.run("var v=document.querySelector('video'); if(v){var p=v.play(); if(p&&p.catch){p.catch(function(){})}}")
        }

        // Resume: jump once to the saved second when the video is ready.
        if !startApplied, state.video, state.d > 0, let start = request.startAt, start > 30, start < state.d - 60 {
            startApplied = true
            web?.run("var v=document.querySelector('video'); if(v){v.currentTime=\(Int(start))}")
        }

        // Automatic failover while nothing has played yet (never for a
        // server the viewer picked by hand).
        if !started, !manualServer, Date().timeIntervalSince(loadStarted) > Self.failoverSeconds {
            failed.insert(server.id)
            if let next = servers.first(where: { !failed.contains($0.id) }) {
                notice = "\(server.name) didn't start, trying \(next.name)…"
                server = next
                loadCurrent()
            } else {
                notice = "No server could play this right now. Swipe down to try one again."
                manualServer = true
            }
            return
        }

        if hudVisible, Date() > hudHideAt, !state.paused { hudVisible = false }
        if state.paused, started { hudVisible = true }

        handleUpNext(state)
        saveProgress(force: false)
    }

    // MARK: Up Next

    var nextEpisode: (season: Int, episode: Int)? {
        guard isEpisode, let s = request.season, let e = request.episode else { return nil }
        if let count = request.seasons.first(where: { $0.seasonNumber == s })?.episodeCount, e < count { return (s, e + 1) }
        if request.seasons.contains(where: { $0.seasonNumber == s + 1 && ($0.episodeCount ?? 0) > 0 }) { return (s + 1, 1) }
        return nil
    }

    private func handleUpNext(_ state: Playback) {
        guard nextEpisode != nil, started, state.d > 120 else { return }
        let remaining = state.d - state.t
        if state.ended || remaining < 25 {
            let value = upNextCountdown ?? 10
            if upNextCountdown == nil { upNextCountdown = value } else if value > 0 { upNextCountdown = value - 1 }
            if upNextCountdown == 0 { playNext() }
        }
    }

    func cancelUpNext() { upNextCountdown = -1 }

    func playNext() {
        guard let next = nextEpisode else { return }
        play(season: next.season, episode: next.episode)
    }

    // MARK: Progress (synced to continue_watching, like the site)

    private func saveProgress(force: Bool) {
        guard let app, started, playback.d > 0 else { return }
        guard force || Date().timeIntervalSince(lastSaved) > 30 else { return }
        lastSaved = Date()
        let request = self.request
        let position = playback.t, duration = playback.d
        Task { await app.saveProgress(title: request.title, season: request.season, episode: request.episode,
                                      position: position, duration: duration) }
    }
}
