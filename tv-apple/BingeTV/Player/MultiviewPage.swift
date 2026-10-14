import SwiftUI
import UIKit

// Multiview as one web page (the website's design): every game is an iframe
// in a single WKWebView, instead of one WKWebView per game. Each WKWebView is
// its own WebKit process; four of them (plus the servers being tried) ran a
// real Apple TV out of memory and restarted it. One page shares one process.
//
// The bridge still runs in every frame. Each game's frames report their video
// up to this page (postMessage to the top), which works out which iframe they
// belong to and passes the state on tagged with that game's slot; commands go
// down the same way to that iframe only.
@MainActor
final class MultiviewPage {
    let engine: ModernWebView
    private var slots: [String: Weak] = [:]
    private var ready = false
    private var queued: [String] = []

    private final class Weak { weak var slot: PageSlotEngine?; init(_ slot: PageSlotEngine) { self.slot = slot } }

    init?() {
        guard let engine = ModernWebView(allowedHost: Config.siteHost, multiview: true) else { return nil }
        self.engine = engine
        engine.view.backgroundColor = .clear
        engine.view.isOpaque = false
        engine.view.isUserInteractionEnabled = false
        engine.setMuted(false) // each game is muted on its own
        engine.onTileState = { [weak self] slot, state in self?.slots[slot]?.slot?.receive(state) }
        engine.loadHTML(Self.html, baseURL: URL(string: "https://\(Config.siteHost)/sports")!)
        waitUntilReady()
    }

    private func waitUntilReady(attempt: Int = 0) {
        engine.evaluate("typeof window.mvSet") { [weak self] result in
            guard let self else { return }
            if result == "function" {
                self.ready = true
                self.queued.forEach { self.engine.evaluate($0, nil) }
                self.queued = []
            } else if attempt < 50 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.waitUntilReady(attempt: attempt + 1) }
            }
        }
    }

    private func run(_ js: String) {
        if ready { engine.evaluate(js, nil) } else { queued.append(js) }
    }

    private static func quoted(_ text: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [text])) ?? Data("[\"\"]".utf8)
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }

    func makeSlot() -> PageSlotEngine {
        let slot = PageSlotEngine(page: self)
        slots[slot.id] = Weak(slot)
        return slot
    }

    func set(_ id: String, url: URL) { run("mvSet(\(Self.quoted(id)), \(Self.quoted(url.absoluteString)))") }

    func remove(_ id: String) {
        slots[id] = nil
        run("mvRemove(\(Self.quoted(id)))")
    }

    func send(_ id: String, _ command: MediaCommand) { run("mvSend(\(Self.quoted(id)), \(Self.quoted(command.js)))") }

    // Where each game's iframe sits (points = CSS px in this page).
    func layout(_ frames: [(slot: String, rect: CGRect, hidden: Bool)]) {
        let list = frames.map { "{id:\(Self.quoted($0.slot)),x:\(Int($0.rect.minX)),y:\(Int($0.rect.minY)),w:\(Int($0.rect.width)),h:\(Int($0.rect.height)),hidden:\($0.hidden)}" }
        run("mvLayout([\(list.joined(separator: ","))])")
    }

    static let html = """
    <!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>html,body{margin:0;background:transparent;overflow:hidden}iframe{position:absolute;border:0;background:#000}</style>
    </head><body><script>
    window.__bingeMultiviewPage = true;
    var tiles = {}, muted = {};
    function within(win, target, depth){
      if (win === target) return true;
      if (depth > 5) return false;
      try { for (var i = 0; i < win.frames.length; i++) if (within(win.frames[i], target, depth + 1)) return true; } catch (e) {}
      return false;
    }
    window.addEventListener('message', function(e){
      var d = e.data; if (!d || !d.__bingeState) return;
      for (var id in tiles) {
        if (tiles[id].contentWindow && within(tiles[id].contentWindow, e.source, 0)) {
          var s = d.__bingeState; s.tile = id;
          try { window.webkit.messageHandlers.bingeMulti.postMessage(s); } catch (err) {}
          return;
        }
      }
    });
    function post(id, cmd){ var f = tiles[id]; if (f && f.contentWindow) try { f.contentWindow.postMessage({__binge: cmd}, '*'); } catch (e) {} }
    window.mvSet = function(id, url){
      var f = tiles[id];
      if (!f) {
        f = document.createElement('iframe');
        f.setAttribute('allow', 'autoplay *; fullscreen *; encrypted-media *; picture-in-picture *');
        f.setAttribute('allowfullscreen', '');
        f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        f.setAttribute('scrolling', 'no');
        f.style.cssText = 'left:0;top:0;width:16px;height:9px;visibility:hidden';
        document.body.appendChild(f);
        tiles[id] = f;
        muted[id] = true;
      }
      if (f.src !== url) f.src = url;
    };
    window.mvRemove = function(id){
      var f = tiles[id]; if (!f) return;
      try { f.src = 'about:blank'; } catch (e) {}
      if (f.parentNode) f.parentNode.removeChild(f);
      delete tiles[id]; delete muted[id];
    };
    window.mvLayout = function(list){
      list.forEach(function(r){
        var f = tiles[r.id]; if (!f) return;
        f.style.cssText = 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px;' + (r.hidden ? 'visibility:hidden;' : '');
      });
    };
    window.mvSend = function(id, cmd){
      if (cmd === 'mute' || cmd === 'stop') muted[id] = true;
      if (cmd === 'unmute') muted[id] = false;
      post(id, cmd);
    };
    // Games start with sound by default; only the one being watched may have
    // it (tvOS pauses a video when another one starts making sound).
    setInterval(function(){ for (var id in tiles) if (muted[id]) post(id, 'mute'); }, 500);
    </script></body></html>
    """
}

