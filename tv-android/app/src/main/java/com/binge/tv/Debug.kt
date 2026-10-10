package com.binge.tv

import android.content.Intent

// Debug builds only: launch straight into a state for testing, e.g.
//   adb shell am start -n com.binge.tv/.MainActivity --ez demo true --es tab sports
//     --es open tv_show:58132 --es play 1:2 --es server vidrift --es multi "dortmund,lens"
object DebugLaunch {
    var demo = false
    var tab: String? = null
    var open: String? = null
    var play: String? = null
    var server: String? = null
    var multi: String? = null
    var live: String? = null
    var embed: String? = null

    fun read(intent: Intent?) {
        if (!BuildConfig.DEBUG || intent == null) return
        demo = intent.getBooleanExtra("demo", false)
        tab = intent.getStringExtra("tab")
        open = intent.getStringExtra("open")
        play = intent.getStringExtra("play")
        server = intent.getStringExtra("server")
        multi = intent.getStringExtra("multi")
        live = intent.getStringExtra("live")
        embed = intent.getStringExtra("embed")
    }
}
