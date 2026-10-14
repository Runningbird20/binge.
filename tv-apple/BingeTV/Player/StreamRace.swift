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
    // Live games: a second server kept playing, muted and hidden, behind the
    // one on screen. If the stream on screen stalls, the two swap at once, so
    // a stall shows as nothing instead of a spinner.
    private(set) var standby: Candidate?
    private var winnerMovedAt = Date()
    private var winnerT = -1.0
    private var standbyMovedAt = Date.distantPast
    private var standbyT = -1.0
    private var lastSwap = Date.distantPast
    private var playingAt: [String: Date] = [:]
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

    // makeEngine: where a server's page plays (default: its own web view; the
    // shared Multiview page gives each game a slot in one page instead).
    init(request: PlayRequest, servers: [StreamServer], mode: Mode, keepMuted: Bool = false,
         makeEngine: ((URL) -> WebEngine?)? = nil) {
        self.request = request
        self.mode = mode
        self.keepMuted = keepMuted
        container.backgroundColor = .black
        guard let tmdbId = request.title.tmdbId ?? (request.isLive ? 0 : nil) else { failed = true; return }
        // A live race opens at most 4 pages at once (Apple TV memory); the
        // player keeps the rest as backups for recovery.
        for server in request.isLive ? Array(servers.prefix(Self.maxLiveContenders)) : servers {
            let url = server.build(tmdbId, request.title.kind, request.season ?? 1, request.episode ?? 1)
            guard let web = makeEngine?(url) ?? WebEngines.make(allowedHost: url.host) else { continue }
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
            MainActor.assumeIsolated {
                if self?.upgradeUntil != nil { self?.upgradeUntil = Date() }
                self?.dropStandby()
            }
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
            if mode == .live, standby != nil { standbyTick(winner: winner); return }
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
        // Best quality (preloads and live games too): wait a few seconds for
        // the sharpest server this Apple TV has seen, then take the sharpest
        // that's playing. Fastest start: the first to play.
        let shopping = !keepMuted && QualityPreference.current == .best && candidates.count > 1
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
                let now = Date()
                self.playingHeights[candidate.server.id] = state.height
                self.playingAt[candidate.server.id] = now
                if self.firstPlayAt == nil { self.firstPlayAt = now }
                let waited = now.timeIntervalSince(self.firstPlayAt!)
                let score = { (c: Candidate) in QualityMemory.quality(c.server) }
                let top = self.candidates.map(score).max() ?? 0
                let playing = self.candidates.filter { now.timeIntervalSince(self.playingAt[$0.server.id] ?? .distantPast) < 2 }
                // The sharpest-known server is playing, or it's had long enough.
                let sharpestPlaying = top > 0 && playing.contains { score($0) >= top }
                guard sharpestPlaying || state.height >= 2000 || waited > (self.request.isLive ? 4 : 6) else { return }
                let best = playing.max { (score($0), self.playingHeights[$0.server.id] ?? 0) < (score($1), self.playingHeights[$1.server.id] ?? 0) }
                self.crown(best ?? candidate)
            }
        }

        if Date().timeIntervalSince(startedAt) > Self.giveUpSeconds {
            if request.isLive { candidates.forEach { SportsMemory.record($0.server.name, worked: false) } }
            failed = true
            stop()
            onChange?()
        }
    }

    private func upgradeTick(winner: Candidate, until: Date) {
        let others = candidates.filter { $0.server != winner.server }
        if Date() > until || others.isEmpty {
            // Keep the sharpest runner-up that's really playing as the standby.
            let keep = wantsStandby ? others
                .filter { Date().timeIntervalSince(playingAt[$0.server.id] ?? .distantPast) < 2 }
                .max { (heights[$0.server.id] ?? 0) < (heights[$1.server.id] ?? 0) } : nil
            for other in others where other.server != keep?.server { Self.tearDown(other.web) }
            candidates = [winner] + (keep.map { [$0] } ?? [])
            standby = keep
            standbyMovedAt = Date()
            winnerMovedAt = Date()
            upgradeUntil = nil
            #if DEBUG
            if let keep { print("[race] standby \(keep.server.name) behind \(winner.server.name)") }
            #endif
            return
        }
        winner.web.poll { [weak self] state in
            guard let self, let state else { return }
            if state.height > 0 { self.heights[winner.server.id] = state.height }
            self.times[winner.server.id] = state.t
            // Another page starting its video can pause this one (tvOS
            // gives one video the audio at a time); keep it going.
            if state.paused, !state.ended, !self.userPaused, !state.cushion { winner.web.send(.play) }
        }
        for other in others {
            other.web.send(.mute)
            other.web.poll { [weak self] state in
                guard let self, let state, self.winner?.server == winner.server else { return }
                if state.paused, state.ready >= 2 { other.web.send(.play) }
                self.heights[other.server.id] = state.height
                if !state.paused, state.t > 0.4 { self.playingAt[other.server.id] = Date() }
                let current = self.heights[winner.server.id] ?? 0
                let sharperKnown = QualityMemory.quality(other.server) > QualityMemory.quality(winner.server)
                guard QualityPreference.current == .best || !self.request.isLive, !state.paused, state.t > 0.4,
                      sharperKnown || (current > 0 && state.height >= Int(Double(current) * 1.3)) else { return }
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

    // The live player (not Multiview tiles, not warm preloads) keeps a standby.
    private var wantsStandby: Bool { request.isLive && mode == .live && !keepMuted }

    private func dropStandby() {
        guard let standby else { return }
        Self.tearDown(standby.web)
        candidates.removeAll { $0.server == standby.server }
        self.standby = nil
    }

    private func standbyTick(winner: Candidate) {
        guard let standby else { return }
        let now = Date()
        winner.web.poll { [weak self] state in
            guard let self, let state else { return }
            // Moving, or paused on purpose: not a stall. (A cushion hold is a stall.)
            if abs(state.t - self.winnerT) > 0.05 || (state.paused && !state.cushion && self.userPaused) { self.winnerMovedAt = now }
            self.winnerT = state.t
        }
        standby.web.send(.mute)
        standby.web.poll { [weak self] state in
            guard let self, let state else { return }
            if state.paused, !state.ended, !state.cushion { standby.web.send(.play) }
            if abs(state.t - self.standbyT) > 0.05, !state.paused { self.standbyMovedAt = now }
            self.standbyT = state.t
        }
        // The stream on screen has stalled for 2.5s and the standby is
        // playing: swap them (picture and sound) right away.
        guard !userPaused, now.timeIntervalSince(winnerMovedAt) > 2.5,
              now.timeIntervalSince(standbyMovedAt) < 1.5, now.timeIntervalSince(lastSwap) > 10 else { return }
        #if DEBUG
        print("[race] stall on \(winner.server.name): switching to standby \(standby.server.name)")
        #endif
        lastSwap = now
        standby.web.view.alpha = 1
        winner.web.view.alpha = 0
        winner.web.send(.mute)
        standby.web.send(.unmute)
        standby.web.send(.cushionOn)
        self.winner = standby
        self.standby = winner // it may recover; it's the backup now
        winnerMovedAt = now
        winnerT = -1
        standbyMovedAt = .distantPast
        standbyT = -1
        onChange?()
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
        if request.isLive, mode == .live, !keepMuted, candidates.count > 1 {
            upgradeUntil = Date().addingTimeInterval(6)
        } else {
            for other in candidates where other.server != candidate.server { Self.tearDown(other.web) }
            candidates = [candidate]
        }
        candidate.web.view.alpha = 1
        if !request.isLive { StreamServer.rememberWorking(candidate.server, for: request.title) }
        else if mode == .live { SportsMemory.record(candidate.server.name, worked: true) }
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
// The picture each server really delivers on this Apple TV, learned from
// playback (the resolution after 30s, once the player has climbed to its
// full quality; the first seconds are always low). A label's own "1080p"
// or "HD" counts until something's been measured. Best quality ranks and
// waits by this; nothing is hard-coded.
enum QualityMemory {
    private static func key(_ server: StreamServer) -> String {
        // Movie/TV servers have stable ids ("vidrift"); a sports stream's id
        // is its URL, so the label ("StreamFree 1080p", "PPV · ESPN") is used.
        "binge.q." + (server.id.contains("://") ? server.name : server.id)
    }

    static func nominal(_ name: String) -> Int {
        let lower = name.lowercased()
        if lower.contains("4k") || lower.contains("2160") { return 2160 }
        if lower.contains("1080") { return 1080 }
        if lower.contains("720") || lower.contains(" hd") { return 720 }
        if lower.contains("480") { return 480 }
        return 0
    }

    static func learned(_ server: StreamServer) -> Int { UserDefaults.standard.integer(forKey: key(server)) }

    static func quality(_ server: StreamServer) -> Int { max(learned(server), nominal(server.name)) }

    // Highest wins at once; a lower reading eases it down slowly.
    static func record(_ server: StreamServer, height: Int) {
        guard height > 0 else { return }
        let old = learned(server)
        UserDefaults.standard.set(height >= old ? height : (old * 3 + height) / 4, forKey: key(server))
    }

    // Best quality first, otherwise the given order.
    static func sorted(_ servers: [StreamServer]) -> [StreamServer] {
        servers.enumerated().sorted { (quality($0.element), -$0.offset) > (quality($1.element), -$1.offset) }.map(\.element)
    }
}

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
    // Multiview is open: no background preloads at all. The Sports page
    // underneath kept preloading its spotlight game (4 servers at once)
    // while Multiview ran, which is memory the Apple TV didn't have.
    var suspended = false {
        didSet { if suspended { cancel() } }
    }

    func prepare(_ request: PlayRequest) {
        guard !suspended, WebEngines.isAvailable, request.title.tmdbId != nil || request.isLive else { return }
        // A preload is optional: skip it when several video pages are already
        // open (Multiview, a corner game), rather than risk running out of memory.
        if race == nil, WebEngines.liveCount >= 5 { return }
        let key = StreamRace.key(for: request)
        if race?.key == key || pendingKey == key { return }
        race?.stop()
        race?.container.removeFromSuperview()
        race = nil
        pendingKey = key
        Task {
            let servers = request.isLive ? request.liveStreams
                : await ServerPlan.servers(for: request.title, originalLanguage: request.title.originalLanguage)
            guard self.pendingKey == key, !self.suspended else { return }
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
