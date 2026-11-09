import AVFoundation
import UIKit

// A server page's stream played by Apple's own player (AVPlayer): hardware
// decoding, real buffering, instant seeks, and a few MB instead of a whole
// WebKit process. On tvOS the pages play native HLS, so the bridge sees the
// stream's address (video.currentSrc) and the frame playing it (its Referer).
// It reports the same MediaState as the page bridge and takes the same
// commands, so the player, races and Multiview drive it unchanged. Subtitle
// lines go to the app (MediaState.cue), which draws them as it does for pages.
@MainActor
final class NativeEngine: NSObject, WebEngine {
    private final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    private let surface = PlayerView()
    var view: UIView { surface }
    let canSeek = true
    private let player: AVPlayer
    private let item: AVPlayerItem
    // Live HLS has no end: its duration is indefinite.
    private var isLive: Bool { item.duration.isIndefinite }
    private var cue = ""
    private var observers: [NSKeyValueObservation] = []
    private(set) var failed = false
    var onFailed: (() -> Void)?
    static var liveCount = 0
    static let bufferAhead: TimeInterval = 60
    static let liveOffset: TimeInterval = 20
    // A first picture is ready (it's what's on screen once the layer shows).
    var showing: Bool { surface.playerLayer.isReadyForDisplay && item.status == .readyToPlay }

