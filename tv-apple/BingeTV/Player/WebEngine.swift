import UIKit
import ObjectiveC

// tvOS ships WebKit but leaves it out of the public SDK, so the classes are
// reached through the Objective-C runtime. Fine for a sideloaded app; App
// Review would reject it. The server's own player page loads top-level,
// exactly like the website's iframe.

struct MediaTrack: Equatable, Identifiable {
    let index: Int
    let label: String
    let language: String
    let on: Bool
    var id: Int { index }
}

struct MediaState: Decodable, Equatable {
    var t: Double = 0
    var d: Double = 0       // 0 for live streams (infinite duration)
    var paused = true
    var ended = false
    var ready: Int = 0      // HTMLMediaElement.readyState
    var video = false
    var height: Int = 0     // videoHeight: what resolution is actually showing
    var audio: [MediaTrack] = []
    var text: [MediaTrack] = []

    enum CodingKeys: String, CodingKey { case t, d, paused, ended, ready, video }
}

enum MediaCommand {
    case play, pause, toggle, mute, unmute, seekBy(Double), seekTo(Double), stop
    // Pin the video (and every frame it sits in) to the whole screen.
    case fill, unfill
    // Choose an audio track / subtitle track (-1 = subtitles off).
    case audioTrack(Int), textTrack(Int)

    var js: String {
        switch self {
        case .play: return "play"
        case .pause: return "pause"
        case .toggle: return "toggle"
        case .mute: return "mute"
        case .unmute: return "unmute"
        case .seekBy(let s): return "seekBy:\(s)"
        case .seekTo(let s): return "seekTo:\(s)"
        case .stop: return "stop"
        case .fill: return "fill"
        case .unfill: return "unfill"
        case .audioTrack(let i): return "audio:\(i)"
        case .textTrack(let i): return "text:\(i)"
        }
    }
}

@MainActor
protocol WebEngine: AnyObject {
    var view: UIView { get }
    // The legacy engine crashes inside WebKit when a video seeks.
    var canSeek: Bool { get }
    func load(_ url: URL)
    func setAllowedHost(_ host: String?)
    // The page's main video, wherever it lives (nested iframes included).
    func poll(_ completion: @escaping (MediaState?) -> Void)
    func send(_ command: MediaCommand)
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

