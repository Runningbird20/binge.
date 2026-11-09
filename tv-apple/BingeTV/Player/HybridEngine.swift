import UIKit

// One server: its page loads (that's how the stream is found), and as soon as
// the page's video has an http(s) source (tvOS pages play native HLS, so
// that's the stream itself), AVPlayer (NativeEngine) starts on it too, hidden.
// The page keeps going, muted, so whichever shows pictures first is what's
// on screen: a slow stream server costs no extra time, and AVPlayer failing
// costs nothing at all. Once AVPlayer shows pictures it takes over at the
// page's second and the page is closed. Same idea as the Fire TV app's
// HybridEngine.
@MainActor
final class HybridEngine: WebEngine {
    private var page: WebEngine?
    private var native: NativeEngine?
    private let frame = UIView()
    var view: UIView { frame }
    var canSeek: Bool { native != nil || (page?.canSeek ?? false) }
    // Native is the one on screen (the page is gone).
    private(set) var isNative = false
    private var nativeStartedAt = Date()
    private var source: (stream: URL, page: String, agent: String)?
    private var lastT = 0.0
    private var pageState: MediaState?
    private var rebuilds = 0
    private var wantPlay = true
    private var wantMuted = true
    private var closed = false

    // AVPlayer gets this long to show pictures while the page plays.
    static let nativeGrace: TimeInterval = 20
    // Low memory (Apple TV HD): two decoders of one stream is too much, so
    // the page pauses while AVPlayer starts and gets it back after 8s.
    private var sideBySide: Bool { !Device.isLowMemory }

    // The page this server plays in until AVPlayer takes over (nil after).
    var pageEngine: WebEngine? { page }

    // clear: the page draws its video elsewhere (a Multiview slot is an
    // iframe in the shared page behind the tile), so this view must not
    // cover it until AVPlayer has pictures.
    init(page: WebEngine, clear: Bool = false) {
        self.page = page
        frame.backgroundColor = clear ? .clear : .black
        page.view.frame = frame.bounds
        page.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        frame.addSubview(page.view)
    }

    func load(_ url: URL) {
        if url.absoluteString == "about:blank" { close(); return }
        page?.load(url)
    }

    func setAllowedHost(_ host: String?) { page?.setAllowedHost(host) }

    private func startNative(stream: URL, pageURL: String, agent: String) {
        guard !closed, native == nil else { return }
        #if DEBUG
        print("[native] stream found \(stream.host ?? "?")")
        #endif
        source = (stream, pageURL, agent)
        let engine = NativeEngine(stream: stream, page: pageURL, agent: agent)
        engine.onFailed = { [weak self] in self?.fallBack() }
        install(engine, shown: false)
        nativeStartedAt = Date()
        if !sideBySide {
            page?.send(.mute)
            page?.send(.pause)
        }
    }

    private func install(_ engine: NativeEngine, shown: Bool) {
        native = engine
        engine.view.frame = frame.bounds
        engine.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // All but invisible until it has pictures (the page shows underneath
        // meanwhile); not hidden, so the layer still decodes its first frame.
        engine.view.alpha = shown ? 1 : 0.01
        frame.addSubview(engine.view)
        if shown, !wantMuted { engine.send(.unmute) }
        if !wantPlay { engine.send(.pause) }
    }

    // AVPlayer has pictures: it's the one on screen from now on.
    private func promote(_ engine: NativeEngine) {
        isNative = true
        // Pick up where the page is (a movie or episode; live stays at the edge).
        if let pageState, pageState.d > 0, pageState.t > 1 { engine.send(.seekTo(pageState.t + 0.3)) }
        engine.view.alpha = 1
        if !wantMuted { engine.send(.unmute) }
        wantPlay ? engine.send(.play) : engine.send(.pause)
        #if DEBUG
        print("[native] took over after \(String(format: "%.1f", Date().timeIntervalSince(nativeStartedAt)))s, closing the page")
        #endif
        closePage()
    }

