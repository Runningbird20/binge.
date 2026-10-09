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
    // Tracks the server's video actually has, and whether the profile's
    // audio/subtitle preference has been applied to this video yet.
    @Published private(set) var audioTracks: [MediaTrack] = []
    @Published private(set) var textTracks: [MediaTrack] = []
    private var prefsAppliedFor: String?
    private var originalLanguage: String?
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
    // Stall recovery: when the clock last moved / the page last reported.
    @Published private(set) var buffering = false
    private var lastClock: Double = -1
    private var clockMovedAt = Date()
    private var stateAt = Date()
    private var recoveries = 0
    private var handPicked = false
    private var lifecycle: [NSObjectProtocol] = []
    private var lastResume = Date.distantPast
    // Paused a long time: the player shows ambient art (AmbientView).
    @Published var pausedAmbient = false
    private var pausedSince: Date?
    // Servers already raced for this video; ones that haven't raced yet go
    // first when recovering.
    private var raced = Set<String>()
    // Intro/credits markers for this episode, and a viewer's skip in
    // progress (where it started, last seek) so it can be reported.
    @Published private(set) var markers = EpisodeMarkers()
    private var introSeekFrom: Double?
    private var introSeekAt = Date.distantPast
    private var ownIntroSkip = false

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
        Task {
            let language = await OriginalLanguage.of(self.request.title)
            self.originalLanguage = language
        }
        observeLifecycle()
        loadMarkers()
        if isEpisode, request.seasons.isEmpty, let tmdbId = request.title.tmdbId {
            Task {
                let details: TMDBDetails? = try? await TMDB.shared.get("tv/\(tmdbId)")
                self.request.seasons = (details?.seasons ?? []).filter { $0.seasonNumber > 0 }
            }
        }
    }

    var isEpisode: Bool { request.title.kind == .tvShow }

    // What's actually on screen, from the video's own height.
    var resolutionLabel: String? {
        switch playback.height {
        case 2000...: return "4K"
        case 1400..<2000: return "1440p"
        case 1000..<1400: return "1080p"
        case 700..<1000: return "720p"
        case 1..<700: return "SD"
        default: return nil
        }
    }
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
        let fresh = list.filter { !raced.contains($0.id) }
        let ordered = fresh + list.filter { raced.contains($0.id) }
        adopt(StreamRace(request: request, servers: ordered, mode: .live))
    }

    private func adopt(_ next: StreamRace) {
        raced.formUnion(next.candidates.map(\.server.id))
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
        userPaused = false
        playback = Playback()
        buffering = false
        resetStallClock()
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
            // Live: nothing in this race played, but there are backups.
            if request.isLive, !handPicked, recoveries < 3, servers.contains(where: { !raced.contains($0.id) }) {
                recoveries += 1
                notice = "Trying more streams…"
                startRace(servers)
                return
            }
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
        lifecycle.forEach(NotificationCenter.default.removeObserver)
        lifecycle = []
        saveProgress(force: true)
        race?.stop()
        race = nil
        Warmup.shared.cancel()
    }

    // MARK: Remote

    func leaveAmbient() {
        pausedAmbient = false
        pausedSince = Date()
        showHUD()
    }

    func togglePlay() {
        autoAdvances = 0
        pausedAmbient = false
        if stillWatching {
            stillWatching = false
            playNext()
            return
        }
        if let countdown = upNextCountdown, countdown >= 0 { playNext(); return }
        userPaused = !playback.paused
        race?.userPaused = userPaused
        web?.send(.toggle)
        showHUD()
    }

    // MARK: Audio & subtitles (the video's real tracks)

    func selectAudio(_ track: MediaTrack) {
        web?.send(.audioTrack(track.index))
        showHUD()
    }

    func selectSubtitles(_ track: MediaTrack?) {
        web?.send(.textTrack(track?.index ?? -1))
        showHUD()
    }

    // Once per video, as soon as its tracks show up: the profile's saved
    // audio language and subtitle language (set here or on the website).
    private func applyPreferredTracks(_ web: WebEngine) {
        let key = "\(server?.id ?? "")-\(request.season ?? 0)-\(request.episode ?? 0)"
        guard prefsAppliedFor != key, !audioTracks.isEmpty || !textTracks.isEmpty else { return }
        prefsAppliedFor = key
        // "Original language" means the title's own language (Korean for a
        // K-drama), not whatever dub the server starts with.
        if PlaybackPrefs.audio == "original", originalLanguage == nil, request.title.tmdbId != nil, !request.isLive {
            prefsAppliedFor = nil // wait for TMDB to say what the original is
            return
        }
        let audio = PlaybackPrefs.audio == "original" ? (originalLanguage ?? "") : PlaybackPrefs.audio
        #if DEBUG
        print("[tracks] prefs audio=\(PlaybackPrefs.audio) original=\(request.title.originalLanguage ?? "nil") want=\(audio) langs=\(audioTracks.prefix(16).map(\.language))")
        #endif
        // Audio description first, when asked for and the video has one
        // (servers label it "Audio Description", "Descriptive", "AD").
        let describes = { (track: MediaTrack) in
            track.label.range(of: #"descri|\bAD\b"#, options: [.regularExpression, .caseInsensitive]) != nil
        }
        if PlaybackPrefs.audioDescription,
           let match = audioTracks.first(where: { describes($0) && (audio.isEmpty || Self.matches($0, audio)) })
            ?? audioTracks.first(where: describes) {
            if !match.on { web.send(.audioTrack(match.index)) }
        } else if !audio.isEmpty, let match = audioTracks.first(where: { Self.matches($0, audio) && !describes($0) })
                    ?? audioTracks.first(where: { Self.matches($0, audio) }), !match.on {
            web.send(.audioTrack(match.index))
            #if DEBUG
            print("[tracks] audio -> \(Self.displayName(match))")
            #endif
        }
        let subtitles = PlaybackPrefs.subtitle
        if subtitles == "off" {
            if textTracks.contains(where: \.on) { web.send(.textTrack(-1)) }
        } else if let match = textTracks.first(where: { Self.matches($0, subtitles) }), !match.on {
            web.send(.textTrack(match.index))
        }
    }

    static func matches(_ track: MediaTrack, _ code: String) -> Bool {
        let language = track.language.lowercased()
        // Servers use 2-letter (ko) or 3-letter (kor) codes, sometimes with a region.
        if language == code || language.hasPrefix(code + "-") || (language.count == 3 && language.hasPrefix(code)) { return true }
        let name = PlaybackPrefs.languageName(code).lowercased()
        return track.label.lowercased().contains(name)
    }

    static func displayName(_ track: MediaTrack) -> String {
        // "14. Korean" → "Korean"
        let label = track.label.replacingOccurrences(of: #"^\d+\.\s*"#, with: "", options: .regularExpression)
        if !label.isEmpty { return label }
        if !track.language.isEmpty { return PlaybackPrefs.languageName(String(track.language.prefix(2))) }
        return "Track \(track.index + 1)"
    }

    private func loadMarkers() {
        guard isEpisode, let season = request.season, let episode = request.episode else { return }
        let title = request.title
        Task {
            let found = await EpisodeMarkerStore.markers(for: title, season: season, episode: episode)
            guard self.request.season == season, self.request.episode == episode else { return }
            self.markers = found
            #if DEBUG
            print("[markers] S\(season)E\(episode) intro=\(found.intro.map { "\($0.start)-\($0.end) (\($0.source))" } ?? "none") credits=\(found.credits.map { "\($0)" } ?? "none")")
            #endif
        }
    }

    // ▲ during the intro: straight to its end when we know it (viewers'
    // timings or AniSkip), else a typical 85s.
    func skipIntro() {
        skippedIntro = true
        showSkipIntro = false
        if let intro = markers.intro, let web, web.canSeek {
            ownIntroSkip = true
            web.send(.seekTo(intro.end))
            playback.t = intro.end
            showHUD()
        } else {
            seek(by: 85)
        }
    }

    func seek(by seconds: Double) {
        autoAdvances = 0
        guard let web, web.canSeek, !request.isLive else {
            notice = request.isLive ? "This is live — skipping isn't available." : "Skipping isn't available on this Apple TV."
            showHUD()
            return
        }
        // Skipping forward early on: remember where it started so the
        // intro's timing can be shared once the seeking settles.
        if seconds > 0, isEpisode, !ownIntroSkip, introSeekFrom == nil, playback.t < 600 { introSeekFrom = playback.t }
        introSeekAt = Date()
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
        raced = []
        recoveries = 0
        handPicked = false
        startRace(servers)
    }

    // A hand-picked server plays alone, from where you were.
    func choose(_ next: StreamServer) {
        saveProgress(force: true)
        if playback.t > 30 { request.startAt = playback.t }
        notice = nil
        handPicked = true
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
        recoveries = 0
        handPicked = false
        raced = []
        markers = EpisodeMarkers()
        introSeekFrom = nil
        ownIntroSkip = false
        loadMarkers()
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
            if let state { self.apply(state, web: web) } else { self.checkLost() }
        }
    }

    // MARK: Stall recovery

    private func resetStallClock() {
        lastClock = -1
        clockMovedAt = Date()
        stateAt = Date()
    }

    // The page stopped reporting its video altogether (its web process
    // died, or the server replaced the page).
    private func checkLost() {
        guard started, Date().timeIntervalSince(stateAt) > 8 else { return }
        recover(reason: "lost the video")
    }

    // Called with every state: notices buffering, and switches servers when
    // the clock has been stuck long enough that it isn't coming back.
    private func watchClock(_ state: Playback) {
        let now = Date()
        stateAt = now
        if state.paused || state.ended || abs(state.t - lastClock) > 0.15 {
            lastClock = state.t
            clockMovedAt = now
        }
        let stuck = started ? now.timeIntervalSince(clockMovedAt) : 0
        buffering = stuck > 1.5
        if stuck > (request.isLive ? 12 : 20) { recover(reason: "stopped playing") }
    }

    private func recover(reason: String) {
        guard let current = server else { return }
        resetStallClock()
        // A server you chose yourself is never swapped out behind your back.
        if handPicked || recoveries >= 3 {
            notice = "\(current.name) \(reason). Swipe down to pick another server."
            hudVisible = true
            return
        }
        recoveries += 1
        saveProgress(force: true)
        if !request.isLive, playback.t > 5 { request.startAt = playback.t }
        let others = servers.filter { $0 != current }
        #if DEBUG
        print("[player] \(current.name) \(reason) — recovering (\(recoveries))")
        #endif
        let message = "\(current.name) \(reason). Switching servers…"
        startRace(others.isEmpty ? servers : others)
        notice = message
    }

    // A pause the app means (sleep timer, still watching, leaving the app):
    // treated like the viewer's own, so it isn't undone.
    private func holdPause() {
        userPaused = true
        race?.userPaused = true
        web?.send(.pause)
    }

    // MARK: Leaving the app

    private func observeLifecycle() {
        let center = NotificationCenter.default
        // Home button, Control Center or a screensaver: pause and save, like
        // any streaming app. Live streams just keep going.
        lifecycle.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !self.closed else { return }
                self.saveProgress(force: true)
                if !self.request.isLive, self.started, !self.playback.paused {
                    self.holdPause()
                }
            }
        })
        lifecycle.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !self.closed else { return }
                self.resetStallClock()
                self.showHUD()
            }
        })
    }

    #if DEBUG
    private var lastDebugAt = Date.distantPast
    #endif

    private func apply(_ state: Playback, web: WebEngine) {
        playback = state
        watchClock(state)
        #if DEBUG
        if Date().timeIntervalSince(lastDebugAt) > 4 {
            lastDebugAt = Date()
            print("[state] t=\(String(format: "%.1f", state.t)) paused=\(state.paused) ready=\(state.ready) h=\(state.height) server=\(server?.name ?? "-") started=\(started)")
        }
        #endif
        #if DEBUG
        // -BingeStallAfter N: N seconds in, the video claims to be playing
        // but its clock stops (a network stall). -BingeKillAfter N: the page
        // goes away entirely.
        let stallAfter = UserDefaults.standard.double(forKey: "BingeStallAfter")
        if stallAfter > 0, recoveries == 0, started, state.t > stallAfter, let modern = web as? ModernWebView {
            modern.evaluate("var v=document.querySelector('video'); if(v&&!v.__frozen){v.__frozen=1; var t=v.currentTime; Object.defineProperty(v,'currentTime',{get:function(){return t},set:function(){}}); Object.defineProperty(v,'paused',{get:function(){return false}});}", nil)
        }
        let killAfter = UserDefaults.standard.double(forKey: "BingeKillAfter")
        if killAfter > 0, recoveries == 0, started, state.t > killAfter {
            web.load(URL(string: "about:blank")!)
        }
        #endif
        if state.audio != audioTracks {
            audioTracks = state.audio
            #if DEBUG
            print("[tracks] now: \(state.audio.filter(\.on).map(Self.displayName)) of \(state.audio.count) audio, \(state.text.count) subtitle, h=\(state.height)")
            #endif
        }
        if state.text != textTracks { textTracks = state.text }
        applyPreferredTracks(web)
        // A handed-over warm race is paused on its first frame; keep asking
        // it to play until the clock moves (unmuting can pause it again).
        if !started, state.video, state.paused, !userPaused {
            web.send(.unmute)
            web.send(.play)
        }
        // Some servers pause themselves a few seconds in (an overlay, a
        // second player on the page). Only the remote pauses here, so any
        // other pause is undone, at most every 2s.
        if started, state.paused, !state.ended, !userPaused, Date().timeIntervalSince(lastResume) > 2 {
            lastResume = Date()
            web.send(.play)
            #if DEBUG
            print("[player] server paused itself at \(String(format: "%.1f", state.t))s — resuming")
            #endif
        }
        if !started, state.t > 0.4, !state.paused {
            started = true
            #if DEBUG
            print("[player] playing \(String(format: "%.1f", Date().timeIntervalSince(openedAt)))s after Play")
            #endif
        }

        if hudVisible, Date() > hudHideAt, !state.paused { hudVisible = false }
        if started, state.paused, userPaused {
            if pausedSince == nil { pausedSince = Date() }
            if let since = pausedSince, Date().timeIntervalSince(since) > 180,
               UserDefaults.standard.object(forKey: "binge.ambient") as? Bool ?? true { pausedAmbient = true }
        } else {
            pausedSince = nil
            pausedAmbient = false
        }
        if state.paused, started { hudVisible = true }

        // Keep the video pinned full screen (servers sometimes swap the
        // <video> element when they change quality or source).
        if started, Date().timeIntervalSince(lastFill) > 3 {
            lastFill = Date()
            if fillScreen { web.send(.fill) }
            // Subtitle size/background from Settings (re-sent, as servers
            // can swap the <video> element).
            web.send(.captionStyle(size: PlaybackPrefs.captionSize, background: PlaybackPrefs.captionBackground))
        }

        if let intro = markers.intro {
            showSkipIntro = isEpisode && started && !skippedIntro && state.t >= intro.start - 0.5 && state.t < intro.end - 2
        } else {
            showSkipIntro = isEpisode && started && !skippedIntro && state.t > 15 && state.t < 240
        }
        // A viewer's skip has settled: share where the intro was.
        if let from = introSeekFrom, Date().timeIntervalSince(introSeekAt) > 6 {
            introSeekFrom = nil
            if let season = request.season, let episode = request.episode {
                EpisodeMarkerStore.reportIntro(request.title, season: season, episode: episode, start: from, end: state.t, duration: state.d)
            }
        }

        if isEpisode, !markedWatched, state.d > 120, state.t / state.d > 0.9,
           let app, let season = request.season, let episode = request.episode {
            markedWatched = true
            let title = request.title
            Task { await app.markEpisodeWatched(title, season: season, episode: episode) }
        }

        if let sleepAt, Date() > sleepAt {
            self.sleepAt = nil
            sleep = .off
            holdPause()
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
        let atCredits = markers.credits.map { state.t >= $0 && remaining > 5 } ?? false
        if remaining < 90 || markers.credits.map({ state.t >= $0 - 60 }) == true, !warmedNext {
            warmedNext = true
            Warmup.shared.prepare(PlayRequest(title: request.title, season: next.season, episode: next.episode,
                                              seasons: request.seasons))
        }
        if state.ended || remaining < 25 || atCredits {
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
                    holdPause()
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
        // Moving on before Up Next showed: the credits had started.
        if !automatic, upNextCountdown == nil, let season = request.season, let episode = request.episode {
            EpisodeMarkerStore.reportCredits(request.title, season: season, episode: episode, start: playback.t, duration: playback.d)
        }
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
