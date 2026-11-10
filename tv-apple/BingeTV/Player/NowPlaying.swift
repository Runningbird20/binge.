import MediaPlayer
import UIKit

// What's playing, for the Apple TV's Control Center and the iPhone's
// Apple TV Remote: the title, the episode, the poster, a progress bar,
// and play/pause/skip that drive the player. The Siri remote's own buttons
// still go to PlayerView; a toggle arriving here right after one of those
// is the same press and is ignored (PlayerModel.remoteToggle).
@MainActor
enum NowPlaying {
    private static weak var model: PlayerModel?
    private static var registered = false
    private static var artworkURL: URL?
    private static var artwork: MPMediaItemArtwork?

    static func attach(_ model: PlayerModel) {
        self.model = model
        register()
    }

    static func detach(_ model: PlayerModel) {
        guard self.model === model else { return }
        self.model = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }

    static func update(title: String, detail: String?, art: URL?, t: Double, d: Double, paused: Bool, live: Bool) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
            MPNowPlayingInfoPropertyIsLiveStream: live,
            MPNowPlayingInfoPropertyPlaybackRate: paused ? 0.0 : 1.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
        ]
        if let detail { info[MPMediaItemPropertyArtist] = detail }
        if !live, d > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = d
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = t
        }
        if let artwork, artworkURL == art { info[MPMediaItemPropertyArtwork] = artwork }
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = info
        center.playbackState = paused ? .paused : .playing
        let commands = MPRemoteCommandCenter.shared()
        commands.skipForwardCommand.isEnabled = !live
        commands.skipBackwardCommand.isEnabled = !live
        commands.changePlaybackPositionCommand.isEnabled = !live
        if let art, art != artworkURL { loadArtwork(art) }
    }

    private static func loadArtwork(_ url: URL) {
        artworkURL = url
        artwork = nil
        Task {
            guard let image = await ImageStore.shared.load(url, pixels: 600), artworkURL == url else { return }
            artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] = artwork
        }
    }

    private static func register() {
        guard !registered else { return }
        registered = true
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { _ in
            Task { @MainActor in NowPlaying.model?.setPlaying(true) }
            return .success
        }
        commands.pauseCommand.addTarget { _ in
            Task { @MainActor in NowPlaying.model?.setPlaying(false) }
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { _ in
            Task { @MainActor in NowPlaying.model?.remoteToggle() }
            return .success
        }
        commands.skipForwardCommand.preferredIntervals = [10]
        commands.skipForwardCommand.addTarget { _ in
            Task { @MainActor in NowPlaying.model?.seek(by: 10) }
            return .success
        }
        commands.skipBackwardCommand.preferredIntervals = [10]
        commands.skipBackwardCommand.addTarget { _ in
            Task { @MainActor in NowPlaying.model?.seek(by: -10) }
            return .success
        }
        commands.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in NowPlaying.model?.seek(to: position) }
            return .success
        }
    }
}

// The TV's display mode (Match Content): set for the video on screen,
// cleared when the player closes so menus are back in the TV's usual mode.
@MainActor
enum DisplayMode {
    static var windows: [UIWindow] {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
    }

    static func clear() {
        for window in windows where window.avDisplayManager.preferredDisplayCriteria != nil {
            window.avDisplayManager.preferredDisplayCriteria = nil
        }
    }
}
