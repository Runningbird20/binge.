package com.binge.tv.player

import android.content.Context
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.binge.tv.data.Net

// A stream found in a server's page, played by Android's own video player
// (Media3 ExoPlayer): hardware decoding on a SurfaceView, real buffering,
// instant seeks, and a few MB instead of a whole web page. It reports the
// same MediaState as the page bridge and takes the same commands, so the
// player, the race and Multiview drive it the same way. Subtitle lines go
// to the app (MediaState.cue), which draws them as it does for pages.
@OptIn(UnstableApi::class)
class NativeEngine(context: Context, source: StreamSource, private val isLive: Boolean) : Engine {
    private val surface = PlayerView(context).apply {
        useController = false
        subtitleView?.visibility = View.GONE
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        setShutterBackgroundColor(android.graphics.Color.BLACK)
        setKeepContentOnPlayerReset(true)
        isFocusable = false
        descendantFocusability = android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS
    }
    override val view: View get() = surface
    override var muted = true
        private set
    override var onProcessGone: (() -> Unit)? = null
    // Set when the stream can't be played here; the page takes over again.
    var failed: PlaybackException? = null
        private set
    var onFailed: ((PlaybackException) -> Unit)? = null

    private val player: ExoPlayer
    private var cue = ""
    private var firstFrame = false
    private var destroyed = false
    private var audioList: List<Pair<Tracks.Group, Int>> = emptyList()
    private var textList: List<Pair<Tracks.Group, Int>> = emptyList()

