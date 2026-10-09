#if DEBUG
import SwiftUI

// -BingeProbe <url>: load a player page full screen and log what the page
// contains every 5s (used to check servers in the simulator).
struct DebugProbeView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> UIView {
        let legacy = UserDefaults.standard.string(forKey: "BingeEngine") == "legacy"
        guard let web: WebEngine = legacy ? LegacyWebView(allowedHost: url.host) : WebEngines.make(allowedHost: url.host) else {
            print("[probe] no web engine")
            return UIView()
        }
        print("[probe] engine: \(type(of: web))")
        context.coordinator.web = web
        web.load(url)
        let began = Date()
        var reported = false
        // Time to first frame, with the same play() nudge the player uses.
        // -BingeProbeSeek YES also seeks +30s three seconds after it starts.
        Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { timer in MainActor.assumeIsolated {
            web.poll { state in
                guard let state else { return }
                if state.paused, state.ready >= 2 { web.send(.play) }
                guard state.t > 0.5, !state.paused, !reported else { return }
                reported = true
                timer.invalidate()
                print("[probe] STARTED after \(String(format: "%.1f", Date().timeIntervalSince(began)))s (t=\(state.t), live=\(state.d == 0))")
                if UserDefaults.standard.bool(forKey: "BingeProbeSeek") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        web.send(.seekBy(30))
                        print("[probe] seeking +30")
                    }
                }
            }
        } }
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in MainActor.assumeIsolated {
            web.poll { state in print("[probe] state \(state.map { "t=\(Int($0.t)) d=\(Int($0.d)) paused=\($0.paused) ready=\($0.ready) h=\($0.height) audio=\($0.audio.map { "\($0.label)|\($0.language)|\($0.on)" }) text=\($0.text.map { "\($0.label)|\($0.language)|\($0.on)" })" } ?? "no video")") }
        } }
        return web.view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var web: WebEngine? }
}
#endif

#if DEBUG
import Darwin

// -BingeCheckEngines YES: report which web engines this tvOS has.
enum EngineCheck {
    static func run() {
        let paths = ["/System/Library/Frameworks/WebKit.framework/WebKit",
                     "/System/Library/PrivateFrameworks/WebKit.framework/WebKit"]
        for path in paths {
            let handle = dlopen(path, RTLD_NOW)
            print("[engines] dlopen \(path): \(handle != nil ? "ok" : String(cString: dlerror()))")
        }
        for name in ["WKWebView", "WKWebViewConfiguration", "UIWebView", "WebView"] {
            print("[engines] \(name): \(NSClassFromString(name) != nil)")
        }
    }
}
#endif