// One game inside the shared page, standing in for a web view of its own so
// the race, the tile and its server picker work unchanged.
@MainActor
final class PageSlotEngine: WebEngine {
    let id = UUID().uuidString
    let view = UIView() // the page draws the video; nothing to show here
    let canSeek = true
    private weak var page: MultiviewPage?
    private var latest: MediaState?
    private var latestAt = Date.distantPast

    init(page: MultiviewPage) {
        self.page = page
        view.isUserInteractionEnabled = false
    }

    deinit {
        let id = self.id
        let page = self.page
        Task { @MainActor in page?.remove(id) }
    }

    func load(_ url: URL) {
        latest = nil
        if url.absoluteString == "about:blank" { page?.remove(id) } else { page?.set(id, url: url) }
    }

    func setAllowedHost(_ host: String?) {}

    func poll(_ completion: @escaping (MediaState?) -> Void) {
        completion(Date().timeIntervalSince(latestAt) < 3 ? latest : nil)
    }

    func send(_ command: MediaCommand) { page?.send(id, command) }

    // Several frames may have a <video> (ads, previews): keep the one furthest along.
    func receive(_ state: MediaState) {
        if let latest, Date().timeIntervalSince(latestAt) < 1.5,
           state.ready < latest.ready || (latest.t > state.t + 1 && !latest.paused) {
            return
        }
        latest = state
        latestAt = Date()
    }
}

// Settings › Playback › Multiview engine.
enum MultiviewEngine: String, CaseIterable, Identifiable {
    case page, separate
    static let key = "binge.multiviewEngine"
    var id: String { rawValue }
    var label: String { self == .page ? "One page (up to 4)" : "Separate pages (up to 2)" }
    static var current: MultiviewEngine { MultiviewEngine(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .page }
}

// The shared page, behind the tiles.
struct MultiviewPageSurface: UIViewRepresentable {
    let page: MultiviewPage
    func makeUIView(context: Context) -> UIView { page.engine.view }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