    // Runs in every frame. Each frame with a video reports it to the app;
    // commands arrive at the top frame and are relayed down to every child
    // frame (cross-origin included) with postMessage.
    static let bridgeScript = """
    (function(){
      if (window.__bingeBridge) return; window.__bingeBridge = true;
      function pick(){ var vs=document.getElementsByTagName('video'), best=null;
        for (var i=0;i<vs.length;i++){ var v=vs[i]; if(!best || v.readyState>best.readyState || (v.duration||0)>(best.duration||0)) best=v; }
        return best; }
      function tracks(v){ var a=[], x=[], i;
        if (v.audioTracks) for (i=0;i<v.audioTracks.length;i++){ var at=v.audioTracks[i]; a.push({i:i, l:at.label||'', g:at.language||'', on:!!at.enabled}); }
        if (v.textTracks) for (i=0;i<v.textTracks.length;i++){ var tt=v.textTracks[i]; if(tt.kind==='subtitles'||tt.kind==='captions') x.push({i:i, l:tt.label||'', g:tt.language||'', on:tt.mode==='showing'}); }
        return {a:a, x:x}; }
      function state(v){ var tr=tracks(v); return {t:v.currentTime||0, d:isFinite(v.duration)?v.duration:0, paused:v.paused, ended:v.ended, ready:v.readyState, video:true, h:v.videoHeight||0, at:tr.a, tt:tr.x}; }
      // Fill: pin this frame's video to the viewport, then ask each parent
      // frame to pin the iframe it lives in, all the way up, so the video
      // covers the whole screen instead of the server's page layout.
      var FILL_CSS='html.__bf,html.__bf body{background:#000!important;overflow:hidden!important;margin:0!important}'+
        '.__bf-el{position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:100vw!important;height:100vh!important;'+
        'max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;'+
        'border-radius:0!important;transform:none!important;z-index:2147483647!important;background:#000!important;visibility:visible!important}'+
        'video.__bf-el{object-fit:contain!important}'+
        // Everything else on the server's page (its own buttons, menus, ads)
        // is hidden: the remote can't reach it anyway. The video's own
        // subtitle tracks still render inside the video.
        'html.__bf body *:not(.__bf-el):not(:has(.__bf-el)){visibility:hidden!important}';
      function pin(el){ if(!document.getElementById('__bf-style')){ var st=document.createElement('style'); st.id='__bf-style'; st.textContent=FILL_CSS; (document.head||document.documentElement).appendChild(st); }
        document.documentElement.classList.add('__bf'); el.classList.add('__bf-el');
        try{ window.scrollTo(0,0); }catch(e){}
        // A transformed ancestor would trap position:fixed inside it.
        for (var a=el.parentElement; a && a!==document.documentElement; a=a.parentElement){ a.style.setProperty('transform','none','important'); a.style.setProperty('filter','none','important'); a.style.setProperty('contain','none','important'); }
        if (window.parent !== window) { try{ window.parent.postMessage({__bingeFillUp:true},'*'); }catch(e){} } }
      function unpin(){ document.documentElement.classList.remove('__bf'); var els=document.querySelectorAll('.__bf-el'); for (var i=0;i<els.length;i++) els[i].classList.remove('__bf-el'); }
      window.addEventListener('message', function(e){ if(!(e.data && e.data.__bingeFillUp)) return;
        var fs=document.getElementsByTagName('iframe'); for (var i=0;i<fs.length;i++){ if(fs[i].contentWindow===e.source){ pin(fs[i]); break; } } });
      function apply(cmd){
        if(cmd==='unfill'){ unpin(); return; }
        var v=pick(); if(!v) return; var p;
        if(cmd==='fill'){ if(v.readyState>0 || v.duration>0) pin(v); return; }
        if(cmd.indexOf('audio:')===0){ var ai=parseInt(cmd.slice(6),10); if(v.audioTracks) for (var k=0;k<v.audioTracks.length;k++) v.audioTracks[k].enabled=(k===ai); return; }
        if(cmd.indexOf('text:')===0){ var ti=parseInt(cmd.slice(5),10); if(v.textTracks) for (var j=0;j<v.textTracks.length;j++){ var t2=v.textTracks[j]; if(t2.kind==='subtitles'||t2.kind==='captions') t2.mode=(j===ti?'showing':'disabled'); } return; }
        if(cmd==='play'){ p=v.play(); } else if(cmd==='pause'){ v.pause(); }
        else if(cmd==='toggle'){ if(v.paused){p=v.play()} else {v.pause()} }
        else if(cmd==='mute'){ v.muted=true; } else if(cmd==='unmute'){ v.muted=false; }
        else if(cmd==='stop'){ v.pause(); v.muted=true; }
        else if(cmd.indexOf('seekBy:')===0){ var x=parseFloat(cmd.slice(7)); v.currentTime=Math.max(0,Math.min((isFinite(v.duration)?v.duration:1e9)-1,v.currentTime+x)); }
        else if(cmd.indexOf('seekTo:')===0){ v.currentTime=parseFloat(cmd.slice(7)); }
        if(p&&p.catch) p.catch(function(){}); }
      function relay(cmd){ apply(cmd); for (var i=0;i<window.frames.length;i++){ try{ window.frames[i].postMessage({__binge:cmd},'*'); }catch(e){} } }
      window.__bingeRun = relay;
      window.addEventListener('message', function(e){ if(e.data && e.data.__binge) relay(e.data.__binge); });
      setInterval(function(){ var v=pick(); if(!v) return;
        try{ window.webkit.messageHandlers.binge.postMessage(state(v)); }catch(e){} }, 400);
    })();
    """
}

// Receives the bridge's messages without the content controller retaining
// the web view's owner.
private final class BridgeProxy: NSObject {
    weak var target: ModernWebView?

    static func tracks(_ value: Any?) -> [MediaTrack] {
        (value as? [[String: Any]] ?? []).compactMap { item in
            guard let index = (item["i"] as? NSNumber)?.intValue else { return nil }
            return MediaTrack(index: index, label: item["l"] as? String ?? "", language: item["g"] as? String ?? "",
                              on: (item["on"] as? NSNumber)?.boolValue ?? false)
        }
    }

    @objc(userContentController:didReceiveScriptMessage:)
    func userContentController(_ controller: NSObject, didReceive message: NSObject) {
        guard let body = message.value(forKey: "body") as? [String: Any] else { return }
        let state = MediaState(
            t: (body["t"] as? NSNumber)?.doubleValue ?? 0,
            d: (body["d"] as? NSNumber)?.doubleValue ?? 0,
            paused: (body["paused"] as? NSNumber)?.boolValue ?? true,
            ended: (body["ended"] as? NSNumber)?.boolValue ?? false,
            ready: (body["ready"] as? NSNumber)?.intValue ?? 0,
            video: true,
            height: (body["h"] as? NSNumber)?.intValue ?? 0,
            audio: Self.tracks(body["at"]),
            text: Self.tracks(body["tt"])
        )
        MainActor.assumeIsolated { target?.receive(state) }
    }
}

