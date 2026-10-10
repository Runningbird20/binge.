package com.binge.tv

import android.app.Application
import android.content.ComponentCallbacks2
import android.os.Bundle
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import com.binge.tv.data.Prefs
import com.binge.tv.data.PlaybackPrefs
import com.binge.tv.data.Supabase
import com.binge.tv.player.Warmup
import com.binge.tv.player.inert
import com.binge.tv.ui.Ambient
import com.binge.tv.ui.BingeApp
import com.binge.tv.ui.BingeTheme
import com.binge.tv.ui.Nav
import com.binge.tv.ui.PlayerLifecycle
import com.binge.tv.ui.Screen

class BingeApplication : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
        Supabase.init(this)
    }

    // A Fire TV stick has 1–2 GB for everything: a modest memory cache, a
    // generous disk cache (posters come back instantly), fades on load.
    override fun newImageLoader() = ImageLoader.Builder(this)
        .memoryCache { MemoryCache.Builder(this).maxSizePercent(0.15).build() }
        .diskCache { DiskCache.Builder().directory(cacheDir.resolve("images")).maxSizeBytes(300L * 1024 * 1024).build() }
        .crossfade(180)
        .respectCacheHeaders(false)
        .build()
}

/**
 * binge. for Fire TV / Android TV: a native app (Compose for TV), a port of
 * the Apple TV app. Same Supabase account and data as the website; movies,
 * series and sports play in the app's own player (see player/), which
 * drives each server's page through a script in every frame, blocks pop-ups
 * and redirects, and draws its own subtitles.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        DebugLaunch.read(intent)
        if (BuildConfig.DEBUG) android.webkit.WebView.setWebContentsDebuggingEnabled(true)
        val root = FrameLayout(this)
        // Preloads (Warmup) live here: in the window, behind the app, invisible.
        val warmHost = FrameLayout(this).apply { alpha = 0.01f; inert() }
        root.addView(warmHost, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        Warmup.host = warmHost
        val compose = ComposeView(this).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                // Re-read when a setting changes.
                @Suppress("UNUSED_VARIABLE") val version = Prefs.version
                BingeTheme(largeText = PlaybackPrefs.largeText) { BingeApp() }
                // The screen stays on while something plays (or ambient mode shows); otherwise the TV may sleep as usual.
                val awake = Ambient.showing || Nav.stack.any { it is Screen.Player || it is Screen.Multiview }
                LaunchedEffect(awake) {
                    if (awake) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }
        root.addView(compose, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        Ambient.touch()
        return super.dispatchKeyEvent(event)
    }

    // Home button, input switch or the screensaver: pause and save, like any streaming app.
    override fun onPause() {
        PlayerLifecycle.current?.onAppPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        PlayerLifecycle.current?.onAppResume()
    }

    override fun onStop() {
        Warmup.cancel()
        super.onStop()
    }

    // Low memory: a preload is the first thing to go, then live upgrade shopping.
    @Deprecated("Deprecated in Java")
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            Warmup.cancel()
            PlayerLifecycle.current?.trimMemory()
        }
    }

    override fun onDestroy() {
        if (Warmup.host?.context === this) { Warmup.cancel(); Warmup.host = null }
        super.onDestroy()
    }
}
