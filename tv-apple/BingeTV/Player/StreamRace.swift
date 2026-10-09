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

    var key: String { Self.key(for: request) }
    static func key(for request: PlayRequest) -> String {
        "\(request.title.id):\(request.season ?? 0):\(request.episode ?? 0)"
    }

    init(request: PlayRequest, servers: [StreamServer], mode: Mode) {
        self.request = request
        self.mode = mode
        container.backgroundColor = .black
        guard let tmdbId = request.title.tmdbId ?? (request.isLive ? 0 : nil) else { failed = true; return }
        for server in servers {
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
        if let winner {
            // Warm: hold the winner on the start point, buffered and silent.
            if mode == .warm {
                winner.web.send(.mute)
                winner.web.send(.pause)
                if !seekedToStart, winner.web.canSeek, !request.isLive {
                    seekedToStart = true
                    let saved = request.startAt ?? 0
                    winner.web.send(.seekTo(saved > 30 ? saved : 0))
                }
            }
            return
        }

        // Mute every contender, nudge any that loaded but wait for a click,
        // and crown the first whose clock moves.
        for candidate in candidates {
            candidate.web.send(.mute)
            candidate.web.poll { [weak self] state in
                guard let self, self.winner == nil, let state,
                      self.candidates.contains(where: { $0.server == candidate.server }) else { return }
                if state.paused, state.ready >= 2 { candidate.web.send(.play) }
                if state.t > 0.4, !state.paused { self.crown(candidate) }
            }
        }

        if Date().timeIntervalSince(startedAt) > Self.giveUpSeconds {
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
        for other in candidates where other.server != candidate.server { Self.tearDown(other.web) }
        candidates = [candidate]
        candidate.web.view.alpha = 1
        if !request.isLive { StreamServer.rememberWorking(candidate.server, for: request.title) }
        if mode == .live {
            let start = request.startAt ?? 0
            // Resume: the race started from 0, so jump to the saved second.
            if start > 30, candidate.web.canSeek, !request.isLive { candidate.web.send(.seekTo(start)) }
            candidate.web.send(.unmute)
        }
        onChange?()
    }
}

// One background race at a time, shared by the title page, Continue
// Watching focus and Up Next. Its views sit in an invisible host so the
// web views are in a window (some players won't decode otherwise).
@MainActor
final class Warmup {
    static let shared = Warmup()
    let host = UIView()
    private var race: StreamRace?

    private init() {
        host.alpha = 0.01
        host.isUserInteractionEnabled = false
        host.clipsToBounds = true
    }

    func prepare(_ request: PlayRequest) {
        guard WebEngines.isAvailable, request.title.tmdbId != nil else { return }
        let key = StreamRace.key(for: request)
        if race?.key == key { return }
        race?.stop()
        let fresh = StreamRace(request: request, servers: StreamServer.ranked(for: request.title), mode: .warm)
        fresh.container.frame = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        host.addSubview(fresh.container)
        race = fresh
        // Don't keep buffering something nobody played.
        DispatchQueue.main.asyncAfter(deadline: .now() + 180) { [weak self, weak fresh] in
            guard let self, let fresh, self.race === fresh else { return }
            self.cancel()
        }
    }

    // Hands over the warm race if it matches (and hasn't given up).
    func take(_ request: PlayRequest) -> StreamRace? {
        guard let race, race.key == StreamRace.key(for: request), !race.failed else { return nil }
        self.race = nil
        race.container.removeFromSuperview()
        return race
    }

    func cancel(_ request: PlayRequest? = nil) {
        if let request, race?.key != StreamRace.key(for: request) { return }
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
