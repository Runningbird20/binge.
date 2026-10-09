import SwiftUI

// Muted spotlight trailers, like the website's billboard: a YouTube embed
// in the (private) web engine, revealed only once it's really playing so
// YouTube's loading chrome never shows.
@MainActor
final class TrailerPlayer: ObservableObject {
    @Published private(set) var playing = false
    let surface = UIView()
    private var web: WebEngine?
    private var timer: Timer?

    init() {
        surface.backgroundColor = .clear
        surface.isUserInteractionEnabled = false
    }

    func start(_ title: Title) async {
        guard UserDefaults.standard.object(forKey: "binge.trailers") as? Bool ?? true,
              let tmdbId = title.tmdbId, web == nil else { return }
        struct Videos: Decodable {
            struct Video: Decodable { let key: String; let site: String; let type: String; let official: Bool? }
            let results: [Video]
        }
        guard let videos: Videos = try? await TMDB.shared.get("\(title.kind.tmdbPath)/\(tmdbId)/videos"),
              let video = videos.results.first(where: { $0.site == "YouTube" && $0.type == "Trailer" && $0.official == true })
                ?? videos.results.first(where: { $0.site == "YouTube" && $0.type == "Trailer" }) else { return }
        try? await Task.sleep(for: .seconds(2.5))
        guard !Task.isCancelled, let engine = WebEngines.make(allowedHost: "www.youtube-nocookie.com"), engine is ModernWebView else { return }
        web = engine
        engine.view.frame = surface.bounds
        engine.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        engine.view.isUserInteractionEnabled = false
        surface.addSubview(engine.view)
        var components = URLComponents(string: "https://www.youtube-nocookie.com/embed/\(video.key)")!
        components.queryItems = [
            "autoplay=1", "mute=1", "controls=0", "loop=1", "playlist=\(video.key)", "playsinline=1",
            "modestbranding=1", "rel=0", "iv_load_policy=3", "disablekb=1", "fs=0",
        ].map { pair in
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            return URLQueryItem(name: parts[0], value: parts[1])
        }
        engine.load(components.url!)
        var shownAt: Date?
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let web = self.web else { return }
                web.send(.mute)
                web.poll { state in
                    guard let state else { return }
                    if state.paused, state.ready >= 2 { web.send(.play) }
                    // A couple of seconds of real playback before revealing.
                    if state.t > 2, !state.paused {
                        if shownAt == nil { shownAt = Date() }
                        if !self.playing { self.playing = true }
                    }
                }
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        web?.send(.stop)
        web?.view.removeFromSuperview()
        web = nil
        playing = false
    }
}

struct TrailerLayer: UIViewRepresentable {
    let player: TrailerPlayer
    func makeUIView(context: Context) -> UIView { player.surface }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