@MainActor
final class ModernWebView: NSObject, WebEngine {
    let view: UIView
    let canSeek = true
    private var allowedHost: String?
    private let proxy = BridgeProxy()
    private var contentController: NSObject?
    // Several frames may have a <video> (ads, previews). The main one is the
    // one that has made the most progress recently.
    private var latest: MediaState?
    private var latestAt = Date.distantPast

    nonisolated static var isAvailable: Bool {
        _ = loaded
        return NSClassFromString("WKWebView") != nil
    }

    private nonisolated static let loaded: Bool = {
        guard dlopen("/System/Library/Frameworks/WebKit.framework/WebKit", RTLD_NOW) != nil else { return false }
        if let proto = objc_getProtocol("WKScriptMessageHandler") { class_addProtocol(BridgeProxy.self, proto) }
        return true
    }()

    // A WKWebView subclass that reports no safe area. On a real Apple TV the
    // overscan safe area otherwise shifts the page (fixed-position video
    // lands offset toward the bottom-right with the edge cut off).
    private static let webClass: UIView.Type? = {
        guard let base = NSClassFromString("WKWebView") else { return nil }
        if let existing = NSClassFromString("BingeWKWebView") as? UIView.Type { return existing }
        guard let subclass = objc_allocateClassPair(base, "BingeWKWebView", 0) else { return base as? UIView.Type }
        let selector = #selector(getter: UIView.safeAreaInsets)
        let block: @convention(block) (AnyObject) -> UIEdgeInsets = { _ in .zero }
        if let method = class_getInstanceMethod(UIView.self, selector) {
            class_addMethod(subclass, selector, imp_implementationWithBlock(block), method_getTypeEncoding(method))
        }
        objc_registerClassPair(subclass)
        return subclass as? UIView.Type
    }()

    // Mutes the whole page in WebKit itself (every frame, every video),
    // which page scripts can't override. _WKMediaMutedState: 1 = audio.
    private func setPageMuted(_ muted: Bool) {
        let selector = NSSelectorFromString("_setPageMuted:")
        guard let method = class_getInstanceMethod(type(of: view), selector) else { return }
        typealias MuteFn = @convention(c) (AnyObject, Selector, UInt) -> Void
        unsafeBitCast(method_getImplementation(method), to: MuteFn.self)(view, selector, muted ? 1 : 0)
    }

    init?(allowedHost: String?) {
        guard Self.isAvailable,
              let webClass = Self.webClass,
              let configClass = NSClassFromString("WKWebViewConfiguration") as? NSObject.Type,
              let scriptClass = NSClassFromString("WKUserScript") as? NSObject.Type else { return nil }

        let config = configClass.init()
        config.setValue(true, forKey: "allowsInlineMediaPlayback")
        config.setValue(0, forKey: "mediaTypesRequiringUserActionForPlayback") // autoplay with sound
        if let prefs = config.value(forKey: "preferences") as? NSObject {
            prefs.setValue(false, forKey: "javaScriptCanOpenWindowsAutomatically")
        }

        // The bridge, in every frame: [[WKUserScript alloc] initWithSource:injectionTime:forMainFrameOnly:]
        let scriptInit = NSSelectorFromString("initWithSource:injectionTime:forMainFrameOnly:")
        let controller = config.value(forKey: "userContentController") as? NSObject
        if let method = class_getInstanceMethod(scriptClass, scriptInit), let controller {
            typealias ScriptInit = @convention(c) (AnyObject, Selector, NSString, Int, Bool) -> NSObject
            let make = unsafeBitCast(method_getImplementation(method), to: ScriptInit.self)
            let allocated = (scriptClass as AnyObject).perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
            let script = make(allocated, scriptInit, WebEngines.bridgeScript as NSString, 1, false) // atDocumentEnd, all frames
            _ = controller.perform(NSSelectorFromString("addUserScript:"), with: script)
            _ = controller.perform(NSSelectorFromString("addScriptMessageHandler:name:"), with: proxy, with: "binge" as NSString)
        }

        // [[WKWebView alloc] initWithFrame:configuration:]
        let initSelector = NSSelectorFromString("initWithFrame:configuration:")
        guard let method = class_getInstanceMethod(webClass, initSelector) else { return nil }
        typealias InitFn = @convention(c) (AnyObject, Selector, CGRect, AnyObject) -> UIView
        let initFn = unsafeBitCast(method_getImplementation(method), to: InitFn.self)
        let allocated = (webClass as AnyObject).perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
        view = initFn(allocated, initSelector, CGRect(x: 0, y: 0, width: 1920, height: 1080), config)

        self.allowedHost = allowedHost
        contentController = controller
        super.init()
        proxy.target = self
        view.backgroundColor = .black
        view.isOpaque = true
        view.setValue(self, forKey: "navigationDelegate")
        view.setValue(self, forKey: "UIDelegate")
        if let scroll = view.value(forKey: "scrollView") as? UIScrollView {
            scroll.isScrollEnabled = false
            // tvOS safe-area insets would otherwise inset the page itself,
            // leaving a black border around the video.
            scroll.contentInsetAdjustmentBehavior = .never
            scroll.contentInset = .zero
        }
        view.insetsLayoutMarginsFromSafeArea = false
        // Silent until something deliberately unmutes it (race contenders,
        // warm preloads and background tiles never make sound).
        setPageMuted(true)
    }

