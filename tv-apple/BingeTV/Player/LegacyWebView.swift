import UIKit

// Fallback engine: WebKit's legacy UIWebView (also private on tvOS). Plays
// fine, but any seek crashes inside WebKit (its seek completion runs off
// the web thread), so the player never seeks with it. See WebEngine.swift.
@MainActor
final class LegacyWebView: NSObject {
    let view: UIView
    private var allowedHost: String?
    var onLoad: (() -> Void)?

    func setAllowedHost(_ host: String?) { allowedHost = host }

    nonisolated static var isAvailable: Bool { NSClassFromString("UIWebView") != nil }

    init?(allowedHost: String?) {
        guard let type = NSClassFromString("UIWebView") as? UIView.Type else { return nil }
        view = type.init(frame: .zero)
        self.allowedHost = allowedHost
        super.init()
        view.backgroundColor = .black
        view.isOpaque = true
        view.setValue(false, forKey: "mediaPlaybackRequiresUserAction")
        view.setValue(true, forKey: "allowsInlineMediaPlayback")
        view.setValue(true, forKey: "scalesPageToFit")
        view.setValue(self, forKey: "delegate")
    }

    deinit {
        let web = view
        Task { @MainActor in web.setValue(nil, forKey: "delegate") }
    }

    func load(_ url: URL) {
        var request = URLRequest(url: url)
        request.setValue("https://\(Config.siteHost)/", forHTTPHeaderField: "Referer")
        _ = view.perform(NSSelectorFromString("loadRequest:"), with: request as NSURLRequest)
    }

    @discardableResult
    func run(_ script: String) -> String? {
        view.perform(NSSelectorFromString("stringByEvaluatingJavaScriptFromString:"), with: script)?
            .takeUnretainedValue() as? String
    }

    // MARK: UIWebViewDelegate (called by selector)

    // Keep the top-level page on the server's own site: ad scripts love to
    // redirect the whole page. Frames inside it may load anything.
    @objc(webView:shouldStartLoadWithRequest:navigationType:)
    func webView(_ webView: UIView, shouldStartLoadWith request: URLRequest, navigationType: Int) -> Bool {
        guard let url = request.url, let host = url.host else { return true }
        let isMainFrame = request.mainDocumentURL == nil || request.mainDocumentURL == url
        guard isMainFrame, let allowedHost else { return true }
        return host == allowedHost || host.hasSuffix("." + allowedHost) || allowedHost.hasSuffix("." + host)
    }

    @objc(webViewDidFinishLoad:)
    func webViewDidFinishLoad(_ webView: UIView) {
        onLoad?()
    }
}
