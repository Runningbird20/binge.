package com.binge.tv.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import java.util.Locale

// This device's settings (the Apple TV app's UserDefaults). A change bumps
// `version`, so screens that read settings recompose.
object Prefs {
    private lateinit var prefs: SharedPreferences
    var version by mutableIntStateOf(0)
        private set

    fun init(context: Context) { prefs = context.getSharedPreferences("binge.settings", Context.MODE_PRIVATE) }

    fun string(key: String, default: String? = null): String? = prefs.getString(key, default)
    fun bool(key: String, default: Boolean = false): Boolean = prefs.getBoolean(key, default)
    fun int(key: String, default: Int = 0): Int = prefs.getInt(key, default)
    fun has(key: String) = prefs.contains(key)

    fun set(key: String, value: Any?) {
        prefs.edit().apply {
            when (value) {
                null -> remove(key)
                is String -> putString(key, value)
                is Boolean -> putBoolean(key, value)
                is Int -> putInt(key, value)
                else -> putString(key, value.toString())
            }
        }.apply()
        version++
    }
}

// Playback preferences: audio/subtitle language live on the profile
// (account_profiles, shared with the website); the rest is per device.
object PlaybackPrefs {
    val audioChoices = listOf("original" to "Original language", "en" to "English", "es" to "Spanish", "fr" to "French",
        "ja" to "Japanese", "ko" to "Korean", "hi" to "Hindi")
    val subtitleChoices = listOf("off" to "Off", "en" to "English", "es" to "Spanish", "fr" to "French",
        "pt" to "Portuguese", "de" to "German", "ar" to "Arabic")
    val captionSizes = listOf(80 to "Small", 100 to "Default", 135 to "Large", 175 to "Extra large")
    val captionBackgrounds = listOf("transparent" to "None", "rgba(0,0,0,0.6)" to "Shaded", "rgba(0,0,0,1)" to "Solid")

    var audio = "original"
    var subtitle = "en"

    val captionSize get() = Prefs.int("captionSize", 100)
    val captionBackground get() = Prefs.string("captionBackground", "rgba(0,0,0,0.6)")!!
    val audioDescription get() = Prefs.bool("audioDescription")
    val skipIntroButton get() = Prefs.bool("skipIntroButton", true)
    val fillScreen get() = Prefs.bool("fillScreen", true)
    val ambient get() = Prefs.bool("ambient", true)
    val trailers get() = Prefs.bool("trailers", true)
    val largeText get() = Prefs.bool("largeText")
    val multiviewLayout get() = Prefs.string("multiviewLayout", "grid")!!

    fun languageName(code: String): String =
        Locale(code).getDisplayLanguage(Locale.ENGLISH).takeIf { it.isNotEmpty() && it != code } ?: code
}

// "Best quality" (default) waits a moment after the first stream plays and
// keeps the sharpest; "Fastest start" takes the first one.
enum class QualityPreference(val raw: String, val label: String) {
    BEST("best", "Best quality"), FASTEST("fastest", "Fastest start");
    companion object { val current get() = entries.firstOrNull { it.raw == Prefs.string("quality") } ?: BEST }
}
