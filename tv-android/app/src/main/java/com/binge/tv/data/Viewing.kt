package com.binge.tv.data

import android.app.Activity
import android.os.Build
import android.view.Display
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.lang.ref.WeakReference

// The Apple TV's viewing features, ported: binge mode, skipping intros per
// show, server speeds shared between Fire TVs, the TV's frame rate.

object Binge {
    // Settings › Binge mode: at the credits the next episode starts straight
    // away, and intros with a known timing are skipped.
    val on get() = Prefs.bool("bingeMode")
}

// Skipping intros automatically, per show: offered after you've skipped two
// episodes' intros by hand (Options › Skip intros automatically).
object IntroSkips {
    fun isOn(show: Title) = Prefs.bool("autoSkip.${show.id}")
    fun set(show: Title, on: Boolean) = Prefs.set("autoSkip.${show.id}", on)
    fun recordManual(show: Title, season: Int, episode: Int): Int {
        val key = "introSkipped.${show.id}"
        val seen = Prefs.string(key)?.split(',')?.filter { it.isNotEmpty() }?.toMutableSet() ?: mutableSetOf()
        seen.add("$season:$episode")
        Prefs.set(key, seen.take(50).joinToString(","))
        return seen.size
    }
    fun shouldOffer(show: Title, skips: Int): Boolean {
        val key = "autoSkipOffered.${show.id}"
        if (skips < 2 || isOn(show) || Prefs.bool(key)) return false
        Prefs.set(key, true)
        return true
    }
}

// What every Fire TV measured about the servers (server_stats, device
// 'fire-tv'): a new or reinstalled one starts from the medians, so its first
// race already goes to the quickest server. Its own timings are shared back.
object SharedServerStats {
    private const val DEVICE = "fire-tv"
    @Serializable private data class Row(val server: String, val startS: Double? = null, val quality: Int? = null)

    suspend fun refresh() {
        val last = Prefs.string("serverStats.fetched")?.toLongOrNull() ?: 0L
        if (System.currentTimeMillis() - last < 12 * 3_600_000L) return
        val rows = runCatching { json.decodeFromString<List<Row>>(Supabase.rpc("server_stats_summary", mapOf("p_device" to DEVICE))) }.getOrNull() ?: return
        Prefs.set("serverStats.fetched", "${System.currentTimeMillis()}")
        rows.forEach { row -> row.startS?.let { com.binge.tv.player.ServerSpeed.seed(row.server, (it * 1000).toLong()) } }
    }

    private val lastReport = HashMap<String, Long>()
    fun report(id: String) {
        if ("://" in id || System.currentTimeMillis() - (lastReport[id] ?: 0) < 600_000) return
        lastReport[id] = System.currentTimeMillis()
        val userId = Supabase.session?.userId ?: return
        val ms = com.binge.tv.player.ServerSpeed.of(id) ?: return
        AppModel.scope.launch {
            runCatching {
                Supabase.upsert("server_stats", "user_id,device,server", mapOf("user_id" to userId, "device" to DEVICE, "server" to id,
                    "start_s" to minOf(120.0, Math.round(ms / 100.0) / 10.0), "updated_at" to IsoDate.now()))
            }
        }
    }
}

// The TV's display mode follows the video's frame rate (a film at 24fps on
// a TV left at 60Hz judders), when the TV offers a mode at the same
// resolution whose refresh rate is a whole multiple of it. Cleared when the
// player closes. Apple's Match Content, on Android: preferredDisplayModeId.
object DisplayMatch {
    var activity: WeakReference<Activity>? = null
    private var applied = false

    fun request(fps: Float) {
        val activity = activity?.get() ?: return
        if (fps < 20f || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        @Suppress("DEPRECATION") val display: Display = activity.windowManager.defaultDisplay
        val current = display.mode
        val best = display.supportedModes
            .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
            .filter { mode -> val ratio = mode.refreshRate / fps; ratio >= 0.99f && kotlin.math.abs(ratio - Math.round(ratio)) < 0.01f }
            .minByOrNull { it.refreshRate } ?: return
        if (best.modeId == current.modeId) return
        activity.window.attributes = activity.window.attributes.apply { preferredDisplayModeId = best.modeId }
        applied = true
    }

    fun clear() {
        if (!applied) return
        val activity = activity?.get() ?: return
        activity.window.attributes = activity.window.attributes.apply { preferredDisplayModeId = 0 }
        applied = false
    }
}
