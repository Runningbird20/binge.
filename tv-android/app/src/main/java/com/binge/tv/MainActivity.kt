package com.binge.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * binge. for Fire TV / Android TV: the website in a full-screen WebView.
 *
 * The site switches itself into TV mode when it sees "BingeTV" in the user
 * agent (bigger layout, d-pad navigation, focus rings). This activity only
 * has to: keep the screen awake, let embedded players autoplay and go full
 * screen, keep navigation on the binge. site (blocking pop-up/redirect
 * ads), and route the remote's Back button to the page first.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private val homeHost: String? = Uri.parse(BuildConfig.BINGE_URL).host

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false // let players autoplay
            javaScriptCanOpenWindowsAutomatically = false // no pop-up ads
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString BingeTV/1.0"
        }
        // Embedded players keep their session in third-party cookies.
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.webViewClient = object : WebViewClient() {
            // Main-frame navigations stay on binge.; anything else (an ad
            // redirect from an embed) is dropped. Iframes are unaffected.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val host = request.url.host ?: return true
                return homeHost != null && host != homeHost
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // A player's own fullscreen button.
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                fullscreenView = view
                fullscreenCallback = callback
                root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                web.visibility = View.GONE
            }

            override fun onHideCustomView() {
                exitFullscreen()
            }
        }

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl(BuildConfig.BINGE_URL.trimEnd('/') + "/home")
        }
    }

    private fun exitFullscreen() {
        val view = fullscreenView ?: return
        root.removeView(view)
        fullscreenView = null
        web.visibility = View.VISIBLE
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
        web.requestFocus()
    }

    // Back: leave a player's fullscreen; otherwise ask the page
    // (window.bingeTvBack closes the player / sheet / goes back a page and
    // returns true), and only leave the app when the page says it's done.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) handleBack()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun handleBack() {
        if (fullscreenView != null) {
            exitFullscreen()
            return
        }
        web.evaluateJavascript("(window.bingeTvBack ? window.bingeTvBack() : false) === true") { handled ->
            if (handled != "true") {
                if (web.canGoBack()) web.goBack() else finish()
            }
        }
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
}
