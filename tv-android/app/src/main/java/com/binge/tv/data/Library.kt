package com.binge.tv.data

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

// The Apple TV app's Data/Library.swift, ported: watched titles, episodes
// marked by hand, finished shows, reminders, recent searches, Hide scores.

// MARK: Watched titles (never recommended)

// Rated, marked Watched/Watching, in Continue Watching, or any episode
// watched: left out of every browse row, the spotlight, More Like This and
// Surprise me (the website's utils/watchedTitles.js). Reused for a minute.
object WatchedTitles {
    var keys: Set<String> = emptySet(); private set
    private var who: String? = null
    private var fetchedAt = 0L

    fun invalidate() { fetchedAt = 0L }

    @Serializable private data class Row(val mediaId: Long, val mediaType: String? = null)

    suspend fun load(force: Boolean = false): Set<String> {
        if (!AppModel.isSignedIn) return emptySet()
        val current = "${AppModel.session?.userId}:${AppModel.profile?.id}"
        if (!force && who == current && System.currentTimeMillis() - fetchedAt < 60_000) return keys
        val owner = AppModel.ownerFilter
        suspend fun all(table: String, columns: String, extra: List<Pair<String, String>> = emptyList()): List<Row> {
            val rows = ArrayList<Row>()
            for (page in 0 until 10) {
                val batch = runCatching {
                    Supabase.selectAs<List<Row>>(table, listOf("select" to columns, "order" to "id", "limit" to "1000", "offset" to "${page * 1000}") + extra + owner)
                }.getOrDefault(emptyList())
                rows += batch
                if (batch.size < 1000) break
            }
            return rows
        }
        val found = coroutineScope {
            val movies = async { all("movie_ratings", "media_id") }
            val shows = async { all("tv_show_ratings", "media_id") }
            val list = async { all("watchlist", "media_id,media_type", listOf("media_type" to "in.(movie,tv_show)", "status" to "in.(watched,watching)")) }
            val started = async { all("continue_watching", "media_id,media_type", listOf("media_type" to "in.(movie,tv_show)")) }
            val episodes = async { all("episode_progress", "media_id") }
            buildSet {
                movies.await().forEach { add("movie:${it.mediaId}") }
                shows.await().forEach { add("tv_show:${it.mediaId}") }
                (list.await() + started.await()).forEach { row -> row.mediaType?.let { add("$it:${row.mediaId}") } }
                episodes.await().forEach { add("tv_show:${it.mediaId}") }
            }
        }
        who = current; keys = found; fetchedAt = System.currentTimeMillis()
        return found
    }

    fun without(titles: List<Title>, keys: Set<String>) = if (keys.isEmpty()) titles else titles.filter { it.id !in keys }
    fun withoutInRows(rows: List<LoadedRow>, keys: Set<String>) = rows.mapNotNull { row ->
        without(row.items, keys).takeIf { it.isNotEmpty() }?.let { row.copy(items = it) }
    }
}

// MARK: Episodes marked by hand

data class EpisodeKey(val season: Int, val episode: Int) : Comparable<EpisodeKey> {
    override fun compareTo(other: EpisodeKey) = compareValuesBy(this, other, { it.season }, { it.episode })
}

object EpisodeMarking {
    // "Watched up to here": every aired episode before this one (earlier
    // seasons too) and this one. Specials (season 0) aren't included.
    fun upTo(target: EpisodeKey, seasons: List<TmdbDetails.Season>, lastAired: EpisodeKey?): List<EpisodeKey> = buildList {
        seasons.filter { it.seasonNumber in 1..target.season }.forEach { season ->
            val count = if (season.seasonNumber == target.season) target.episode else season.episodeCount ?: 0
            for (episode in 1..count) {
                val key = EpisodeKey(season.seasonNumber, episode)
                if (lastAired != null && key > lastAired && key != target) continue
                add(key)
            }
        }
    }

    fun season(number: Int, episodes: List<TmdbSeason.Episode>, lastAired: EpisodeKey?) =
        episodes.filter { it.seasonNumber == number }.map { EpisodeKey(it.seasonNumber, it.episodeNumber) }
            .filter { key -> lastAired == null || key <= lastAired }

