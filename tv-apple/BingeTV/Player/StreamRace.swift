import UIKit

// Startup time varies wildly by server and title (measured: Vidy 1.8s and
// VidRift 26s on one movie, the reverse on a show), so instead of trying
// servers one at a time, load them all at once (muted) and keep the first
// one whose video actually plays. The rest are torn down immediately.
//
// A race can run "warm" in the background, e.g. while the title page is
// open: the winner then holds on its first frame (or the resume point),
// buffered, so pressing Play is instant.
@MainActor
final class StreamRace {
    enum Mode { case warm, live }

    struct Candidate {
        let server: StreamServer
        let web: WebEngine
        let url: URL
    }

    let request: PlayRequest
    let container = UIView()
    private(set) var mode: Mode
    private(set) var candidates: [Candidate] = []
    private(set) var winner: Candidate?
    private(set) var startedAt = Date()
    private(set) var failed = false
    private var timer: Timer?
    private var seekedToStart = false
    var onChange: (() -> Void)?

    static let giveUpSeconds: TimeInterval = 45
    static let maxLiveContenders = 4

    var key: String { Self.key(for: request) }
    static func key(for request: PlayRequest) -> String {
        if let game = request.game { return "live:\(game.id)" }
        return "\(request.title.id):\(request.season ?? 0):\(request.episode ?? 0)"
    }

    // Live: after a winner, runners-up keep loading (silent, hidden) for a
    // few seconds; a clearly sharper one takes over. The fastest stream
    // isn't always the best-looking one.
    private var upgradeUntil: Date?
    private var heights: [String: Int] = [:]
    private var times: [String: Double] = [:]
    private var playingHeights: [String: Int] = [:]
    private var firstPlayAt: Date?
    private var memoryObserver: NSObjectProtocol?

    // Multiview tiles decide their own sound; the winner stays muted.
    let keepMuted: Bool
    // The real runtime (TMDB), filled in shortly after the race starts; a
    // stream whose length is clearly different is the wrong video.
    var expectedDuration: Double?
    private(set) var rejected = Set<String>()

    // Set by the player when the viewer pauses, so shopping for a sharper
    // stream never "un-pauses" them.
    var userPaused = false

