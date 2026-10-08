#if DEBUG
import SwiftUI

// -BingeProbe <url>: load a player page full screen and log what the page
// contains every 5s (used to check servers in the simulator).
struct DebugProbeView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> UIView {
        guard let web = LegacyWebView(allowedHost: url.host) else {
            print("[probe] UIWebView unavailable")
            return UIView()
        }
        context.coordinator.web = web
        web.load(url)
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
            let report = web.run("""
            (function(){var v=document.querySelector('video');var f=[].slice.call(document.querySelectorAll('iframe')).map(function(x){return (x.src||'').slice(0,80)});
            return JSON.stringify({title:document.title,host:location.host,video:!!v,t:v?v.currentTime:null,paused:v?v.paused:null,ready:v?v.readyState:null,src:v?(v.currentSrc||'').slice(0,60):null,iframes:f,mse:!!window.MediaSource,mms:!!window.ManagedMediaSource,hls:document.createElement('video').canPlayType('application/vnd.apple.mpegurl')})})()
            """)
            print("[probe] \(report ?? "nil")")
        }
        return web.view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var web: LegacyWebView? }
}
#endif