    init(stream: URL, page: String, agent: String) {
        var headers = ["Referer": page]
        if let origin = URL(string: page).flatMap({ url in url.scheme.flatMap { scheme in url.host.map { "\(scheme)://\($0)" } } }) {
            headers["Origin"] = origin
        }
        if !agent.isEmpty { headers["User-Agent"] = agent }
        // AVURLAssetHTTPHeaderFieldsKey isn't public API (this app is sideload-only).
        let asset = AVURLAsset(url: stream, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        item = AVPlayerItem(asset: asset)
        // Start on the first variant the playlist lists instead of measuring
        // the network first (faster first picture; it climbs from there).
        item.startsOnFirstEligibleVariant = true
        // Movies and episodes buffer a full minute ahead (a slow stretch of
        // the server's network then never reaches the screen). Live games
        // sit 20s behind the live edge: the cushion that keeps them smooth,
        // kept through any stall.
        item.preferredForwardBufferDuration = Self.bufferAhead
        item.configuredTimeOffsetFromLive = CMTime(seconds: Self.liveOffset, preferredTimescale: 600)
        item.automaticallyPreservesTimeOffsetFromLive = true
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true
        player = AVPlayer(playerItem: item)
        player.isMuted = true
        player.automaticallyWaitsToMinimizeStalling = true
        super.init()
        Self.liveCount += 1
        surface.backgroundColor = .black
        surface.playerLayer.player = player
        surface.playerLayer.videoGravity = .resizeAspect
        surface.isUserInteractionEnabled = false
        let output = AVPlayerItemLegibleOutput()
        output.setDelegate(self, queue: .main)
        output.suppressesPlayerRendering = true // the app draws subtitle lines
        item.add(output)
        observers.append(item.observe(\.status) { [weak self] item, _ in
            guard item.status == .failed else { return }
            MainActor.assumeIsolated {
                guard let self, !self.failed else { return }
                self.failed = true
                #if DEBUG
                print("[native] failed: \(item.error?.localizedDescription ?? "?")")
                #endif
                self.onFailed?()
            }
        })
        player.play()
    }

    func load(_ url: URL) {}
    func setAllowedHost(_ host: String?) {}

    private var selectionGroups: (audio: AVMediaSelectionGroup?, text: AVMediaSelectionGroup?) {
        let asset = item.asset
        return (asset.mediaSelectionGroup(forMediaCharacteristic: .audible), asset.mediaSelectionGroup(forMediaCharacteristic: .legible))
    }

    private func tracks(_ group: AVMediaSelectionGroup?) -> [MediaTrack] {
        guard let group else { return [] }
        let selected = item.currentMediaSelection.selectedMediaOption(in: group)
        return group.options.enumerated().map { index, option in
            MediaTrack(index: index, label: option.displayName, language: option.extendedLanguageTag ?? option.locale?.identifier ?? "",
                       on: option == selected, cues: 1)
        }
    }

    func poll(_ completion: @escaping (MediaState?) -> Void) {
        guard !failed else { completion(nil); return }
        let ready = item.status == .readyToPlay
        let showing = surface.playerLayer.isReadyForDisplay
        let duration = item.duration.seconds
        let time = player.currentTime().seconds
        var state = MediaState()
        // No clock until the first picture: a live stream's position is
        // already far along before it shows anything.
        state.t = showing && time.isFinite ? time : 0
        state.d = isLive || !duration.isFinite ? 0 : duration
        state.paused = player.timeControlStatus == .paused
        state.ended = !isLive && duration.isFinite && time >= duration - 0.5
        state.ready = player.timeControlStatus == .playing ? 4 : (ready ? 3 : 1)
        state.video = true
        state.height = Int(item.presentationSize.height)
        state.muted = player.isMuted
        // Seconds buffered past the playhead.
        if let range = item.loadedTimeRanges.map(\.timeRangeValue).first(where: { $0.containsTime(player.currentTime()) }) {
            state.ahead = max(0, (range.end - player.currentTime()).seconds)
        }
        if let log = item.accessLog()?.events.last {
            state.dropped = log.numberOfDroppedVideoFrames
        }
        let groups = selectionGroups
        state.audio = tracks(groups.audio)
        state.text = tracks(groups.text)
        state.cue = cue
        completion(state)
    }

    func send(_ command: MediaCommand) {
        switch command {
        case .play: player.play()
        case .pause: player.pause()
        case .toggle: player.timeControlStatus == .paused ? player.play() : player.pause()
        case .mute: player.isMuted = true
        case .unmute: player.isMuted = false
        case .stop: player.isMuted = true; player.pause()
        case .seekBy(let seconds): seek(to: player.currentTime().seconds + seconds)
        case .seekTo(let seconds): seek(to: seconds)
        case .edge:
            if isLive, let range = item.seekableTimeRanges.last?.timeRangeValue {
                player.seek(to: range.end - CMTime(seconds: Self.liveOffset, preferredTimescale: 600))
            }
            player.play()
        case .audioTrack(let index):
            if let group = selectionGroups.audio, group.options.indices.contains(index) { item.select(group.options[index], in: group) }
        case .textTrack(let index):
            guard let group = selectionGroups.text else { return }
            item.select(group.options.indices.contains(index) ? group.options[index] : nil, in: group)
            if index < 0 { cue = "" }
        // Page-only: fill/trim/cushions are what AVPlayer does by itself;
        // caption style and timing are drawn by the app.
        case .fill, .unfill, .trim, .cushionStart, .cushionOn, .captionStyle: break
        }
    }

    private func seek(to seconds: Double) {
        guard seconds.isFinite else { return }
        // Half a second either way lands on a nearby keyframe: a seek that
        // shows at once instead of decoding up to the exact frame.
        let slack = CMTime(seconds: 0.5, preferredTimescale: 600)
        player.seek(to: CMTime(seconds: max(0, seconds), preferredTimescale: 600), toleranceBefore: slack, toleranceAfter: slack)
    }

    #if DEBUG
    func debugReport() -> String {
        let errors = item.errorLog()?.events.suffix(3).map { "\($0.errorStatusCode) \($0.errorDomain) \($0.errorComment ?? "") \($0.uri?.prefix(80) ?? "")" } ?? []
        return "status=\(item.status.rawValue) control=\(player.timeControlStatus.rawValue) reason=\(player.reasonForWaitingToPlay?.rawValue ?? "-") errors=\(errors)"
    }
    #endif

    func destroy() {
        observers.removeAll()
        player.pause()
        player.replaceCurrentItem(with: nil)
        surface.playerLayer.player = nil
        surface.removeFromSuperview()
        Self.liveCount = max(0, Self.liveCount - 1)
    }
}

extension NativeEngine: AVPlayerItemLegibleOutputPushDelegate {
    nonisolated func legibleOutput(_ output: AVPlayerItemLegibleOutput, didOutputAttributedStrings strings: [NSAttributedString],
                                   nativeSampleBuffers: [Any], forItemTime itemTime: CMTime) {
        let line = strings.map(\.string).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        MainActor.assumeIsolated { self.cue = line }
    }
}
