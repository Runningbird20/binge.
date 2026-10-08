import UIKit
import ObjectiveC

// tvOS ships WebKit but leaves it out of the public SDK, so the classes are
// reached through the Objective-C runtime. Fine for a sideloaded app; App
// Review would reject it. The server's own player page loads top-level,
// exactly like the website's iframe.
@MainActor
protocol WebEngine: AnyObject {
    var view: UIView { get }
    // The legacy engine crashes inside WebKit when a video seeks.
    var canSeek: Bool { get }
    func load(_ url: URL)
    func setAllowedHost(_ host: String?)
    // Runs a script in the page; the result comes back as a string.
    func evaluate(_ script: String, _ completion: ((String?) -> Void)?)
}

enum WebEngines {
    // The modern engine (WKWebView: separate process, current media stack)
    // is preferred. The legacy one crashes inside WebKit whenever a video
    // seeks, so it is only a fallback.
    @MainActor
    static func make(allowedHost: String?) -> WebEngine? {
        if let modern = ModernWebView(allowedHost: allowedHost) { return modern }
        return LegacyWebView(allowedHost: allowedHost)
    }

    static var isAvailable: Bool {
        ModernWebView.isAvailable || LegacyWebView.isAvailable
    }
}

@MainActor
final class ModernWebView: NSObject, WebEngine {
    let view: UIView
    let canSeek = true
    private var allowedHost: String?

    nonisolated static var isAvailable: Bool {
        _ = loaded
        return NSClassFromString("WKWebView") != nil
    }

    private nonisolated static let loaded: Bool = {
        dlopen("/System/Library/Frameworks/WebKit.framework/WebKit", RTLD_NOW) != nil
    }()

    init?(allowedHost: String?) {
        guard Self.isAvailable,
              let webClass = NSClassFromString("WKWebView") as? UIView.Type,
              let configClass = NSClassFromString("WKWebViewConfiguration") as? NSObject.Type else { return nil }

        let config = configClass.init()
        config.setValue(true, forKey: "allowsInlineMediaPlayback")
        config.setValue(0, forKey: "mediaTypesRequiringUserActionForPlayback") // autoplay with sound
        if let prefs = config.value(forKey: "preferences") as? NSObject {
            prefs.setValue(false, forKey: "javaScriptCanOpenWindowsAutomatically")
        }

        // [[WKWebView alloc] initWithFrame:configuration:]
        let initSelector = NSSelectorFromString("initWithFrame:configuration:")
        guard let method = class_getInstanceMethod(webClass, initSelector) else { return nil }
        typealias InitFn = @convention(c) (AnyObject, Selector, CGRect, AnyObject) -> UIView
        let initFn = unsafeBitCast(method_getImplementation(method), to: InitFn.self)
        let allocated = (webClass as AnyObject).perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
        view = initFn(allocated, initSelector, CGRect(x: 0, y: 0, width: 1920, height: 1080), config)

        self.allowedHost = allowedHost
        super.init()
        view.backgroundColor = .black
        view.isOpaque = true
        view.setValue(self, forKey: "navigationDelegate")
        view.setValue(self, forKey: "UIDelegate")
        if let scroll = view.value(forKey: "scrollView") as? UIScrollView { scroll.isScrollEnabled = false }
    }

    deinit {
        let web = view
        Task { @MainActor in
            web.setValue(nil, forKey: "navigationDelegate")
            web.setValue(nil, forKey: "UIDelegate")
        }
    }

    func setAllowedHost(_ host: String?) { allowedHost = host }

    func load(_ url: URL) {
        var request = URLRequest(url: url)
        request.setValue("https://\(Config.siteHost)/", forHTTPHeaderField: "Referer")
        _ = view.perform(NSSelectorFromString("loadRequest:"), with: request as NSURLRequest)
    }

    func evaluate(_ script: String, _ completion: ((String?) -> Void)?) {
        let handler: @convention(block) (AnyObject?, NSError?) -> Void = { result, _ in
            let text: String?
            switch result {
            case let string as String: text = string
            case let number as NSNumber: text = number.stringValue
            default: text = nil
            }
            completion?(text)
        }
        _ = view.perform(NSSelectorFromString("evaluateJavaScript:completionHandler:"), with: script, with: handler)
    }

    // MARK: WKNavigationDelegate (called by selector)

    // Keep the top-level page on the server's own site (ad scripts love to
    // redirect it). Frames inside it may load anything.
    @objc(webView:decidePolicyForNavigationAction:decisionHandler:)
    func webView(_ webView: UIView, decidePolicyFor action: NSObject, decisionHandler: @escaping @convention(block) (Int) -> Void) {
        let request = action.value(forKey: "request") as? URLRequest
        let targetFrame = action.value(forKey: "targetFrame") as? NSObject
        let isMainFrame = (targetFrame?.value(forKey: "mainFrame") as? Bool) ?? false
        guard isMainFrame, let host = request?.url?.host, let allowedHost,
              request?.url?.scheme?.hasPrefix("http") == true else {
            decisionHandler(1) // allow
            return
        }
        let ok = host == allowedHost || host.hasSuffix("." + allowedHost) || allowedHost.hasSuffix("." + host)
        decisionHandler(ok ? 1 : 0)
    }

    // MARK: WKUIDelegate — never open popup windows.
    @objc(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:)
    func webView(_ webView: UIView, createWith configuration: NSObject, for action: NSObject, windowFeatures: NSObject) -> UIView? {
        nil
    }
}

extension LegacyWebView: WebEngine {
    var canSeek: Bool { false }

    func evaluate(_ script: String, _ completion: ((String?) -> Void)?) {
        completion?(run(script))
    }
}
