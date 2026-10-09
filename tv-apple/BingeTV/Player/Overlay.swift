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

    func show(_ game: SportGame) {
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

    func playerOpened() { otherPlayback += 1 }
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
