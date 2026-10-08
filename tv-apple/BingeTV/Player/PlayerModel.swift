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
// pause, seek and progress all go through one small script. Which server
// plays is decided by a StreamRace (all servers at once, first to play wins).
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
    @Published private(set) var server: StreamServer?
    @Published private(set) var playback = Playback()
    @Published private(set) var started = false
    @Published private(set) var racingNames = ""
    @Published var notice: String?
    @Published var hudVisible = true
    @Published var upNextCountdown: Int?

    let servers = StreamServer.all
    let surface = UIView()
    private var race: StreamRace?
    private weak var app: AppModel?
    private var timer: Timer?
    private var hudHideAt = Date().addingTimeInterval(5)
    private var lastSaved = Date.distantPast
    private var warmedNext = false
    private var openedAt = Date()
    private var userPaused = false

    init(request: PlayRequest, app: AppModel) {
        self.request = request
        self.app = app
        surface.backgroundColor = .black
        if let warm = Warmup.shared.take(request) {
            adopt(warm)
        } else {
            startRace(StreamServer.ranked(for: request.title))
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        if isEpisode, request.seasons.isEmpty, let tmdbId = request.title.tmdbId {
            Task {
                let details: TMDBDetails? = try? await TMDB.shared.get("tv/\(tmdbId)")
                self.request.seasons = (details?.seasons ?? []).filter { $0.seasonNumber > 0 }
            }
        }
    }

    var isEpisode: Bool { request.title.kind == .tvShow }
    var episodeLabel: String? {
        guard isEpisode, let s = request.season, let e = request.episode else { return nil }
        return "S\(s):E\(e)"
    }
    private var web: WebEngine? { race?.winner?.web }

    // MARK: Races

    private func startRace(_ list: [StreamServer]) {
        adopt(StreamRace(request: request, servers: list, mode: .live))
    }

    private func adopt(_ next: StreamRace) {
        race?.stop()
        race?.container.removeFromSuperview()
        race = next
        next.container.frame = surface.bounds
        next.container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        surface.addSubview(next.container)
        next.onChange = { [weak self] in self?.raceChanged() }
        racingNames = next.candidates.map(\.server.name).joined(separator: ", ")
        started = false
        warmedNext = false
        playback = Playback()
        next.goLive()
        raceChanged()
        showHUD()
    }

    private func raceChanged() {
        guard let race else { return }
        if let winner = race.winner {
            server = winner.server
            notice = nil
        } else if race.failed {
            notice = "No server could play this right now. Swipe down to try one again."
        }
    }

    func close() {
        timer?.invalidate()
        timer = nil
        saveProgress(force: true)
        race?.stop()
        race = nil
        Warmup.shared.cancel()
    }

    // MARK: Remote

    func togglePlay() {
        if let countdown = upNextCountdown, countdown >= 0 { playNext(); return }
        userPaused = !playback.paused
        web?.evaluate("var v=document.querySelector('video'); if(v){ if(v.paused){v.play()} else {v.pause()} }", nil)
        showHUD()
    }

    func seek(by seconds: Double) {
        guard let web, web.canSeek else {
            notice = "Skipping isn't available on this Apple TV."
            showHUD()
            return
        }
        web.evaluate("var v=document.querySelector('video'); if(v){ v.currentTime=Math.max(0, Math.min((v.duration||1e9)-1, v.currentTime+(\(seconds)))) }", nil)
        playback.t = max(0, playback.t + seconds) // instant HUD feedback
        showHUD()
    }

    func showHUD() {
        hudVisible = true
        hudHideAt = Date().addingTimeInterval(4)
    }

    // A hand-picked server plays alone, from where you were.
    func choose(_ next: StreamServer) {
        saveProgress(force: true)
        if playback.t > 30 { request.startAt = playback.t }
        notice = nil
        startRace([next])
    }

    func play(season: Int, episode: Int) {
        saveProgress(force: true)
        request.season = season
        request.episode = episode
        request.startAt = nil
        upNextCountdown = nil
        openedAt = Date()
        if let warm = Warmup.shared.take(request) {
            adopt(warm)
        } else {
            startRace(StreamServer.ranked(for: request.title))
        }
    }

    // MARK: Polling

    private static let probe = """
    (function(){var v=document.querySelector('video');if(!v)return JSON.stringify({video:false});
    return JSON.stringify({video:true,t:v.currentTime||0,d:isFinite(v.duration)?v.duration:0,paused:v.paused,ended:v.ended})})()
    """

    private var polling = false

    private func tick() {
        guard let web, !polling else { return }
        polling = true
        web.evaluate(Self.probe) { [weak self] json in
            guard let self else { return }
            self.polling = false
            guard let data = json?.data(using: .utf8),
                  let state = try? JSONDecoder().decode(Playback.self, from: data) else { return }
            self.apply(state, web: web)
        }
    }

    private func apply(_ state: Playback, web: WebEngine) {
        playback = state
        // A handed-over warm race is paused on its first frame; keep asking
        // it to play until the clock moves (unmuting can pause it again).
        if !started, state.video, state.paused, !userPaused {
            web.evaluate("var v=document.querySelector('video'); if(v){v.muted=false; var p=v.play(); if(p&&p.catch)p.catch(function(){})}", nil)
        }
        if !started, state.t > 0.4, !state.paused {
            started = true
            #if DEBUG
            print("[player] playing \(String(format: "%.1f", Date().timeIntervalSince(openedAt)))s after Play")
            #endif
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
        guard let next = nextEpisode, started, state.d > 120 else { return }
        let remaining = state.d - state.t
        // Load the next episode in the background so it starts instantly.
        if remaining < 90, !warmedNext {
            warmedNext = true
            Warmup.shared.prepare(PlayRequest(title: request.title, season: next.season, episode: next.episode,
                                              seasons: request.seasons))
        }
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
