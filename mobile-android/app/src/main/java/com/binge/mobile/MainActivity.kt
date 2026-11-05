package com.binge.mobile

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File

// The binge. website (its phone layout) in a full-screen WebView, plus what a browser
// can't do for it:
//   - every pop-up and tab redirect from the video servers' players is refused, as in
//     the TV apps (the website alone can only sandbox two servers);
//   - links to other sites open in the phone's browser;
//   - files the site saves (Download my data, calendar .ics, Wrapped card) go to Downloads.
// Web push doesn't reach a WebView, so alerts only show inside the site.
class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private var fullscreen: View? = null
    private var fullscreenDone: WebChromeClient.CustomViewCallback? = null
    private var pickFiles: ValueCallback<Array<Uri>>? = null
    // PageScript runs (needs a WebView from about 2021 on): the site's outside links come
    // through it, so any other attempt to leave the site can be refused outright.
    private var pageScript = false

    private val home: Uri = Uri.parse(BuildConfig.BINGE_URL)
    // scheme://host[:port], as the web origin rules need it (the port matters for local sites).
    private val siteOrigin: String get() = "${home.scheme}://${home.host}" + (if (home.port != -1) ":${home.port}" else "")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.binge_background)) }
        setContentView(root)
        web = buildWebView()
        root.addView(web, ViewGroup.LayoutParams(MATCH, MATCH))
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(startUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.takeIf(::isSite)?.let { web.loadUrl(it.toString()) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    // Back: out of a full-screen video, then back through the site, then out of the app.
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        when {
            fullscreen != null -> {
                val done = fullscreenDone
                if (done != null) done.onCustomViewHidden() else leaveFullscreen()
            }
            web.canGoBack() -> web.goBack()
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    @Suppress("OVERRIDE_DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_FILES) {
            pickFiles?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            pickFiles = null
            return
        }
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    }

    private fun startUrl(intent: Intent?): String = intent?.data?.takeIf(::isSite)?.toString() ?: home.toString()

    private fun isSite(url: Uri?): Boolean {
        val host = url?.host ?: return false
        val site = home.host ?: return false
        return host == site || host.endsWith(".$site")
    }

    private fun isSiteUrl(url: String?): Boolean = url != null && isSite(Uri.parse(url))

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView(): WebView = WebView(this).apply {
        setBackgroundColor(getColor(R.color.binge_background))
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true) // so window.open reaches onCreateWindow, which refuses it
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            // Look like plain Chrome: some players refuse pages they think are in an app
            // (the same change as the Fire TV app). BingeApp lets the site tell it's here.
            userAgentString = userAgentString.replace("; wv", "").replace(Regex("Version/\\d+\\.\\d+ "), "") + " BingeApp/1.0"
        }
        // And don't send the app's package name with every request (X-Requested-With).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            WebSettingsCompat.setRequestedWithHeaderOriginAllowList(settings, emptySet())
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true) // the players keep their own cookies
        pageScript = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (pageScript) {
            WebViewCompat.addWebMessageListener(this, "bingeApp", setOf(siteOrigin)) { _, message, _, isMainFrame, _ ->
                if (isMainFrame) onPageMessage(message.data)
            }
            WebViewCompat.addDocumentStartJavaScript(this, PageScript.SOURCE, setOf(siteOrigin))
        }
        webViewClient = Client()
        webChromeClient = Chrome()
        setDownloadListener { url, _, _, _, _ ->
            // Real files (not the site's blob: links, which PageScript handles) open in the browser.
            if (url.startsWith("http")) openOutside(Uri.parse(url))
        }
    }

    // From PageScript, only ever from the site's own top-level page.
    private fun onPageMessage(data: String?) {
        val text = data ?: return
        val message = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (message.optString("type")) {
            "open" -> openOutside(Uri.parse(message.optString("url")))
            "download" -> save(message.optString("name"), message.optString("mime"), message.optString("data"))
        }
    }

    private fun openOutside(url: Uri) {
        if (url.scheme?.lowercase() !in setOf("http", "https", "mailto", "tel")) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show()
        }
    }

    // A file the site made: into Downloads (Android 10+) or the app's own folder, and a
    // calendar file or picture opens straight away (to add the dates, or see the card).
    private fun save(name: String, mime: String, base64: String) {
        val bytes = runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull() ?: return
        val fileName = name.ifBlank { "binge-file" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val type = mime.ifBlank { "application/octet-stream" }
        val saved: Uri? = try {
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, type)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("no Downloads")
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("can't write")
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                contentResolver.update(uri, values, null, null)
                uri
            } else {
                File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir, fileName).writeBytes(bytes)
                null
            }
        } catch (_: Exception) {
            Toast.makeText(this, "Couldn’t save $fileName", Toast.LENGTH_SHORT).show()
            return
        }
        Toast.makeText(this, if (saved != null) "Saved $fileName to Downloads" else "Saved $fileName", Toast.LENGTH_SHORT).show()
        if (saved != null && (type.startsWith("image/") || type == "text/calendar")) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(saved, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            } catch (_: ActivityNotFoundException) { /* saved; nothing to open it with */ }
        }
    }

    private fun leaveFullscreen() {
        val view = fullscreen ?: return
        root.removeView(view)
        fullscreen = null
        fullscreenDone = null
        web.visibility = View.VISIBLE
        setSystemBarsHidden(false)
    }

    @Suppress("DEPRECATION")
    private fun setSystemBarsHidden(hidden: Boolean) {
        if (Build.VERSION.SDK_INT >= 30) {
            val controller = window.insetsController ?: return
            if (hidden) {
                controller.hide(WindowInsets.Type.systemBars())
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            } else {
                controller.show(WindowInsets.Type.systemBars())
            }
        } else {
            window.decorView.systemUiVisibility = if (hidden) {
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            } else {
                View.SYSTEM_UI_FLAG_VISIBLE
            }
        }
    }

    private fun offlinePage(): String = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
                 gap: 12px; background: #0b0d12; color: #f4f6f8; font: 16px system-ui, sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
          h1 { margin: 0; font-size: 20px; } p { margin: 0; color: #9aa3b2; }
          a { margin-top: 12px; padding: 12px 22px; border-radius: 999px; background: #d6ad55; color: #0b0d12; font-weight: 700; text-decoration: none; }
        </style></head><body>
          <h1>Can’t reach binge.</h1><p>Check your connection, then try again.</p><a href="$home">Try again</a>
        </body></html>
    """.trimIndent()

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false // the players and their frames load what they need
            val url = request.url
            if (isSite(url) || url.scheme in setOf("about", "data", "blob")) return false
            // Leaving binge. The site's own outside links come through PageScript, so anything
            // that ends up here is refused: a player's ad sending the whole app elsewhere,
            // even on a tap. (Old WebViews without PageScript: a tapped link opens in the browser.)
            if (!pageScript && request.hasGesture()) openOutside(url)
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) view.loadDataWithBaseURL(null, offlinePage(), "text/html", "utf-8", null)
        }

        // The page's renderer died (usually memory): start a fresh WebView instead of crashing.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            leaveFullscreen()
            root.removeView(view)
            view.destroy()
            web = buildWebView()
            root.addView(web, 0, ViewGroup.LayoutParams(MATCH, MATCH))
            web.loadUrl(home.toString())
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        // Pop-ups: never (the site's own new-tab links go through PageScript).
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean = false

        // A player's full-screen button.
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (fullscreen != null) {
                callback.onCustomViewHidden()
                return
            }
            fullscreen = view
            fullscreenDone = callback
            root.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
            web.visibility = View.INVISIBLE
            setSystemBarsHidden(true)
        }

        override fun onHideCustomView() = leaveFullscreen()

        // <input type="file"> (profile photos).
        override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            pickFiles?.onReceiveValue(null)
            pickFiles = callback
            return try {
                @Suppress("DEPRECATION") startActivityForResult(params.createIntent(), PICK_FILES)
                true
            } catch (_: ActivityNotFoundException) {
                pickFiles = null
                false
            }
        }

        // alert/confirm/prompt: the site's own work as usual; the players' (ad traps) are dropped.
        override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean =
            if (isSiteUrl(url)) false else { result.cancel(); true }

        override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean =
            if (isSiteUrl(url)) false else { result.cancel(); true }

        override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean =
            if (isSiteUrl(url)) false else { result.cancel(); true }

        // A black poster instead of Android's grey play glyph before a video starts.
        override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    }

    private companion object {
        const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        const val PICK_FILES = 7
    }
}
