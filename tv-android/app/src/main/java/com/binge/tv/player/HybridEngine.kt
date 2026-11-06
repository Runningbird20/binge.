package com.binge.tv.player

import android.content.Context
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout

// One server: its page loads (that's how the stream is found), and as soon
// as the page asks for the stream's manifest, Android's own player plays it
// (NativeEngine) and the page is silenced, stops downloading video, and is
// closed once the native player is really playing. Servers whose page builds
// the stream itself (VidRift, VidSrc) never hand one over and play in the
// page as before; so does anything the native player can't play.
class HybridEngine(
    private val context: Context,
    url: String,
    private val live: Boolean,
    nativeAllowed: Boolean,
) : Engine {
    private val frame = FrameLayout(context).apply { setBackgroundColor(android.graphics.Color.BLACK) }
    override val view: View get() = frame
    private var page: WebEngine? = WebEngine(context, WebEngine.hostOf(url))
    private var native: NativeEngine? = null
    private var nativeStartedAt = 0L
    // Native is the one on screen (the page is gone).
    var isNative = false
        private set
    // The stream was found and the native player is starting.
    val isStartingNative get() = native != null && !isNative
    private var wantPlay = true
    private var wantMuted = true
    private var destroyed = false
    override var onProcessGone: (() -> Unit)? = null
        set(value) { field = value; page?.onProcessGone = value }
    override val muted get() = wantMuted

    init {
        val web = page!!
        frame.addView(web.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (nativeAllowed) web.onStream = { source -> startNative(source) }
        web.load(url)
    }

    private fun startNative(source: StreamSource) {
        if (destroyed || native != null) return
        Perf.mark("stream found (${WebEngine.hostOf(source.url)})")
        val engine = NativeEngine(context, source, live)
        engine.onFailed = { error -> Perf.mark("native failed: ${error.errorCodeName}"); fallBack() }
        native = engine
        nativeStartedAt = SystemClock.uptimeMillis()
        frame.addView(engine.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (!wantMuted) engine.send(MediaCommand.Unmute)
        if (!wantPlay) engine.send(MediaCommand.Pause)
        // The page goes quiet and stops fetching video while the native player starts.
        page?.let { it.send(MediaCommand.Mute); it.send(MediaCommand.Pause); it.blockMedia = true }
    }

    // The native player couldn't play this stream: back to the page.
    private fun fallBack() {
        native?.destroy()
        native = null
        val web = page ?: return
        web.blockMedia = false
        if (!wantMuted) web.send(MediaCommand.Unmute)
        if (wantPlay) web.send(MediaCommand.Play)
    }

    override fun poll(): MediaState? {
        if (destroyed) return null
        val engine = native ?: return page?.poll()
        val state = engine.poll()
        if (!isNative) {
            // Too slow to start: the page (already loaded) is the better bet.
            if (state == null || (!state.isPlaying && state.ready < 3 && SystemClock.uptimeMillis() - nativeStartedAt > NATIVE_START_MS)) {
                if (state != null) Perf.mark("native too slow")
                fallBack()
                return page?.poll()
            }
            if (state.isPlaying || (state.ready >= 3 && !wantPlay)) {
                isNative = true
                Perf.mark("native playing ${state.height}p")
                page?.let { frame.removeView(it.view); it.destroy() }
                page = null
            }
        }
        return state
    }

    override fun send(command: MediaCommand) {
        when (command) {
            MediaCommand.Play -> wantPlay = true
            MediaCommand.Pause, MediaCommand.Stop -> wantPlay = false
            MediaCommand.Toggle -> wantPlay = !wantPlay
            MediaCommand.Mute -> wantMuted = true
            MediaCommand.Unmute -> wantMuted = false
            else -> {}
        }
        val engine = native
        if (engine != null) engine.send(command) else page?.send(command)
    }

    override fun destroy() {
        if (destroyed) return
        destroyed = true
        native?.destroy()
        page?.destroy()
        native = null
        page = null
    }

    companion object {
        // A native start slower than this falls back to the page.
        const val NATIVE_START_MS = 12_000L
    }
}