    init {
        live++
        val headers = source.headers.filterKeys { !it.equals("User-Agent", true) }
        val agent = source.headers.entries.firstOrNull { it.key.equals("User-Agent", true) }?.value ?: "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Mobile Safari/537.36"
        val http = OkHttpDataSource.Factory(Net.client).setUserAgent(agent).setDefaultRequestProperties(headers)
        // A stick has ~300 MB free: buffer by time with a modest byte cap,
        // and start playing after 1s of video (2.5s after a stall).
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(if (isLive) 8_000 else 15_000, if (isLive) 30_000 else 50_000, 1_000, 2_500)
            .setTargetBufferBytes(48 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(false)
            .build()
        val renderers = StickRenderers(context).setEnableDecoderFallback(true)
        player = ExoPlayer.Builder(context, renderers)
            .setLoadControl(load)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .build()
        player.volume = 0f
        surface.player = player
        val item = MediaItem.Builder().setUri(source.url)
            .setMimeType(if (source.dash) MimeTypes.APPLICATION_MPD else MimeTypes.APPLICATION_M3U8)
            .apply { if (isLive) setLiveConfiguration(MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(12_000).build()) }
            .build()
        player.setMediaItem(item)
        if (com.binge.tv.BuildConfig.DEBUG) player.addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
            override fun onLoadCompleted(t: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime, info: androidx.media3.exoplayer.source.LoadEventInfo, data: androidx.media3.exoplayer.source.MediaLoadData) {
                Perf.mark("native loaded type=${data.dataType} ${info.bytesLoaded / 1024}KB in ${info.loadDurationMs}ms")
            }
            override fun onPlaybackStateChanged(t: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime, state: Int) { Perf.mark("native state $state") }
            override fun onRenderedFirstFrame(t: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime, output: Any, renderTimeMs: Long) { Perf.mark("native first frame") }
            override fun onVideoDecoderInitialized(t: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime, name: String, initializedTimestampMs: Long, initializationDurationMs: Long) { Perf.mark("native decoder $name ${initializationDurationMs}ms") }
        })
        player.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() { firstFrame = true }
            override fun onCues(cueGroup: CueGroup) {
                cue = cueGroup.cues.mapNotNull { it.text?.toString() }.joinToString("\n").trim()
            }
            override fun onTracksChanged(tracks: Tracks) {
                audioList = flatten(tracks, C.TRACK_TYPE_AUDIO)
                textList = flatten(tracks, C.TRACK_TYPE_TEXT)
            }
            override fun onPlayerError(error: PlaybackException) {
                // A live stream that fell behind its window: back to the edge.
                if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    player.seekToDefaultPosition(); player.prepare(); return
                }
                failed = error
                onFailed?.invoke(error)
            }
        })
        player.playWhenReady = true
        player.prepare()
    }

    // Live: ExoPlayer's position is relative to a sliding window and jumps
    // around; the player's stall checks need a clock that only moves forward
    // while it plays, so live reports the stream's wall-clock time (seconds).
    private val window = androidx.media3.common.Timeline.Window()
    private fun liveClock(): Double {
        val timeline = player.currentTimeline
        if (timeline.isEmpty) return player.currentPosition / 1000.0
        timeline.getWindow(player.currentMediaItemIndex, window)
        val start = window.windowStartTimeMs
        return if (start == C.TIME_UNSET) player.currentPosition / 1000.0 else (start + player.currentPosition) / 1000.0
    }

    private fun flatten(tracks: Tracks, type: Int) = tracks.groups.filter { it.type == type }
        .flatMap { group -> (0 until group.length).filter { group.isTrackSupported(it) }.map { group to it } }

    override fun poll(): MediaState? {
        if (destroyed || failed != null) return null
        val state = player.playbackState
        val counters = player.videoDecoderCounters
        val duration = player.duration
        return MediaState(
            // No clock until the first picture: a live stream's position is
            // already far along before it shows anything.
            t = if (!firstFrame) 0.0 else if (isLive) liveClock() else player.currentPosition / 1000.0,
            d = if (isLive || duration == C.TIME_UNSET) 0.0 else duration / 1000.0,
            paused = !player.playWhenReady,
            ended = state == Player.STATE_ENDED,
            ready = when (state) { Player.STATE_READY -> 4; Player.STATE_BUFFERING -> 2; else -> 0 },
            video = true,
            height = player.videoSize.height,
            frames = counters?.renderedOutputBufferCount ?: -1,
            dropped = counters?.droppedBufferCount ?: -1,
            audio = audioList.mapIndexed { i, (group, track) ->
                val f = group.getTrackFormat(track)
                MediaTrack(i, f.label ?: "", f.language ?: "", group.isTrackSelected(track))
            },
            text = textList.mapIndexed { i, (group, track) ->
                val f = group.getTrackFormat(track)
                MediaTrack(i, f.label ?: "", f.language ?: "", group.isTrackSelected(track), cues = 1)
            },
            cue = cue,
            rendering = firstFrame && state == Player.STATE_READY && player.playWhenReady,
        )
    }

    override fun send(command: MediaCommand) {
        if (destroyed) return
        when (command) {
            MediaCommand.Play -> player.play()
            MediaCommand.Pause -> player.pause()
            MediaCommand.Toggle -> if (player.playWhenReady) player.pause() else player.play()
            MediaCommand.Mute -> { muted = true; player.volume = 0f }
            MediaCommand.Unmute -> { muted = false; player.volume = 1f }
            MediaCommand.Stop -> { muted = true; player.volume = 0f; player.pause() }
            MediaCommand.Edge -> { if (isLive) player.seekToDefaultPosition(); player.play() }
            is MediaCommand.SeekTo -> player.seekTo((command.seconds * 1000).toLong().coerceAtLeast(0))
            is MediaCommand.SeekBy -> player.seekTo((player.currentPosition + (command.seconds * 1000).toLong()).coerceAtLeast(0))
            is MediaCommand.AudioTrack -> select(audioList, command.index, C.TRACK_TYPE_AUDIO)
            is MediaCommand.TextTrack -> select(textList, command.index, C.TRACK_TYPE_TEXT)
            // Page-only commands: fill/trim/cushions are what ExoPlayer does by itself,
            // caption style and timing are drawn by the app.
            else -> {}
        }
    }

    private fun select(list: List<Pair<Tracks.Group, Int>>, index: Int, type: Int) {
        val params = player.trackSelectionParameters.buildUpon()
        val pick = list.getOrNull(index)
        if (pick == null) {
            params.setTrackTypeDisabled(type, true)
        } else {
            params.setTrackTypeDisabled(type, false)
                .setOverrideForType(TrackSelectionOverride(pick.first.mediaTrackGroup, pick.second))
        }
        player.trackSelectionParameters = params.build()
    }

    // Hidden: moved off screen at full size. Its video layer ignores alpha
    // (a hidden one covered the video on screen), and shrinking it instead made
    // the MediaTek decoder fail when it grew back for the hand-over.
    override fun setShown(shown: Boolean) {
        surface.translationX = if (shown) 0f else OFF_SCREEN
    }

    override fun destroy() {
        if (destroyed) return
        destroyed = true
        live = maxOf(0, live - 1)
        surface.player = null
        player.release()
        (surface.parent as? android.view.ViewGroup)?.removeView(surface)
    }

    companion object {
        private const val OFF_SCREEN = 20_000f
        // Native players alive right now (each holds a hardware decoder).
        var live = 0
            private set
    }
}

// A Fire TV Stick 4K Max's MediaTek decoder can't move to another surface
// mid-stream (DECODING_FAILED whenever a preloaded video was handed to the
// player). Media3 knows this for some devices; here it's on for all, so a
// surface change re-creates the decoder instead (~0.1s).
@OptIn(UnstableApi::class)
private class StickRenderers(context: Context) : DefaultRenderersFactory(context) {
    @Suppress("DEPRECATION")
    override fun buildVideoRenderers(
        context: Context, extensionRendererMode: Int, mediaCodecSelector: androidx.media3.exoplayer.mediacodec.MediaCodecSelector,
        enableDecoderFallback: Boolean, eventHandler: android.os.Handler, eventListener: androidx.media3.exoplayer.video.VideoRendererEventListener,
        allowedVideoJoiningTimeMs: Long, out: ArrayList<androidx.media3.exoplayer.Renderer>,
    ) {
        out.add(object : androidx.media3.exoplayer.video.MediaCodecVideoRenderer(
            context, mediaCodecSelector, allowedVideoJoiningTimeMs, enableDecoderFallback, eventHandler, eventListener, MAX_DROPPED_VIDEO_FRAME_COUNT_TO_NOTIFY,
        ) {
            override fun codecNeedsSetOutputSurfaceWorkaround(name: String) = true
        })
    }
}