    // The episode after the furthest one marked, if it has aired.
    fun next(after: List<EpisodeKey>, seasons: List<TmdbDetails.Season>, lastAired: EpisodeKey?): EpisodeKey? {
        val last = after.maxOrNull() ?: return null
        val regular = seasons.filter { it.seasonNumber > 0 }
        val count = regular.firstOrNull { it.seasonNumber == last.season }?.episodeCount
        val next = when {
            count != null && last.episode < count -> EpisodeKey(last.season, last.episode + 1)
            regular.any { it.seasonNumber == last.season + 1 && (it.episodeCount ?: 0) > 0 } -> EpisodeKey(last.season + 1, 1)
            else -> null
        } ?: return null
        return if (lastAired != null && next > lastAired) null else next
    }
}

object EpisodeStore {
    @Serializable private data class Row(val season: Int, val episode: Int, val watchedAt: String? = null, val mediaId: Long? = null)

    suspend fun watched(title: Title): Set<EpisodeKey> {
        if (!AppModel.isSignedIn) return emptySet()
        return runCatching {
            Supabase.selectAs<List<Row>>("episode_progress", listOf("select" to "season,episode", "media_id" to "eq.${title.dbId}", "limit" to "5000") + AppModel.ownerFilter)
        }.getOrDefault(emptyList()).map { EpisodeKey(it.season, it.episode) }.toSet()
    }

    // When each was watched (none for ones marked by hand), so an undo puts the real times back.
    suspend fun times(title: Title, episodes: List<EpisodeKey>): Map<EpisodeKey, String> {
        if (!AppModel.isSignedIn || episodes.isEmpty()) return emptyMap()
        val wanted = episodes.toSet()
        return runCatching {
            Supabase.selectAs<List<Row>>("episode_progress", listOf("select" to "season,episode,watched_at", "media_id" to "eq.${title.dbId}",
                "season" to "in.(${episodes.map { it.season }.distinct().joinToString(",")})", "limit" to "5000") + AppModel.ownerFilter)
        }.getOrDefault(emptyList()).mapNotNull { row ->
            val key = EpisodeKey(row.season, row.episode)
            row.watchedAt?.takeIf { key in wanted }?.let { key to it }
        }.toMap()
    }

    // Hand-marked rows have no watch time (watched elsewhere); rows that
    // exist already are left alone, real watch times included.
    suspend fun mark(title: Title, episodes: List<EpisodeKey>, watchedAt: Map<EpisodeKey, String> = emptyMap()) {
        val session = AppModel.session ?: throw SignedOutException()
        if (episodes.isEmpty()) return
        episodes.chunked(500).forEach { chunk ->
            Supabase.insertIgnoringDuplicates("episode_progress", "user_id,media_id,season,episode,profile_id", chunk.map {
                mapOf("user_id" to session.userId, "profile_id" to AppModel.profile?.id, "media_id" to title.dbId,
                    "season" to it.season, "episode" to it.episode, "watched_at" to watchedAt[it])
            })
        }
        WatchedTitles.invalidate()
    }

    suspend fun unmark(title: Title, episodes: List<EpisodeKey>) {
        if (!AppModel.isSignedIn) throw SignedOutException()
        episodes.groupBy { it.season }.forEach { (season, list) ->
            Supabase.delete("episode_progress", listOf("media_id" to "eq.${title.dbId}", "season" to "eq.$season",
                "episode" to "in.(${list.joinToString(",") { "${it.episode}" }})") + AppModel.ownerFilter)
        }
        WatchedTitles.invalidate()
    }

    // Move Continue Watching for a show (or put back what it was).
    suspend fun setResume(title: Title, season: Int, episode: Int, position: Double = 0.0, duration: Double = 0.0) {
        val row = AppModel.resumePoint(title) ?: return
        runCatching {
            Supabase.update("continue_watching", listOf("id" to "eq.${row.id}"), mapOf(
                "current_season" to season, "current_episode" to episode, "position_seconds" to position.toInt(),
                "duration_seconds" to duration.toInt(), "updated_at" to IsoDate.now()))
        }
    }

