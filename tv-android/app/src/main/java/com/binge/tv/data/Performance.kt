package com.binge.tv.data

import android.app.ActivityManager
import android.content.Context

// What this TV can afford. Fire TV sticks have 1–2 GB shared by the app, its
// WebView video pages and the picture cache, and slow CPUs: there, focus
// zoom and ambient mode's slow pan cost frames that scrolling and video need.
// "Lighter effects" (Settings) is on by default on those devices.
object Performance {
    var lowMemory = false
        private set

    fun init(context: Context) {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo().also { manager.getMemoryInfo(it) }
        lowMemory = manager.isLowRamDevice || info.totalMem < 2_500L * 1024 * 1024
    }

    val light get() = Prefs.bool("lightEffects", lowMemory)

    // How much a focused card/button grows (none with lighter effects).
    fun focusScale(normal: Float) = if (light) 1f else normal
}
