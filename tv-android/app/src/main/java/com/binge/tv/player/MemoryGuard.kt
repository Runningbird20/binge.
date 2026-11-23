package com.binge.tv.player

import android.app.ActivityManager
import android.content.Context

// How much room the TV has left. A Fire Stick shares ~1.7 GB between every
// app and the system, and on 2026-11-22 it ran out mid-film: Amazon's own
// media services were killed, the TV's HDMI sound stuck until the TV itself
// restarted. Extras that only save a few seconds (preloading what you might
// play next, a backup stream while one plays fine) stand down when memory is
// short; the video you're watching never does.
object MemoryGuard {
    private var manager: ActivityManager? = null

    fun init(context: Context) {
        manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    }

    // Under ~300 MB free (the system starts killing apps near 150 MB).
    fun tight(): Boolean {
        val am = manager ?: return false
        val info = ActivityManager.MemoryInfo()
        runCatching { am.getMemoryInfo(info) }.getOrElse { return false }
        val tight = info.lowMemory || info.availMem < maxOf(300L * 1024 * 1024, info.threshold * 2)
        if (tight) Perf.mark("memory tight: ${info.availMem / (1024 * 1024)} MB free, extras skipped")
        return tight
    }
}
