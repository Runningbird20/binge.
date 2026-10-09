import SwiftUI
import UIKit

// Ambient mode: after a few minutes with no remote input (outside the
// player), or a long pause inside it, the screen becomes a slow slideshow of
// artwork from your shows, with the next thing to watch one click away.
// Any swipe or Back leaves it.

@MainActor
final class AmbientStore: ObservableObject {
    static let shared = AmbientStore()

    // Art for the slideshow and the "click to resume" item, refreshed by Home.
    @Published var titles: [Title] = []
    @Published var resume: ContinueItem?
    @Published var showing = false

    static var idleSeconds: TimeInterval {
        #if DEBUG
        // -BingeAmbientAfter 10: start ambient mode after 10s (testing).
        let debug = UserDefaults.standard.double(forKey: "BingeAmbientAfter")
        if debug > 0 { return debug }
        #endif
        return 4 * 60
    }
    private var lastActivity = Date()
    private var timer: Timer?
    private var observer: NSObjectProtocol?

    func start() {
        guard timer == nil else { return }
        // Every swipe/selection that moves focus counts as activity.
        observer = NotificationCenter.default.addObserver(forName: UIFocusSystem.didUpdateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { AmbientStore.shared.lastActivity = Date() }
        }
        timer = Timer.scheduledTimer(withTimeInterval: min(15, Self.idleSeconds / 2), repeats: true) { _ in
            MainActor.assumeIsolated { AmbientStore.shared.check() }
        }
    }

    func touch() { lastActivity = Date() }

    private func check() {
        guard !showing, UserDefaults.standard.object(forKey: "binge.ambient") as? Bool ?? true,
              PiPController.shared.isPlayerOpen == false,
              !titles.isEmpty,
              Date().timeIntervalSince(lastActivity) > Self.idleSeconds else { return }
        showing = true
    }
}

struct AmbientView: View {
    let titles: [Title]
    let resumeLabel: String?
    let resume: () -> Void
    let dismiss: () -> Void

    @State private var index = 0
    @State private var zoom = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focused: Bool

    private var current: Title? { titles.isEmpty ? nil : titles[index % titles.count] }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.black.ignoresSafeArea()
            if let current, let art = TMDB.resized(current.backdrop, TMDB.fullScreen) ?? TMDB.resized(current.poster, TMDB.fullScreen) {
                AsyncImage(url: art) { image in
                    image.resizable().scaledToFill()
                } placeholder: { Color.black }
                .scaleEffect(zoom && !reduceMotion ? 1.12 : 1.0)
                .animation(reduceMotion ? nil : .linear(duration: 14), value: zoom)
                .id(current.id)
                .transition(.opacity)
                .ignoresSafeArea()
            }
            LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom).ignoresSafeArea()

            VStack(alignment: .leading, spacing: 18) {
                if let current { Text(current.name).font(.title2.weight(.bold)) }
                Button(action: resume) {
                    Label(resumeLabel ?? "Back to binge.", systemImage: resumeLabel == nil ? "house.fill" : "play.fill")
                }
                .focused($focused)
                Text("Swipe or press Back to leave").font(.caption).foregroundStyle(.white.opacity(0.6))
            }
            .padding(Theme.edge)
        }
        .onMoveCommand { _ in dismiss() }
        .onExitCommand { dismiss() }
        .onAppear { focused = true; zoom = true }
        .task {
            // A new picture every 14s, cross-faded.
            while !Task.isCancelled {
                // Fetch the next full-size picture during this one, so the
                // cross-fade lands on a ready image (URLCache serves it).
                if !titles.isEmpty, let next = TMDB.resized(titles[(index + 1) % titles.count].backdrop, TMDB.fullScreen) {
                    _ = try? await URLSession.shared.data(from: next)
                }
                try? await Task.sleep(for: .seconds(14))
                zoom = false
                withAnimation(.easeInOut(duration: 1.6)) { index += 1 }
                try? await Task.sleep(for: .milliseconds(50))
                zoom = true
            }
        }
    }
}
