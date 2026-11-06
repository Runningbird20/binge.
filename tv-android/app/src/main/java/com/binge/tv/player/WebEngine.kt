package com.binge.tv.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.binge.tv.data.Config
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import com.binge.tv.data.plainJson

data class MediaTrack(val index: Int, val label: String, val language: String, val on: Boolean, val cues: Int = 0)

data class MediaState(
    val t: Double = 0.0,
    val d: Double = 0.0, // 0 for live streams
    val paused: Boolean = true,
    val ended: Boolean = false,
    val ready: Int = 0,
    val video: Boolean = false,
    val height: Int = 0,
    // Decoded and dropped video frames so far (-1: the browser doesn't say).
    val frames: Int = -1,
    val dropped: Int = -1,
    // The bridge is holding the video while it refills its buffer (live cushion).
    val cushion: Boolean = false,
    val audio: List<MediaTrack> = emptyList(),
    val text: List<MediaTrack> = emptyList(),
    val cue: String = "",
    // The native player has drawn its first picture and is playing: counts as
    // started even before the clock passes the 0.4s a page needs to prove it.
    val rendering: Boolean = false,
) {
    // Really playing: the clock moved, or the native player is showing pictures.
    val isPlaying get() = !paused && (t > 0.4 || rendering)
}

sealed class MediaCommand(val js: String) {
    object Play : MediaCommand("play")
    object Pause : MediaCommand("pause")
    object Toggle : MediaCommand("toggle")
    object Mute : MediaCommand("mute")
    object Unmute : MediaCommand("unmute")
    object Stop : MediaCommand("stop")
    object Fill : MediaCommand("fill")
    object Unfill : MediaCommand("unfill")
    object Trim : MediaCommand("trim")
    // Live: back to the live edge (after a pause or a stall) and play.
    object Edge : MediaCommand("edge")
    // Live: wait for a few seconds of buffer before playing (now, and whenever it runs dry).
    object CushionStart : MediaCommand("cushion:start")
    object CushionOn : MediaCommand("cushion:on")
    class SeekBy(val seconds: Double) : MediaCommand("seekBy:$seconds")
    class SeekTo(val seconds: Double) : MediaCommand("seekTo:$seconds")
    class AudioTrack(val index: Int) : MediaCommand("audio:$index")
    class TextTrack(val index: Int) : MediaCommand("text:$index")
    class CaptionStyle(size: Int, background: String) : MediaCommand("cue:$size:$background")
    // Server subtitles shifted by the viewer (seconds, + = later).
    class CueShift(seconds: Double) : MediaCommand("cueshift:$seconds")
}

// What the player, races and Multiview drive: a server's page (WebEngine),
// the native player (NativeEngine), or a page handing over to the native
// player once it finds the stream (HybridEngine).
interface Engine {
    val view: View
    val muted: Boolean
    var onProcessGone: (() -> Unit)?
    // The latest report from the main video (null when it went quiet).
    fun poll(): MediaState?
    fun send(command: MediaCommand)
    fun destroy()
}

// A stream found in a server's page: its manifest and the headers the page
// sent for it (most servers' CDNs refuse requests without their Referer/Origin).
data class StreamSource(val url: String, val headers: Map<String, String>, val dash: Boolean)

// Hosts the server pages load that only show ads, pop-unders or tracking:
// never fetched (less to download and run on a stick's CPU, faster start).
// Seen on the servers' pages on a Fire TV, 2026-11-06.
object AdBlock {
    private val hosts = listOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com", "googletagmanager.com",
        "adservice.google.com", "cloudflareinsights.com", "clarity.ms", "yandex.ru", "yandex.com", "mc.yandex.ru",
        "adsco.re", "adexchangerapid.com", "rapidadexchange.com", "usrpubtrk.com", "usrpubtrck.com", "intellipopup.com",
        "plumingsaeume.com", "gurlleviter.cyou", "alchemmauls.com", "hexa.su", "popads.net", "popcash.net", "propellerads.com",
        "adsterra.com", "exoclick.com", "juicyads.com", "histats.com", "onclickads.net", "a-ads.com", "hotjar.com",
        "facebook.net", "scorecardresearch.com", "quantserve.com", "amazon-adsystem.com", "taboola.com", "outbrain.com",
    )
    fun blocks(url: android.net.Uri): Boolean {
        val host = url.host ?: return false
        if (hosts.any { host == it || host.endsWith(".$it") }) return true
        // The Chromecast sender framework: no casting from a TV.
        return host == "www.gstatic.com" && url.path.orEmpty().startsWith("/cv/")
    }
}

