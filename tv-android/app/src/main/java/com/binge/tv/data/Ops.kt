package com.binge.tv.data

import android.content.Context
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

// Messages posted from the admin panel (site_announcements), as on the
// website and the Apple TV. Dismissing one hides it on this TV.
object Announcements {
    @Serializable data class Announcement(val id: Long, val message: String, val level: String? = null,
        val linkUrl: String? = null, val linkLabel: String? = null, val endsAt: String? = null)

    private const val DISMISSED = "dismissedAnnouncements"

    suspend fun current(): Announcement? {
        val rows = runCatching {
            Supabase.selectAs<List<Announcement>>("site_announcements", listOf(
                "select" to "id,message,level,link_url,link_label,ends_at", "active" to "eq.true",
                "starts_at" to "lte.${IsoDate.now()}", "order" to "created_at.desc", "limit" to "5"), Supabase.Auth.OPTIONAL)
        }.getOrDefault(emptyList())
        val hidden = Prefs.string(DISMISSED)?.split(',')?.toSet().orEmpty()
        val now = System.currentTimeMillis()
        return rows.firstOrNull { row -> "${row.id}" !in hidden && (row.endsAt?.let(IsoDate::parse)?.let { it > now } ?: true) }
    }

    fun dismiss(id: Long) {
        val hidden = Prefs.string(DISMISSED)?.split(',').orEmpty().filter { it.isNotEmpty() }
        Prefs.set(DISMISSED, (hidden + "$id").takeLast(50).joinToString(","))
    }
}

// Crashes go to the admin panel's Errors tab (POST /api/ops/errors), like
// the website and the Apple TV: written to a file as the app dies, sent on
// the next launch. Also "no server could play", once a day per episode.
object CrashReporter {
    private var file: File? = null

    fun install(context: Context) {
        val target = File(context.cacheDir, "last-crash.txt")
        file = target
        sendPending(target)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { target.writeText("Crashed: ${error::class.java.name}: ${error.message}\n${error.stackTraceToString().take(4000)}") }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun sendPending(target: File) {
        val text = runCatching { target.readText() }.getOrNull()?.takeIf { it.isNotBlank() } ?: return
        target.delete()
        val lines = text.lines()
        report("Fire TV app: ${lines.first()}", lines.drop(1).joinToString("\n"))
    }

    fun report(message: String, stack: String? = null, place: String = "fire-tv") {
        val body = toJson(mapOf("message" to message.take(1000), "stack" to stack.orEmpty().take(4000), "url" to place,
            "release" to "android-${com.binge.tv.BuildConfig.VERSION_NAME}-${com.binge.tv.BuildConfig.VERSION_CODE}")).toString()
        AppModel.scope.launch {
            runCatching {
                val token = runCatching { Supabase.validSession().accessToken }.getOrNull()
                val request = Request.Builder().url("${Config.siteUrl}/api/ops/errors")
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .apply { if (token != null) header("Authorization", "Bearer $token") }
                    .header("User-Agent", "binge-fire-tv/${com.binge.tv.BuildConfig.VERSION_NAME}")
                    .build()
                Net.send(request)
            }
        }
    }
}
