package com.binge.tv.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

// The notification inbox: the website's bell (src/utils/notificationsInbox.js).
// Every alert binge. sends (new episodes, reminders, your teams' games,
// announcements, server alerts to admins) is kept 30 days in `notifications`.
// The server writes the rows; the TV reads this profile's and the whole
// account's (profile_id null) and marks them read, so an alert read here is
// read on the website too, and the other way round. Same as the Apple TV
// app's Data/Inbox.swift.
@Serializable
data class InboxAlert(
    val id: Long,
    val kind: String,
    val title: String,
    val body: String = "",
    val url: String? = null,
    val createdAt: String,
    val readAt: String? = null,
) {
    val unread get() = readAt == null
    val createdMillis: Long? get() = IsoDate.parse(createdAt)
    val opens: InboxLink? get() = url?.let(InboxLink::parse)

    companion object {
        const val COLUMNS = "id,kind,title,body,url,created_at,read_at"
        const val DAYS = 30
    }
}

// Where opening an alert goes: a title (played straight away when the
// website's link says so: a new episode, a reminder), or Sports. Other links
// (the admin pages, an announcement's page) have no screen on the TV.
sealed class InboxLink {
    data class Open(val kind: MediaKind, val id: Long, val play: Boolean, val season: Int?, val episode: Int?, val seconds: Double?) : InboxLink()
    object Sports : InboxLink()

    companion object {
        // /movie/12, /tv-show/34?play=1&season=2&episode=5, /movie/12?play=1&reminder=7, /sports
        fun parse(link: String): InboxLink? {
            val path = link.substringBefore('?')
            if (path == "/sports") return Sports
            val segments = path.split('/').filter { it.isNotEmpty() }
            if (!link.startsWith("/") || segments.size != 2) return null
            val kind = when (segments[0]) {
                "movie" -> MediaKind.MOVIE
                "tv-show" -> MediaKind.TV
                else -> return null
            }
            val id = segments[1].toLongOrNull() ?: return null
            val query = link.substringAfter('?', "").split('&').filter { '=' in it }
                .associate { it.substringBefore('=') to it.substringAfter('=') }
            return Open(kind, id, query["play"] == "1", query["season"]?.toIntOrNull(), query["episode"]?.toIntOrNull(), query["t"]?.toDoubleOrNull())
        }
    }
}

// The inbox for the profile on screen: loaded when the app opens, every 5
// minutes after (the shell), and when the page opens. Read marks show at
// once and are saved in the background.
object Inbox {
    // null until this profile's inbox has loaded.
    var alerts by mutableStateOf<List<InboxAlert>?>(null)
        private set
    var failed by mutableStateOf(false)
        private set
    private var owner: String? = null
    private var loadedAt = 0L

    val unreadIds: List<Long> get() = alerts.orEmpty().filter { it.unread }.map { it.id }

    // Loads again at most once a minute, unless `force` (opening the page or Try again).
    suspend fun refresh(force: Boolean = false) {
        val session = AppModel.session ?: run { alerts = emptyList(); failed = false; owner = null; return }
        val key = "${session.userId}:${AppModel.profile?.id.orEmpty()}"
        if (key != owner) { alerts = null; failed = false; owner = key; loadedAt = 0L }
        if (!force && System.currentTimeMillis() - loadedAt < 60_000) return
        val query = mutableListOf(
            "select" to InboxAlert.COLUMNS, "user_id" to "eq.${session.userId}",
            "created_at" to "gte.${IsoDate.of(System.currentTimeMillis() - InboxAlert.DAYS * 86_400_000L)}",
            "order" to "created_at.desc", "limit" to "100",
        )
        AppModel.profile?.let { query += "or" to "(profile_id.eq.${it.id},profile_id.is.null)" }
        try {
            val rows = Supabase.selectAs<List<InboxAlert>>("notifications", query)
            if (key != owner) return
            alerts = rows; failed = false; loadedAt = System.currentTimeMillis()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: BingeException) {
            if (key != owner) return
            // No notifications table yet (its migration hasn't run): an empty inbox.
            if (error.status == 404) { alerts = emptyList(); failed = false; loadedAt = System.currentTimeMillis() }
            else if (alerts == null) failed = true
        } catch (error: Exception) {
            // A later failure keeps the list on screen; only a first one says so.
            if (key == owner && alerts == null) failed = true
        }
    }

    // On the app's own scope, so leaving the page doesn't cancel the save.
    fun markRead(ids: Collection<Long>) {
        val wanted = ids.toSet()
        val current = alerts ?: return
        if (wanted.isEmpty()) return
        val now = IsoDate.now()
        alerts = current.map { if (it.id in wanted && it.unread) it.copy(readAt = now) else it }
        AppModel.scope.launch {
            runCatching {
                Supabase.update("notifications", listOf("id" to "in.(${wanted.sorted().joinToString(",")})", "read_at" to "is.null"), mapOf("read_at" to now))
            }
        }
    }
}
