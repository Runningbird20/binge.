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
    // Live sports: the streams to race instead of the movie servers.
    var liveStreams: [StreamServer] = []
    var subtitle: String?
    var game: SportGame?

    var isLive: Bool { !liveStreams.isEmpty }
}

// Drives the server's own player page from the Siri remote. The <video> is
// in the page's top level for every server in StreamServer.all, so play,
// pause, seek and progress all go through one small script. Which server
// plays is decided by a StreamRace (all servers at once, first to play wins).
@MainActor
final class PlayerModel: ObservableObject {
    typealias Playback = MediaState

    @Published private(set) var request: PlayRequest
    @Published private(set) var server: StreamServer?
    @Published private(set) var playback = Playback()
    @Published private(set) var started = false
    @Published private(set) var racingNames = ""
    @Published var notice: String?
    @Published var hudVisible = true
    @Published var upNextCountdown: Int?
    @Published private(set) var showSkipIntro = false
    @Published private(set) var stillWatching = false
    @Published var sleep: SleepOption = .off {
        didSet { sleepAt = sleep.minutes.map { Date().addingTimeInterval(Double($0) * 60) } }
    }

    enum SleepOption: String, CaseIterable, Identifiable {
        case off = "Off", fifteen = "15 min", thirty = "30 min", hour = "1 hour", episode = "End of episode"
        var id: String { rawValue }
        var minutes: Int? { switch self { case .fifteen: 15; case .thirty: 30; case .hour: 60; default: nil } }
    }