    init(request: PlayRequest, servers: [StreamServer], mode: Mode, keepMuted: Bool = false) {
        self.request = request
        self.mode = mode
        self.keepMuted = keepMuted
        container.backgroundColor = .black
        guard let tmdbId = request.title.tmdbId ?? (request.isLive ? 0 : nil) else { failed = true; return }
        // A live race opens at most 4 pages at once (Apple TV memory); the
        // player keeps the rest as backups for recovery.
        for server in request.isLive ? Array(servers.prefix(Self.maxLiveContenders)) : servers {
            let url = server.build(tmdbId, request.title.kind, request.season ?? 1, request.episode ?? 1)
            guard let web = WebEngines.make(allowedHost: url.host) else { continue }
            web.view.frame = container.bounds
            web.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            web.view.alpha = 0
            web.view.isUserInteractionEnabled = false
            container.addSubview(web.view)
            web.load(url)
            candidates.append(Candidate(server: server, web: web, url: url))
        }
        if candidates.isEmpty { failed = true }
        #if DEBUG
        print("[race] racing \(candidates.map(\.server.name)) of \(servers.count)")
        #endif
        // Low on memory: stop shopping for a sharper live stream.
        memoryObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { if self?.upgradeUntil != nil { self?.upgradeUntil = Date() } }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    func goLive() {
        mode = .live
        if let winner {
            winner.web.send(.unmute)
            winner.web.send(.play)
        }
        onChange?()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if let memoryObserver { NotificationCenter.default.removeObserver(memoryObserver) }
        memoryObserver = nil
        for candidate in candidates { Self.tearDown(candidate.web) }
        candidates = []
        winner = nil
    }

    private static func tearDown(_ web: WebEngine) {
        web.send(.stop)
        web.load(URL(string: "about:blank")!)
        web.view.removeFromSuperview()
    }

    private func tick() {
        if let winner, let until = upgradeUntil {
            upgradeTick(winner: winner, until: until)
            return
        }
        if let winner {
            // Warm: hold the winner on the start point, buffered and silent.
            if mode == .warm {
                winner.web.send(.mute)
                // A live stream stays running (muted) so it's at the live
                // edge when you press Play; anything else holds still.
                if !request.isLive { winner.web.send(.pause) }
                if !seekedToStart, winner.web.canSeek, !request.isLive {
                    seekedToStart = true
                    let saved = request.startAt ?? 0
                    winner.web.send(.seekTo(saved > 30 ? saved : 0))
                }
            }
            return
        }

        // Mute every contender, nudge any that loaded but wait for a click,
        // and crown the first whose clock moves. "Best quality" (movies and
        // shows) gives the others 1.5s more and takes the sharpest playing.
        let shopping = !request.isLive && mode == .live && QualityPreference.current == .best && candidates.count > 1
        for candidate in candidates {
            candidate.web.send(.mute)
            candidate.web.poll { [weak self] state in
                guard let self, self.winner == nil, let state,
                      self.candidates.contains(where: { $0.server == candidate.server }) else { return }
                if state.paused, state.ready >= 2 { candidate.web.send(.play) }
                if let expected = self.expectedDuration, ExpectedRuntime.isWrong(state.d, expected: expected) {
                    self.reject(candidate, length: state.d)
                    return
                }
                guard state.t > 0.4, !state.paused else { return }
                guard shopping else { self.crown(candidate); return }
                self.playingHeights[candidate.server.id] = state.height
                if self.firstPlayAt == nil { self.firstPlayAt = Date() }
                if state.height >= 2000 || Date().timeIntervalSince(self.firstPlayAt!) > 1.5 {
                    let best = self.candidates.max { (self.playingHeights[$0.server.id] ?? -1) < (self.playingHeights[$1.server.id] ?? -1) }
                    self.crown(best ?? candidate)
                }
            }
        }

        if Date().timeIntervalSince(startedAt) > Self.giveUpSeconds {
            failed = true
            stop()
            onChange?()
        }
    }

    private func upgradeTick(winner: Candidate, until: Date) {
        let others = candidates.filter { $0.server != winner.server }
        if Date() > until || others.isEmpty {
            for other in others { Self.tearDown(other.web) }
            candidates = [winner]
            upgradeUntil = nil
            return
        }
        winner.web.poll { [weak self] state in
            guard let self, let state else { return }
            if state.height > 0 { self.heights[winner.server.id] = state.height }
            self.times[winner.server.id] = state.t
            // Another page starting its video can pause this one (tvOS
            // gives one video the audio at a time); keep it going.
            if state.paused, !state.ended, !self.userPaused { winner.web.send(.play) }
        }
        for other in others {
            other.web.send(.mute)
            other.web.poll { [weak self] state in
                guard let self, let state, self.winner?.server == winner.server else { return }
                if state.paused, state.ready >= 2 { other.web.send(.play) }
                self.heights[other.server.id] = state.height
                let current = self.heights[winner.server.id] ?? 0
                guard current > 0, state.height >= Int(Double(current) * 1.3), !state.paused, state.t > 0.4 else { return }
                // Promote the sharper stream.
                #if DEBUG
                print("[race] upgrade \(winner.server.name) \(current)p -> \(other.server.name) \(state.height)p")
                #endif
                // A movie or episode picks up where the first stream was.
                if !self.request.isLive, let at = self.times[winner.server.id], at > 1, other.web.canSeek {
                    other.web.send(.seekTo(at))
                }
                winner.web.view.alpha = 0
                Self.tearDown(winner.web)
                self.candidates.removeAll { $0.server == winner.server }
                self.winner = other
                other.web.view.alpha = 1
                if !self.keepMuted { other.web.send(.unmute) }
                self.onChange?()
            }
        }
    }

    private func reject(_ candidate: Candidate, length: Double) {
        #if DEBUG
        print("[race] \(candidate.server.name) is the wrong video (\(Int(length / 60)) min, expected \(Int((expectedDuration ?? 0) / 60)))")
        #endif
        rejected.insert(candidate.server.id)
        Self.tearDown(candidate.web)
        candidates.removeAll { $0.server == candidate.server }
        playingHeights[candidate.server.id] = nil
        if candidates.isEmpty {
            failed = true
            stop()
            onChange?()
        }
    }

    private func crown(_ candidate: Candidate) {
        winner = candidate
        #if DEBUG
        print("[race] \(mode == .warm ? "warm" : "live") winner \(candidate.server.name) after \(String(format: "%.1f", Date().timeIntervalSince(startedAt)))s")
        #endif
        if request.isLive, mode == .live, candidates.count > 1, QualityPreference.current == .best {
            upgradeUntil = Date().addingTimeInterval(6)
        } else {
            for other in candidates where other.server != candidate.server { Self.tearDown(other.web) }
            candidates = [candidate]
        }
        candidate.web.view.alpha = 1
        if !request.isLive { StreamServer.rememberWorking(candidate.server, for: request.title) }
        if mode == .live {
            let start = request.startAt ?? 0
            // Resume: the race started from 0, so jump to the saved second.
            if start > 30, candidate.web.canSeek, !request.isLive { candidate.web.send(.seekTo(start)) }
            if !keepMuted { candidate.web.send(.unmute) }
        }
        onChange?()
    }
}

// "Best quality" (default) keeps shopping for a sharper stream for a few
// seconds after the first one plays, movies and shows included; "Fastest
// start" takes the first stream that plays and stops there.
enum QualityPreference: String, CaseIterable, Identifiable {
    case best, fastest
    var id: String { rawValue }
    var label: String { self == .best ? "Best quality" : "Fastest start" }
    static var current: QualityPreference {
        QualityPreference(rawValue: UserDefaults.standard.string(forKey: "binge.quality") ?? "") ?? .best
    }
}

// One background race at a time, shared by the title page, Continue
// Watching focus and Up Next. Its views sit in an invisible host so the
// web views are in a window (some players won't decode otherwise).
@MainActor
final class Warmup {
    static let shared = Warmup()
    let host = UIView()
    private(set) var race: StreamRace?