    // Shows whose newest aired episode is watched, with nothing saved
    // partway: finished, so they leave Continue Watching.
    suspend fun finished(items: List<ContinueItem>, lastAired: Map<String, EpisodeKey>): Set<String> {
        val candidates = items.filter { it.title.kind == MediaKind.TV && lastAired[it.id] != null && (it.position ?: 0.0) <= 0 }
        if (!AppModel.isSignedIn || candidates.isEmpty()) return emptySet()
        val rows = runCatching {
            Supabase.selectAs<List<Row>>("episode_progress", listOf("select" to "media_id,season,episode",
                "media_id" to "in.(${candidates.joinToString(",") { "${it.title.dbId}" }})", "limit" to "10000") + AppModel.ownerFilter)
        }.getOrDefault(emptyList())
        val watched = rows.map { "${it.mediaId}:${it.season}:${it.episode}" }.toSet()
        return candidates.filter { item -> lastAired[item.id]?.let { "${item.title.dbId}:${it.season}:${it.episode}" in watched } == true }.map { it.id }.toSet()
    }
}

// MARK: Reminders (watch_reminders, same table as the website)

@Serializable
data class Reminder(val id: Long, val mediaType: String, val mediaId: Long, val title: String, val remindAt: String)

object Reminders {
    suspend fun list(dueOnly: Boolean): List<Reminder> {
        val session = AppModel.session ?: return emptyList()
        val query = mutableListOf("select" to "id,media_type,media_id,title,remind_at", "user_id" to "eq.${session.userId}",
            "dismissed_at" to "is.null", "media_type" to "in.(movie,tv_show)", "order" to "remind_at.asc", "limit" to "50")
        AppModel.profile?.let { query += "profile_id" to "eq.${it.id}" }
        query += if (dueOnly) "remind_at" to "lte.${IsoDate.now()}" else "sent_at" to "is.null"
        return runCatching { Supabase.selectAs<List<Reminder>>("watch_reminders", query) }.getOrDefault(emptyList())
    }

    suspend fun add(title: Title, at: Long) {
        val session = AppModel.session ?: throw SignedOutException()
        Supabase.insert("watch_reminders", mapOf(
            "user_id" to session.userId, "profile_id" to AppModel.profile?.id, "media_type" to title.kind.raw,
            "media_id" to title.dbId, "title" to title.name, "url" to "/${if (title.kind == MediaKind.MOVIE) "movie" else "tv-show"}/${title.dbId}",
            "remind_at" to SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(java.util.Date(at)),
        ))
    }

    suspend fun dismiss(id: Long) {
        runCatching { Supabase.update("watch_reminders", listOf("id" to "eq.$id"), mapOf("dismissed_at" to IsoDate.now())) }
    }

    // What's coming and when: a movie's release, or a series' next episode, 9 that morning.
    fun upcoming(title: Title, details: TmdbDetails?, now: Long = System.currentTimeMillis()): Pair<String, Long>? {
        fun morning(text: String?): Long? {
            val day = IsoDate.day(text) ?: return null
            val cal = Calendar.getInstance().apply { timeInMillis = day; set(Calendar.HOUR_OF_DAY, 9); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0) }
            val today = Calendar.getInstance().apply { timeInMillis = now; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
            return if (day > today.timeInMillis + 86_399_000L) cal.timeInMillis else null
        }
        if (title.kind == MediaKind.MOVIE) morning(details?.releaseDate)?.let { return "Remind me when it's out" to it }
        details?.nextEpisodeToAir?.let { next -> morning(next.airDate)?.let { return "Remind me about S${next.seasonNumber}:E${next.episodeNumber}" to it } }
        return null
    }
}

// MARK: Recent searches (per profile, this TV)

object RecentSearches {
    const val LIMIT = 8
    private fun key(profile: String?) = "recentSearches.${profile ?: "none"}"
    fun list(profile: String?): List<String> = Prefs.string(key(profile))?.split('\n')?.filter { it.isNotBlank() }.orEmpty()
    fun add(query: String, profile: String?) {
        val text = query.trim()
        if (text.length < 2) return
        val next = (listOf(text) + list(profile).filter { !it.equals(text, ignoreCase = true) }).take(LIMIT)
        Prefs.set(key(profile), next.joinToString("\n"))
    }
    fun clear(profile: String?) = Prefs.set(key(profile), null)
}

// MARK: Hide scores (Sports), the website's setting name

object ScoreVisibility {
    const val KEY = "sports.hideScores"
    val hidden get() = Prefs.bool(KEY)
}