    private var sleepAt: Date?
    private var lastFill = Date.distantPast
    // Picture: fill the screen (default) or keep the server's own layout.
    @Published var fillScreen = UserDefaults.standard.object(forKey: "binge.fillScreen") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(fillScreen, forKey: "binge.fillScreen")
            web?.send(fillScreen ? .fill : .unfill)
        }
    }
    private var skippedIntro = false
    private var markedWatched = false
    // Episodes that started on their own with nobody touching the remote.
    private var autoAdvances = 0

    var servers: [StreamServer] { request.isLive ? request.liveStreams : StreamServer.all }
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
        PiPController.shared.playerOpened()
        if let warm = Warmup.shared.take(request) {
            adopt(warm)
        } else {
            if request.isLive { startRace(request.liveStreams) } else { startPlannedRace() }
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
        if let subtitle = request.subtitle { return subtitle }
        guard isEpisode, let s = request.season, let e = request.episode else { return nil }
        return "S\(s):E\(e)"
    }
    private var web: WebEngine? { race?.winner?.web }

    // MARK: Races

    // Admin switches + audio preference decide which servers race.
    private func startPlannedRace() {
        let planned = request
        racingNames = ""
        Task {
            let servers = await ServerPlan.servers(for: planned.title, originalLanguage: planned.title.originalLanguage)
            guard StreamRace.key(for: planned) == StreamRace.key(for: self.request) else { return }
            self.startRace(servers.isEmpty ? StreamServer.all : servers)
        }
    }

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

    private var closed = false

    func close() {
        guard !closed else { return }
        closed = true
        PiPController.shared.playerClosed()
        timer?.invalidate()
        timer = nil
        saveProgress(force: true)
        race?.stop()
        race = nil
        Warmup.shared.cancel()
    }

    // MARK: Remote

    func togglePlay() {
        autoAdvances = 0
        if stillWatching {
            stillWatching = false
            playNext()
            return
        }
        if let countdown = upNextCountdown, countdown >= 0 { playNext(); return }
        userPaused = !playback.paused
        web?.send(.toggle)
        showHUD()
    }

    // ▲ during the first minutes of an episode.
    func skipIntro() {
        skippedIntro = true
        showSkipIntro = false
        seek(by: 85)
    }

    func seek(by seconds: Double) {
        autoAdvances = 0
        guard let web, web.canSeek, !request.isLive else {
            notice = request.isLive ? "This is live — skipping isn't available." : "Skipping isn't available on this Apple TV."
            showHUD()
            return
        }
        web.send(.seekBy(seconds))
        playback.t = max(0, playback.t + seconds) // instant HUD feedback
        showHUD()
    }

    func showHUD() {
        hudVisible = true
        hudHideAt = Date().addingTimeInterval(4)
    }

    // Switch this player to a live game (from a game alert).
    func switchToLive(_ game: SportGame) async {
        let servers = await SportsFeed.servers(for: game)
        guard !servers.isEmpty else { notice = "Couldn't find a stream for \(game.title)."; return }
        saveProgress(force: true)
        let title = Title(kind: .movie, dbId: 0, name: game.title, year: nil, overview: nil, genre: nil, ageRating: nil)
        request = PlayRequest(title: title, liveStreams: servers, subtitle: "LIVE · \(game.league)", game: game)
        upNextCountdown = nil
        stillWatching = false
        startRace(servers)
    }

    // A hand-picked server plays alone, from where you were.
    func choose(_ next: StreamServer) {
        saveProgress(force: true)
        if playback.t > 30 { request.startAt = playback.t }
        notice = nil
        startRace([next])
    }

    func play(season: Int, episode: Int, automatic: Bool = false) {
        saveProgress(force: true)
        autoAdvances = automatic ? autoAdvances + 1 : 0
        skippedIntro = false
        markedWatched = false
        showSkipIntro = false
        request.season = season
        request.episode = episode
        request.startAt = nil
        upNextCountdown = nil
        openedAt = Date()
        if let warm = Warmup.shared.take(request) {
            adopt(warm)
        } else {
            startPlannedRace()
        }
    }

    // MARK: Polling

    private var polling = false

    private func tick() {
        guard let web, !polling else { return }
        polling = true
        web.poll { [weak self] state in
            guard let self else { return }
            self.polling = false
            if let state { self.apply(state, web: web) }
        }
    }

    private func apply(_ state: Playback, web: WebEngine) {
        playback = state
        // A handed-over warm race is paused on its first frame; keep asking
        // it to play until the clock moves (unmuting can pause it again).
        if !started, state.video, state.paused, !userPaused {
            web.send(.unmute)
            web.send(.play)
        }
        if !started, state.t > 0.4, !state.paused {
            started = true
            #if DEBUG
            print("[player] playing \(String(format: "%.1f", Date().timeIntervalSince(openedAt)))s after Play")
            #endif
        }

        if hudVisible, Date() > hudHideAt, !state.paused { hudVisible = false }
        if state.paused, started { hudVisible = true }

        // Keep the video pinned full screen (servers sometimes swap the
        // <video> element when they change quality or source).
        if fillScreen, started, Date().timeIntervalSince(lastFill) > 3 {
            lastFill = Date()
            web.send(.fill)
        }

        showSkipIntro = isEpisode && started && !skippedIntro && state.t > 15 && state.t < 240

        if isEpisode, !markedWatched, state.d > 120, state.t / state.d > 0.9,
           let app, let season = request.season, let episode = request.episode {
            markedWatched = true
            let title = request.title
            Task { await app.markEpisodeWatched(title, season: season, episode: episode) }
        }

        if let sleepAt, Date() > sleepAt {
            self.sleepAt = nil
            sleep = .off
            web.send(.pause)
            notice = "Sleep timer: paused."
            hudVisible = true
        }

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
            // Sleep at the end of this episode, or check someone's still
            // there after 3 episodes in a row with no remote input.
            if sleep == .episode || autoAdvances >= 3 {
                if state.ended || remaining < 2 {
                    if sleep == .episode {
                        sleep = .off
                        notice = "Sleep timer: stopped after this episode."
                    } else {
                        stillWatching = true
                    }
                    web?.send(.pause)
                    upNextCountdown = nil
                }
                return
            }
            let value = upNextCountdown ?? 10
            if upNextCountdown == nil { upNextCountdown = value } else if value > 0 { upNextCountdown = value - 1 }
            if upNextCountdown == 0 { playNext(automatic: true) }
        }
    }

    func cancelUpNext() { upNextCountdown = -1 }

    func playNext(automatic: Bool = false) {
        guard let next = nextEpisode else { return }
        play(season: next.season, episode: next.episode, automatic: automatic)
    }

    // MARK: Progress (synced to continue_watching, like the site)

    private func saveProgress(force: Bool) {
        guard let app, started, playback.d > 0, !request.isLive else { return }
        guard force || Date().timeIntervalSince(lastSaved) > 30 else { return }
        lastSaved = Date()
        let request = self.request
        let position = playback.t, duration = playback.d
        Task { await app.saveProgress(title: request.title, season: request.season, episode: request.episode,
                                      position: position, duration: duration) }
    }
}