    // AVPlayer couldn't play it: the page carries on, or (page gone) a fresh
    // AVPlayer on the same stream from the same second.
    private func fallBack() {
        native?.destroy()
        native = nil
        if let page {
            NativePlayback.failed(source?.stream.host)
            #if DEBUG
            print("[native] staying in the page")
            #endif
            if !wantMuted { page.send(.unmute) }
            if wantPlay { page.send(.play) }
            return
        }
        guard !closed, let source, rebuilds < 2 else { return }
        rebuilds += 1
        let engine = NativeEngine(stream: source.stream, page: source.page, agent: source.agent)
        engine.onFailed = { [weak self] in self?.fallBack() }
        install(engine, shown: true)
        if lastT > 1 { engine.send(.seekTo(lastT)) }
    }

    private func closePage() {
        guard let page else { return }
        page.send(.stop)
        page.load(URL(string: "about:blank")!)
        page.view.removeFromSuperview()
        WebEngines.close(page)
        self.page = nil
        pageState = nil
    }

    func poll(_ completion: @escaping (MediaState?) -> Void) {
        guard !closed else { completion(nil); return }
        if isNative || page == nil, let native {
            native.poll { [weak self] state in
                if let state, state.t > 0 { self?.lastT = state.t }
                completion(state)
            }
            return
        }
        guard let page else { completion(nil); return }
        page.poll { [weak self] state in
            guard let self else { completion(nil); return }
            self.pageState = state
            if let state, self.native == nil, self.source == nil, NativePlayback.enabled,
               let stream = URL(string: state.src), stream.scheme?.hasPrefix("http") == true,
               !NativePlayback.skips(stream.host) {
                self.startNative(stream: stream, pageURL: state.page, agent: state.agent)
            }
            guard let native = self.native else { completion(state); return }
            native.poll { [weak self] nativeState in
                guard let self, !self.closed else { completion(nil); return }
                let waited = Date().timeIntervalSince(self.nativeStartedAt)
                if native.showing, let nativeState, nativeState.t > 0.4 || !self.wantPlay {
                    self.promote(native)
                    completion(nativeState)
                    return
                }
                // The page plays and AVPlayer still has nothing (or, low
                // memory, the page has waited long enough): stay in the page.
                let pagePlaying = (state?.t ?? 0) > 0.4 && state?.paused == false
                if self.sideBySide ? (pagePlaying && waited > Self.nativeGrace) : waited > 8 {
                    #if DEBUG
                    print("[native] no pictures after \(Int(waited))s: \(native.debugReport())")
                    #endif
                    self.fallBack()
                }
                // Until AVPlayer takes over, the page is what's on screen.
                completion(self.sideBySide ? state : nativeState)
            }
        }
    }

    func send(_ command: MediaCommand) {
        switch command {
        case .play: wantPlay = true
        case .pause, .stop: wantPlay = false
        case .toggle: wantPlay.toggle()
        case .mute: wantMuted = true
        case .unmute: wantMuted = false
        default: break
        }
        if isNative || page == nil, let native { native.send(command); return }
        // Starting side by side: the page has the sound; AVPlayer follows
        // the page's play/pause/seek silently.
        page?.send(command)
        guard let native else { return }
        switch command {
        case .mute, .unmute: break
        case .toggle: wantPlay ? native.send(.play) : native.send(.pause)
        default: native.send(command)
        }
    }

    func close() {
        closed = true
        native?.destroy()
        native = nil
        closePage()
    }
}

// Settings › Playback › "Native player" (on by default).
enum NativePlayback {
    static var enabled: Bool { UserDefaults.standard.object(forKey: "binge.nativePlayer") as? Bool ?? true }

    // A stream host AVPlayer couldn't start stays in the page for a day.
    private static func key(_ host: String) -> String { "binge.nativeFailed.\(host)" }
    static func failed(_ host: String?) {
        guard let host else { return }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: key(host))
    }
    static func skips(_ host: String?) -> Bool {
        guard let host else { return false }
        let at = UserDefaults.standard.double(forKey: key(host))
        return at > 0 && Date().timeIntervalSince1970 - at < 86_400
    }
}