    deinit {
        let web = view
        let controller = contentController
        Task { @MainActor in
            _ = controller?.perform(NSSelectorFromString("removeScriptMessageHandlerForName:"), with: "binge" as NSString)
            web.setValue(nil, forKey: "navigationDelegate")
            web.setValue(nil, forKey: "UIDelegate")
        }
    }

    fileprivate func receive(_ state: MediaState) {
        // Prefer whichever frame's video is further along / actually playing.
        if let latest, Date().timeIntervalSince(latestAt) < 1.5,
           state.ready < latest.ready || (latest.t > state.t + 1 && !latest.paused) {
            return
        }
        latest = state
        latestAt = Date()
    }

    func setAllowedHost(_ host: String?) { allowedHost = host }

    func load(_ url: URL) {
        latest = nil
        var request = URLRequest(url: url)
        request.setValue("https://\(Config.siteHost)/", forHTTPHeaderField: "Referer")
        _ = view.perform(NSSelectorFromString("loadRequest:"), with: request as NSURLRequest)
    }

    func poll(_ completion: @escaping (MediaState?) -> Void) {
        completion(Date().timeIntervalSince(latestAt) < 3 ? latest : nil)
    }

    func send(_ command: MediaCommand) {
        switch command {
        case .mute, .stop: setPageMuted(true)
        case .unmute: setPageMuted(false)
        default: break
        }
        evaluate("window.__bingeRun && window.__bingeRun('\(command.js)')", nil)
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

    // The page's web process died (usually memory pressure on the Apple
    // TV). Drop the last state right away so the player notices and moves
    // on instead of waiting on a frozen frame.
    @objc(webViewWebContentProcessDidTerminate:)
    func webViewWebContentProcessDidTerminate(_ webView: UIView) {
        latest = nil
        latestAt = .distantPast
        #if DEBUG
        print("[web] content process terminated")
        #endif
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

    // Top-level <video> only (the legacy engine can't reach into frames).
    func poll(_ completion: @escaping (MediaState?) -> Void) {
        let json = run("""
        (function(){var v=document.querySelector('video');if(!v)return '';
        return JSON.stringify({t:v.currentTime||0,d:isFinite(v.duration)?v.duration:0,paused:v.paused,ended:v.ended,ready:v.readyState,video:true})})()
        """)
        completion(json.flatMap { $0.data(using: .utf8) }.flatMap { try? JSONDecoder().decode(MediaState.self, from: $0) })
    }

    func send(_ command: MediaCommand) {
        let body: String
        switch command {
        case .play: body = "var p=v.play(); if(p&&p.catch)p.catch(function(){})"
        case .pause, .stop: body = "v.pause()"
        case .toggle: body = "if(v.paused){var p=v.play(); if(p&&p.catch)p.catch(function(){})} else {v.pause()}"
        case .mute: body = "v.muted=true"
        case .unmute: body = "v.muted=false"
        case .seekBy, .seekTo: return // crashes WebKit's legacy engine
        case .fill: body = "v.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;object-fit:contain;z-index:2147483646;background:#000'"
        case .unfill: body = "v.style.cssText=''"
        case .audioTrack(let i): body = "if(v.audioTracks){for(var k=0;k<v.audioTracks.length;k++){v.audioTracks[k].enabled=(k===\(i))}}"
        case .textTrack(let i): body = "if(v.textTracks){for(var k=0;k<v.textTracks.length;k++){v.textTracks[k].mode=(k===\(i)?'showing':'disabled')}}"
        }
        run("(function(){var v=document.querySelector('video'); if(v){\(body)}})()")
    }
}
