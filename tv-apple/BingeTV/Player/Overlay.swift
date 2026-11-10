import SwiftUI
import UIKit

// A second window above the app (and above any full-screen player) for the
// corner game and game-alert banners. It never takes input or focus, so the
// remote keeps driving whatever is underneath.

@MainActor
final class PiPController: ObservableObject {
    static let shared = PiPController()

    @Published private(set) var tile: MultiviewTile?
    // Full-screen players currently open; the corner game is muted while
    // something else is playing.
    @Published private(set) var otherPlayback = 0 {
        didSet { tile?.audible = otherPlayback == 0 }
    }

    var game: SportGame? { tile?.game }
    var isPlayerOpen: Bool { otherPlayback > 0 }

    // A movie or episode in the corner (only one thing plays there).
    @Published private(set) var episode: CornerEpisode?

    func showEpisode(_ next: CornerEpisode) {
        tile?.stop()
        tile = nil
        episode?.stop()
        episode = next
    }

    func closeEpisode() {
        episode?.stop()
        episode = nil
    }

    // Back to full screen: the corner's stream is parked for the player to
    // pick up (Warmup.take), so it carries on without reloading.
    func fullScreenEpisode() -> PlayRequest? {
        guard let episode else { return nil }
        self.episode = nil
        return episode.handBack()
    }

    func show(_ game: SportGame) {
        closeEpisode()
        tile?.stop()
        let fresh = MultiviewTile(game: game)
        tile = fresh
        fresh.audible = otherPlayback == 0
        Task { await fresh.start(streamsPerTile: 3) }
    }

    func close() {
        tile?.stop()
        tile = nil
    }

    func playerOpened() {
        otherPlayback += 1
        episode?.setPaused(true) // two videos with sound at once is never wanted
    }
    func playerClosed() { otherPlayback = max(0, otherPlayback - 1) }
}

enum OverlayWindow {
    private static var window: UIWindow?

    @MainActor
    static func install() {
        guard window == nil,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let host = UIHostingController(rootView: OverlayRoot())
        host.view.backgroundColor = .clear
        let overlay = UIWindow(windowScene: scene)
        overlay.windowLevel = .normal + 1
        overlay.rootViewController = host
        overlay.backgroundColor = .clear
        overlay.isUserInteractionEnabled = false
        overlay.isHidden = false
        window = overlay
    }
}

private struct OverlayRoot: View {
    @ObservedObject private var pip = PiPController.shared
    @ObservedObject private var teams = TeamCenter.shared

    var body: some View {
        ZStack {
            Color.clear
            if let episode = pip.episode {
                CornerEpisodeTile(episode: episode)
                    .frame(width: 576, height: 324)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(.trailing, 60)
                    .padding(.bottom, 50)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
            if let tile = pip.tile {
                CornerTile(tile: tile)
                    .frame(width: 576, height: 324)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(.trailing, 60)
                    .padding(.bottom, 50)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
            if let alert = teams.banner {
                HStack(spacing: 18) {
                    Image(systemName: "sportscourt.fill").font(.title2)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(alert.headline).font(.headline).lineLimit(1)
                        Text(alert.detail + " · Swipe down in the player or open Sports to watch")
                            .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                }
                .padding(.horizontal, 30)
                .padding(.vertical, 20)
                .background(Theme.surface.opacity(0.96), in: RoundedRectangle(cornerRadius: 22))
                .shadow(color: .black.opacity(0.5), radius: 20, y: 10)
                .frame(maxWidth: 1100)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .padding(.top, 50)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.3), value: teams.banner)
        .animation(.easeInOut(duration: 0.3), value: pip.tile?.id)
        .animation(.easeInOut(duration: 0.3), value: pip.episode?.id)
    }
}

private struct CornerTile: View {
    @ObservedObject var tile: MultiviewTile

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            CornerSurface(tile: tile)
            if !tile.started {
                VStack(spacing: 10) {
                    ProgressView()
                    Text(tile.status).font(.caption)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack(spacing: 10) {
                Circle().fill(Color(hex: 0xFF5A50)).frame(width: 10, height: 10)
                Text(tile.game.title).font(.caption.weight(.bold)).lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: tile.audible ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    .font(.caption)
                    .foregroundStyle(tile.audible ? Theme.gold : Theme.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom))
        }
        .background(.black)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.white.opacity(0.25), lineWidth: 2))
        .shadow(color: .black.opacity(0.6), radius: 24, y: 12)
    }
}

