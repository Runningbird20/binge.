import AVFoundation
import SwiftUI
import UIKit

// Swipe to scrub: a swipe across the Siri Remote's touch surface moves a
// target along the timeline (each new swipe carries on from it), with a
// small picture of that moment; click jumps there, Back cancels, and
// letting go for a moment jumps too. Clicks on ◀ ▶ still skip 10s.

// The picture: a second, silent AVPlayer on the same stream at its lowest
// bitrate, seeked loosely (to a nearby keyframe) as the target moves. Only
// when Apple's player is playing the stream (a page's video can't be read).
@MainActor
final class ScrubPreview {
    private final class LayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    private let surface = LayerView()
    var view: UIView { surface }
    private let player: AVPlayer
    private var seeking = false
    private var pending: Double?

    init(stream: URL, page: String, agent: String) {
        let item = AVPlayerItem(asset: NativeEngine.asset(stream: stream, page: page, agent: agent))
        item.preferredPeakBitRate = 300_000
        item.preferredForwardBufferDuration = 2
        item.startsOnFirstEligibleVariant = true
        player = AVPlayer(playerItem: item)
        player.isMuted = true
        player.automaticallyWaitsToMinimizeStalling = false
        surface.backgroundColor = .black
        surface.playerLayer.player = player
        surface.playerLayer.videoGravity = .resizeAspect
    }

    func show(_ seconds: Double) {
        guard !seeking else { pending = seconds; return }
        seeking = true
        let slack = CMTime(seconds: 3, preferredTimescale: 600)
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: slack, toleranceAfter: slack) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.seeking = false
                if let next = self.pending { self.pending = nil; self.show(next) }
            }
        }
    }

    func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        surface.playerLayer.player = nil
    }
}

enum ScrubMath {
    // Seconds per point of swipe: a full swipe covers about a third of a
    // film, a little more of an episode; never slower than 0.1s a point.
    static func secondsPerPoint(duration: Double) -> Double { min(1.5, max(0.1, duration / 4000)) }

    static func target(base: Double, translation: Double, duration: Double) -> Double {
        min(max(0, base + translation * secondsPerPoint(duration: duration)), max(0, duration - 1))
    }

    static func clock(_ seconds: Double) -> String {
        let total = Int(max(0, seconds))
        let (h, m, s) = (total / 3600, total / 60 % 60, total % 60)
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

// Listens for horizontal swipes on the remote's touch surface (a pan on the
// window, indirect touches only) while the player is showing; vertical
// swipes and clicks are left to the rest of the player.
struct RemoteSwipeCatcher: UIViewRepresentable {
    let began: () -> Bool
    let changed: (CGFloat) -> Void
    let ended: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> CatcherView {
        let view = CatcherView()
        view.coordinator = context.coordinator
        view.isUserInteractionEnabled = false
        return view
    }
    func updateUIView(_ uiView: CatcherView, context: Context) { context.coordinator.parent = self }
    static func dismantleUIView(_ uiView: CatcherView, coordinator: Coordinator) { coordinator.detach() }

    final class CatcherView: UIView {
        weak var coordinator: Coordinator?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let window { coordinator?.attach(to: window) } else { coordinator?.detach() }
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: RemoteSwipeCatcher
        private var recognizer: UIPanGestureRecognizer?
        private var active = false

        init(_ parent: RemoteSwipeCatcher) { self.parent = parent }

        func attach(to window: UIWindow) {
            guard recognizer == nil else { return }
            let pan = UIPanGestureRecognizer(target: self, action: #selector(pan(_:)))
            pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirect.rawValue)]
            pan.cancelsTouchesInView = false
            pan.delegate = self
            window.addGestureRecognizer(pan)
            recognizer = pan
        }

        func detach() {
            if let recognizer { recognizer.view?.removeGestureRecognizer(recognizer) }
            recognizer = nil
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        @objc private func pan(_ pan: UIPanGestureRecognizer) {
            let move = pan.translation(in: pan.view)
            switch pan.state {
            case .began:
                let velocity = pan.velocity(in: pan.view)
                active = abs(velocity.x) > abs(velocity.y) * 1.3 && parent.began()
            case .changed:
                if active { parent.changed(move.x) }
            case .ended, .cancelled, .failed:
                if active { parent.ended() }
                active = false
            default: break
            }
        }
    }
}

// The scrub bar: the timeline with where you are and where you'd jump to,
// the picture there, and the time.
struct ScrubOverlay: View {
    @ObservedObject var model: PlayerModel

    var body: some View {
        if let target = model.scrubTarget, model.playback.d > 0 {
            let d = model.playback.d
            VStack(spacing: 0) {
                Spacer()
                GeometryReader { proxy in
                    let width = proxy.size.width
                    let x = width * target / d
                    ZStack(alignment: .topLeading) {
                        if let preview = model.scrubPreviewView {
                            ScrubPreviewSurface(view: preview)
                                .frame(width: 400, height: 225)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white, lineWidth: 3))
                                .offset(x: min(max(0, x - 200), width - 400), y: 0)
                        }
                        Text(ScrubMath.clock(target))
                            .font(.title3.weight(.bold)).monospacedDigit()
                            .padding(.horizontal, 16).padding(.vertical, 6)
                            .background(.black.opacity(0.75), in: Capsule())
                            .fixedSize()
                            .offset(x: min(max(0, x - 60), width - 140), y: model.scrubPreviewView == nil ? 190 : 240)
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.25)).frame(height: 10)
                            Capsule().fill(.white.opacity(0.6)).frame(width: width * model.playback.t / d, height: 10)
                            Circle().fill(Theme.gold).frame(width: 26, height: 26).offset(x: x - 13)
                        }
                        .offset(y: 290)
                    }
                }
                .frame(height: 310)
                HStack {
                    Text(ScrubMath.clock(model.playback.t)).monospacedDigit()
                    Spacer()
                    Text("Click to jump · Back to cancel").foregroundStyle(.white.opacity(0.8))
                    Spacer()
                    Text(ScrubMath.clock(d)).monospacedDigit()
                }
                .font(.callout.weight(.semibold))
                .padding(.top, 14)
            }
            .padding(.horizontal, Theme.edge)
            .padding(.bottom, 60)
            .background(alignment: .bottom) {
                LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom).frame(height: 520)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .transition(.opacity)
        }
    }
}

private struct ScrubPreviewSurface: UIViewRepresentable {
    let view: UIView
    func makeUIView(context: Context) -> UIView { view }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
