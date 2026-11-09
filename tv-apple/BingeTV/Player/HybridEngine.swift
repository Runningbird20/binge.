import UIKit

// One server: its page loads (that's how the stream is found), and as soon as
// the page's video has an http(s) source (tvOS pages play native HLS, so
// that's the stream itself), AVPlayer plays it (NativeEngine), the page goes
// quiet, and it's closed once AVPlayer shows pictures. Anything AVPlayer can't
// play stays in the page. Same idea as the Fire TV app's HybridEngine.
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
    private var rebuilds = 0
    private var wantPlay = true
    private var wantMuted = true
    private var closed = false

    init(page: WebEngine) {
        self.page = page
        frame.backgroundColor = .black
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
        install(engine)
        nativeStartedAt = Date()
        // The page goes quiet while AVPlayer starts.
        page?.send(.mute)
        page?.send(.pause)
    }

    private func install(_ engine: NativeEngine) {
        native = engine
        engine.view.frame = frame.bounds
        engine.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        frame.addSubview(engine.view)
        if !wantMuted { engine.send(.unmute) }
        if !wantPlay { engine.send(.pause) }
    }

    // AVPlayer couldn't play it: back to the page, or (page gone) a fresh
    // AVPlayer on the same stream from the same second.
    private func fallBack() {
        native?.destroy()
        native = nil
        if let page {
            NativePlayback.failed(source?.stream.host)
            #if DEBUG
            print("[native] back to the page")
            #endif
            if !wantMuted { page.send(.unmute) }
            if wantPlay { page.send(.play) }
            return
        }
        guard !closed, let source, rebuilds < 2 else { return }
        rebuilds += 1
        let engine = NativeEngine(stream: source.stream, page: source.page, agent: source.agent)
        engine.onFailed = { [weak self] in self?.fallBack() }
        install(engine)
        if lastT > 1 { engine.send(.seekTo(lastT)) }
    }

    private func closePage() {
        guard let page else { return }
        page.send(.stop)
        page.load(URL(string: "about:blank")!)
        page.view.removeFromSuperview()
        WebEngines.close(page)
        self.page = nil
    }

    func poll(_ completion: @escaping (MediaState?) -> Void) {
        guard !closed else { completion(nil); return }
        if let native {
            native.poll { [weak self] state in
                guard let self else { completion(nil); return }
                guard let state else { completion(nil); return }
                if state.t > 0 { self.lastT = state.t }
                if !self.isNative {
                    if state.t > 0.4, !state.paused || !self.wantPlay {
                        self.isNative = true
                        #if DEBUG
                        print("[native] playing \(state.height)p, closing the page")
                        #endif
                        self.closePage()
                    } else if Date().timeIntervalSince(self.nativeStartedAt) > 8 {
                        NativePlayback.failed(self.source?.stream.host)
                        #if DEBUG
                        print("[native] too slow: \(native.debugReport())")
                        #endif
                        self.fallBack()
                    }
                }
                completion(state)
            }
            return
        }
        guard let page else { completion(nil); return }
        page.poll { [weak self] state in
            if let self, let state, self.native == nil, self.source == nil, NativePlayback.enabled,
               let stream = URL(string: state.src), stream.scheme?.hasPrefix("http") == true,
               !NativePlayback.skips(stream.host) {
                self.startNative(stream: stream, pageURL: state.page, agent: state.agent)
            }
            completion(state)
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
        if let native { native.send(command) } else { page?.send(command) }
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