private struct CornerSurface: UIViewRepresentable {
    let tile: MultiviewTile
    func makeUIView(context: Context) -> UIView { tile.surface }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

// A movie or episode playing in the corner: the player's own stream, moved
// here (no reload), with sound. Progress keeps saving; it closes itself at
// the end. Full screen hands it back to the player through Warmup.park.
@MainActor
final class CornerEpisode: ObservableObject, Identifiable {
    let id = UUID()
    let request: PlayRequest
    let surface = UIView()
    @Published private(set) var t: Double
    @Published private(set) var d: Double
    @Published private(set) var paused = false
    private var race: StreamRace?
    private weak var app: AppModel?
    private var timer: Timer?
    private var lastSaved = Date()
    private var resignObserver: NSObjectProtocol?

    var label: String {
        request.title.name + (request.title.kind == .tvShow ? " · S\(request.season ?? 1):E\(request.episode ?? 1)" : "")
    }

    init(race: StreamRace, request: PlayRequest, app: AppModel, at: Double, duration: Double) {
        self.race = race
        self.request = request
        self.app = app
        t = at
        d = duration
        surface.backgroundColor = .black
        surface.clipsToBounds = true
        race.container.frame = surface.bounds
        race.container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        surface.addSubview(race.container)
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        // Leaving the app pauses it, as the full player does.
        resignObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.setPaused(true) }
        }
    }

    private func tick() {
        guard let web = race?.winner?.web else { return }
        web.poll { [weak self] state in
            guard let self, let state else { return }
            self.t = state.t
            if state.d > 0 { self.d = state.d }
            self.paused = state.paused
            if Date().timeIntervalSince(self.lastSaved) > 30 { self.save() }
            if state.ended || (state.d > 120 && state.d - state.t < 2) { PiPController.shared.closeEpisode() }
        }
    }

    func setPaused(_ pause: Bool) {
        guard let web = race?.winner?.web else { return }
        web.send(pause ? .pause : .play)
        paused = pause
    }

    private func save() {
        lastSaved = Date()
        guard let app, d > 0, t > 0 else { return }
        let (request, t, d) = (request, t, d)
        Task { await app.saveProgress(title: request.title, season: request.season, episode: request.episode, position: t, duration: d) }
    }

    func handBack() -> PlayRequest {
        timer?.invalidate()
        save()
        if let race {
            race.container.removeFromSuperview()
            Warmup.shared.park(race)
        }
        race = nil
        var back = request
        back.startAt = t
        return back
    }

    func stop() {
        timer?.invalidate()
        if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
        save()
        race?.stop()
        race?.container.removeFromSuperview()
        race = nil
    }
}

private struct CornerEpisodeTile: View {
    @ObservedObject var episode: CornerEpisode

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            CornerEpisodeSurface(view: episode.surface)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: episode.paused ? "pause.fill" : "play.fill").font(.caption)
                    Text(episode.label).font(.caption.weight(.bold)).lineLimit(1)
                }
                if episode.d > 0 {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.25))
                            Capsule().fill(Theme.gold).frame(width: proxy.size.width * min(1, episode.t / episode.d))
                        }
                    }
                    .frame(height: 5)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom))
        }
        .background(.black)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.white.opacity(0.25), lineWidth: 2))
        .shadow(color: .black.opacity(0.6), radius: 24, y: 12)
    }
}

private struct CornerEpisodeSurface: UIViewRepresentable {
    let view: UIView
    func makeUIView(context: Context) -> UIView { view }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