    private init() {
        host.alpha = 0.01
        host.isUserInteractionEnabled = false
        host.clipsToBounds = true
        // A preload is the first thing to give up when memory runs low or
        // the app leaves the screen.
        for name in [UIApplication.didReceiveMemoryWarningNotification, UIApplication.didEnterBackgroundNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { Warmup.shared.cancel() }
            }
        }
    }

    private var pendingKey: String?

    func prepare(_ request: PlayRequest) {
        guard WebEngines.isAvailable, request.title.tmdbId != nil || request.isLive else { return }
        let key = StreamRace.key(for: request)
        if race?.key == key || pendingKey == key { return }
        race?.stop()
        race?.container.removeFromSuperview()
        race = nil
        pendingKey = key
        Task {
            let servers = request.isLive ? request.liveStreams
                : await ServerPlan.servers(for: request.title, originalLanguage: request.title.originalLanguage)
            guard self.pendingKey == key else { return }
            self.pendingKey = nil
            let fresh = StreamRace(request: request, servers: servers.isEmpty ? StreamServer.all : servers, mode: .warm)
            Task { fresh.expectedDuration = await ExpectedRuntime.seconds(for: request) }
            fresh.container.frame = CGRect(x: 0, y: 0, width: 1920, height: 1080)
            self.host.addSubview(fresh.container)
            self.race = fresh
            // Don't keep buffering something nobody played.
            DispatchQueue.main.asyncAfter(deadline: .now() + 180) { [weak fresh] in
                guard let fresh, Warmup.shared.race === fresh else { return }
                Warmup.shared.cancel()
            }
        }
    }

    func isWarming(_ key: String) -> Bool { race?.key == key || pendingKey == key }

    // Hands over the warm race if it matches (and hasn't given up).
    func take(_ request: PlayRequest) -> StreamRace? {
        guard let race, race.key == StreamRace.key(for: request), !race.failed else { return nil }
        self.race = nil
        race.container.removeFromSuperview()
        return race
    }

    func cancel(_ request: PlayRequest? = nil) {
        if let request, race?.key != StreamRace.key(for: request) { return }
        pendingKey = nil
        race?.stop()
        race?.container.removeFromSuperview()
        race = nil
    }
}

import SwiftUI

// Full-screen but behind everything: keeps warm races in the window.
struct WarmHost: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { Warmup.shared.host }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