// The server's own player page in an Android WebView, loaded top-level, with
// the bridge in every frame. Pop-ups never open and the page can't navigate
// away from the server's site (ad redirects), the same rules as the Apple TV
// app. Never takes focus: the remote belongs to the app.
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class WebEngine(context: Context, private var allowedHost: String?) : Engine {
    override val view: WebView = WebView(context)
    private val main = Handler(Looper.getMainLooper())
    private var latest: MediaState? = null
    private var latestAt = 0L
    private var destroyed = false
    // Wanted sound state, re-sent every second (a server can replace its
    // video or frame, and new ones start muted).
    override var muted = true
        private set
    override var onProcessGone: (() -> Unit)? = null
    // Called (on the main thread) the first time the page requests a stream
    // manifest the native player can play.
    var onStream: ((StreamSource) -> Unit)? = null
    private var streamFound = false
    // Once the native player has the stream: the page stops downloading video.
    @Volatile var blockMedia = false

    init {
        live++
        view.setBackgroundColor(Color.BLACK)
        view.isFocusable = false
        view.isFocusableInTouchMode = false
        view.descendantFocusability = android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS
        view.isVerticalScrollBarEnabled = false
        view.isHorizontalScrollBarEnabled = false
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true) // so window.open reaches onCreateWindow (refused there)
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            // Present as plain Chrome: some players refuse pages they think are in an app.
            userAgentString = userAgentString.replace("; wv", "").replace(Regex("Version/\\d+\\.\\d+ "), "")
        }
        // And don't announce the app's package name on every request (X-Requested-With).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            androidx.webkit.WebSettingsCompat.setRequestedWithHeaderOriginAllowList(view.settings, emptySet())
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
        view.addJavascriptInterface(BridgeReceiver(), "BingeBridge")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(view, Bridge.SCRIPT, setOf("*"))
        }
        view.webViewClient = object : WebViewClient() {
            // The top-level page stays on the server's own site; frames inside may load anything.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val scheme = request.url.scheme ?: return true
                if (!scheme.startsWith("http")) return true // intent://, market:// ads
                val host = request.url.host ?: return true
                val allowed = allowedHost ?: return false
                val ok = host == allowed || host.endsWith(".$allowed") || allowed.endsWith(".$host")
                return !ok
            }

            // Ads and trackers never load; the stream manifest is handed to the
            // native player; and once it plays there, the page's own video
            // stops downloading.
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): android.webkit.WebResourceResponse? {
                val url = request.url
                val u = url.toString()
                if (com.binge.tv.BuildConfig.DEBUG && (com.binge.tv.DebugLaunch.logAll || MANIFEST.containsMatchIn(u))) {
                    android.util.Log.i("binge-media", "${allowedHost} ${request.method} $u headers=${request.requestHeaders}")
                }
                if (AdBlock.blocks(url)) return EMPTY()
                if (blockMedia && SEGMENT.containsMatchIn(u)) return EMPTY()
                if (!streamFound && request.method == "GET" && MANIFEST.containsMatchIn(u)) {
                    streamFound = true
                    val headers = request.requestHeaders.filterKeys { it.equals("Referer", true) || it.equals("Origin", true) || it.equals("User-Agent", true) }.toMutableMap()
                    CookieManager.getInstance().getCookie(u)?.let { headers["Cookie"] = it }
                    val source = StreamSource(u, headers, u.contains(".mpd", ignoreCase = true))
                    main.post { if (!destroyed) onStream?.invoke(source) }
                }
                return null
            }

            override fun onPageFinished(view: WebView, url: String?) {
                // Older WebViews without document-start scripts: main frame only.
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(Bridge.SCRIPT, null)
            }

            // The page's renderer died (usually memory). Drop the state so the
            // player notices and moves on; never let it take the app down.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail?): Boolean {
                latest = null
                latestAt = 0
                destroy()
                onProcessGone?.invoke()
                return true
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?) = false
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: android.webkit.JsResult?): Boolean { result?.cancel(); return true }
            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: android.webkit.JsResult?): Boolean { result?.cancel(); return true }
            // A black poster instead of Android's grey play glyph before the video starts.
            override fun getDefaultVideoPoster() = android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888)
        }
    }

    private inner class BridgeReceiver {
        @JavascriptInterface
        fun post(payload: String) {
            val state = parse(payload) ?: return
            main.post { receive(state) }
        }
    }

    private fun tracks(value: Any?): List<MediaTrack> = (value as? JsonArray).orEmpty().mapNotNull { item ->
        val o = item as? JsonObject ?: return@mapNotNull null
        val index = o["i"]?.jsonPrimitive?.intOrNull ?: return@mapNotNull null
        MediaTrack(index, o["l"]?.jsonPrimitive?.contentOrNull ?: "", o["g"]?.jsonPrimitive?.contentOrNull ?: "",
            o["on"]?.jsonPrimitive?.booleanOrNull ?: false, o["n"]?.jsonPrimitive?.intOrNull ?: 0)
    }

    private fun parse(payload: String): MediaState? = runCatching {
        val o = plainJson.parseToJsonElement(payload).jsonObject
        MediaState(
            t = o["t"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
            d = o["d"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
            paused = o["paused"]?.jsonPrimitive?.booleanOrNull ?: true,
            ended = o["ended"]?.jsonPrimitive?.booleanOrNull ?: false,
            ready = o["ready"]?.jsonPrimitive?.intOrNull ?: 0,
            video = true,
            height = o["h"]?.jsonPrimitive?.intOrNull ?: 0,
            frames = o["fr"]?.jsonPrimitive?.intOrNull ?: -1,
            dropped = o["dr"]?.jsonPrimitive?.intOrNull ?: -1,
            cushion = (o["cb"]?.jsonPrimitive?.intOrNull ?: 0) == 1,
            audio = tracks(o["at"]),
            text = tracks(o["tt"]),
            cue = o["cue"]?.jsonPrimitive?.contentOrNull ?: "",
        )
    }.getOrNull()

    // Several frames may have a <video> (ads, previews): the main one is the
    // one that has made the most progress recently.
    private fun receive(state: MediaState) {
        val last = latest
        val now = System.currentTimeMillis()
        if (last != null && now - latestAt < 1500 && (state.ready < last.ready || (last.t > state.t + 1 && !last.paused))) return
        latest = state
        latestAt = now
    }

    fun setAllowedHost(host: String?) { allowedHost = host }

    fun load(url: String) {
        if (destroyed) return
        latest = null
        view.loadUrl(url, mapOf("Referer" to "${Config.siteUrl}/"))
    }

    private var lastSoundAt = 0L

    // The latest report from the page's main video (null when it went quiet).
    override fun poll(): MediaState? {
        if (destroyed) return null
        val now = System.currentTimeMillis()
        if (now - lastSoundAt > 1000) { lastSoundAt = now; run(if (muted) "mute" else "unmute") }
        return latest?.takeIf { now - latestAt < 3000 }
    }

    override fun send(command: MediaCommand) {
        when (command) {
            MediaCommand.Mute, MediaCommand.Stop -> muted = true
            MediaCommand.Unmute -> muted = false
            else -> {}
        }
        run(command.js)
    }

    private fun run(js: String) {
        if (destroyed) return
        view.evaluateJavascript("window.__bingeRun && window.__bingeRun('$js')", null)
    }

    override fun destroy() {
        if (destroyed) return
        destroyed = true
        live = maxOf(0, live - 1)
        main.post {
            (view.parent as? android.view.ViewGroup)?.removeView(view)
            runCatching { view.stopLoading(); view.loadUrl("about:blank"); view.removeJavascriptInterface("BingeBridge"); view.destroy() }
        }
    }

    companion object {
        // Video pages alive right now; optional work (preloads) checks this.
        var live = 0
            private set
        fun hostOf(url: String): String? = Uri.parse(url).host
        // A stream manifest: HLS/DASH by extension, or CineSrc's /api/playlist/.
        private val MANIFEST = Regex("\\.(m3u8|mpd)(\\?|$)|cinesrc\\.st/api/playlist/", RegexOption.IGNORE_CASE)
        // Video/audio segments (any server): blocked once the native player has the stream.
        private val SEGMENT = Regex("\\.(ts|m4s|m4v|m4a|aac)(\\?|$)|/seg-|/chunk-|init[^/]*\\.mp4", RegexOption.IGNORE_CASE)
        private fun EMPTY() = android.webkit.WebResourceResponse("text/plain", "utf-8", 204, "No Content", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
    }
}

// Keeps a hidden view from ever taking focus or touches.
fun View.inert(): View = apply { isFocusable = false; isFocusableInTouchMode = false; isClickable = false }
