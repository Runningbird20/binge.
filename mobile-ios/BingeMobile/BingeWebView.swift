import SwiftUI
import UIKit
import WebKit

// The site's background (theme_color in public/manifest.json), so nothing flashes white.
let bingeBackground = UIColor(red: 11 / 255, green: 13 / 255, blue: 18 / 255, alpha: 1)

// Which site the app shows, and whether it could be reached.
final class BingePage: ObservableObject {
    @Published var unreachable = false
    let home: URL
    weak var webView: WKWebView?

    init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "BingeSiteURL") as? String
        home = URL(string: configured ?? "").flatMap { $0.host == nil ? nil : $0 }
            ?? URL(string: "https://binge-26.vercel.app")!
    }

    var host: String { home.host?.lowercased() ?? "" }

    func isSite(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased(), !self.host.isEmpty else { return false }
        return host == self.host || host.hasSuffix("." + self.host)
    }

    func retry() {
        unreachable = false
        guard let webView else { return }
        if webView.url == nil { webView.load(URLRequest(url: home)) } else { webView.reload() }
    }
}

struct BingeWebView: UIViewRepresentable {
    let page: BingePage

    func makeCoordinator() -> BingeWebCoordinator { BingeWebCoordinator(page: page) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsPictureInPictureMediaPlayback = true
        config.preferences.isElementFullscreenEnabled = true // the players' full-screen buttons
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.applicationNameForUserAgent = BingeWebCoordinator.userAgentSuffix()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true // swipe from the edge to go back
        webView.isOpaque = false
        webView.backgroundColor = bingeBackground
        webView.scrollView.backgroundColor = bingeBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true } // Safari › Develop
        #endif
        page.webView = webView
        webView.load(URLRequest(url: page.home))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}

@MainActor
final class BingeWebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let page: BingePage
    private var downloads: [ObjectIdentifier: URL] = [:]

    init(page: BingePage) {
        self.page = page
    }

    // Safari's user-agent ending, plus BingeApp so the site can tell it's here: some
    // players refuse anything that looks like an app's web view (as on the TV apps).
    static func userAgentSuffix() -> String {
        let parts = UIDevice.current.systemVersion.split(separator: ".")
        let version = parts.count > 1 ? "\(parts[0]).\(parts[1])" : "\(parts.first ?? "17").0"
        return "Version/\(version) Mobile/15E148 Safari/604.1 BingeApp/1.0"
    }

    // MARK: Where pages may go

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        // The players and their frames load what they need. (No target frame: a new
        // window, which createWebViewWith decides.)
        guard navigationAction.targetFrame?.isMainFrame == true else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if page.isSite(url) || ["about", "blob", "data"].contains(scheme) {
            decisionHandler(.allow)
            return
        }
        // Leaving binge.: a link the viewer tapped on binge.'s own page opens in Safari (or
        // the app it belongs to). Anything else is refused: a page leaving by itself, or a
        // player's ad sending the whole app elsewhere, even on a tap.
        let source: WKFrameInfo? = navigationAction.sourceFrame
        if navigationAction.navigationType == .linkActivated, source?.isMainFrame == true, page.isSite(source?.request.url) {
            openOutside(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // A page the site sends that isn't one (a file) is saved instead of shown.
        decisionHandler(navigationResponse.isForMainFrame && !navigationResponse.canShowMIMEType ? .download : .allow)
    }

    // New windows (target=_blank, window.open). The players' ads open these; only
    // binge.'s own page may, and its links to other sites open in Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let source: WKFrameInfo? = navigationAction.sourceFrame
        guard let url = navigationAction.request.url, source?.isMainFrame == true, page.isSite(source?.request.url) else { return nil }
        if page.isSite(url) { webView.load(navigationAction.request) } else { openOutside(url) }
        return nil
    }

    private func openOutside(_ url: URL) {
        guard ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else { return }
        UIApplication.shared.open(url)
    }

    // MARK: Loading

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        page.unreachable = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        noteFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        noteFailure(error)
    }

    // The page's process died (usually memory): load it again instead of a blank screen.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // Only network failures mean "can't reach binge." (our own refusals and downloads
    // also end a navigation).
    private func noteFailure(_ error: Error) {
        let error = error as NSError
        guard error.domain == NSURLErrorDomain, error.code != NSURLErrorCancelled else { return }
        page.unreachable = true
    }

    // MARK: alert / confirm / prompt (the site's own; the players' ad traps are dropped)

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard isSiteFrame(frame), let presenter = topViewController() else { completionHandler(); return }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard isSiteFrame(frame), let presenter = topViewController() else { completionHandler(false); return }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard isSiteFrame(frame), let presenter = topViewController() else { completionHandler(nil); return }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in completionHandler(alert?.textFields?.first?.text ?? "") })
        presenter.present(alert, animated: true)
    }

    private func isSiteFrame(_ frame: WKFrameInfo) -> Bool {
        let host = frame.securityOrigin.host.lowercased()
        return !page.host.isEmpty && (host == page.host || host.hasSuffix("." + page.host))
    }

    // MARK: Files the site saves → share sheet (Save to Files, Calendar, AirDrop…)

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let destination = folder.appendingPathComponent(suggestedFilename.isEmpty ? "binge-file" : suggestedFilename)
        downloads[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share(file)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }

    private func share(_ file: URL) {
        guard let presenter = topViewController() else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController { // iPad
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 80, width: 1, height: 1)
        }
        presenter.present(sheet, animated: true)
    }

    private func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
