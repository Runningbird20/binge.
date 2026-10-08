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
        // Time to first frame: same play() nudge the real player uses.
        Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { timer in MainActor.assumeIsolated {
            web.evaluate("(function(){var v=document.querySelector('video');if(!v)return -1;if(v.paused&&v.duration>0){var p=v.play();if(p&&p.catch)p.catch(function(){})}return v.currentTime})()") { value in
                let t = Double(value ?? "") ?? -1
                guard t > 0.5, !reported else { return }
                reported = true
                timer.invalidate()
                print("[probe] STARTED after \(String(format: "%.1f", Date().timeIntervalSince(began) - t))s")
                // -BingeProbeSeek <js>: try a seek 3s after it starts.
                if let seek = UserDefaults.standard.string(forKey: "BingeProbeSeek") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        print("[probe] seeking with: \(seek)")
                        web.evaluate("(function(){var v=document.querySelector('video');\(seek);return 'ok'})()", nil)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                            web.evaluate("document.querySelector('video').currentTime") { print("[probe] after seek t=\($0 ?? "nil")") }
                        }
                    }
                }
            }
        } }
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in MainActor.assumeIsolated {
            web.evaluate("""
            (function(){var v=document.querySelector('video');var f=[].slice.call(document.querySelectorAll('iframe')).map(function(x){return (x.src||'').slice(0,80)});
            return JSON.stringify({title:document.title,host:location.host,video:!!v,t:v?v.currentTime:null,paused:v?v.paused:null,ready:v?v.readyState:null,iframes:f,mse:!!window.MediaSource,mms:!!window.ManagedMediaSource})})()
            """) { print("[probe] \($0 ?? "nil")") }
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
