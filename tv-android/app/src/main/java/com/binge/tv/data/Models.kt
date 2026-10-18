package com.binge.tv.data

import kotlinx.serialization.Serializable
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

enum class MediaKind(val raw: String, val table: String, val tmdbPath: String) {
    MOVIE("movie", "movies", "movie"),
    TV("tv_show", "tv_shows", "tv");

    companion object { fun of(raw: String) = if (raw == "tv_show" || raw == "tv") TV else MOVIE }
}

// A title from binge.'s catalog (the site's movies / tv_shows tables),
// optionally decorated with TMDB art.
data class Title(
    val kind: MediaKind,
    val dbId: Long,
    val name: String,
    val year: Int? = null,
    val overview: String? = null,
    val genre: String? = null,
    val ageRating: String? = null,
    val poster: String? = null,
    val backdrop: String? = null,
    val tmdbId: Int? = null,
    val comingSoon: Boolean = false,
    val badge: String? = null,
    val originalLanguage: String? = null,
) {
    val id: String get() = "${kind.raw}:$dbId"

    val metaLine: String
        get() = listOfNotNull(
            year?.toString(), ageRating,
            genre?.split(",")?.take(2)?.joinToString(", ") { it.trim() },
        ).filter { it.isNotEmpty() }.joinToString("  ·  ")
}

@Serializable
data class CatalogRow(
    val id: Long,
    val title: String,
    val year: Int? = null,
    val genre: String? = null,
    val overview: String? = null,
    val posterUrl: String? = null,
    val sourceKey: String? = null,
    val ageRating: String? = null,
    val originalLanguage: String? = null,
) {
    fun asTitle(kind: MediaKind) = Title(
        kind = kind, dbId = id, name = title, year = year, overview = overview, genre = genre, ageRating = ageRating,
        poster = posterUrl, tmdbId = sourceKey?.substringAfterLast(':')?.toIntOrNull(), originalLanguage = originalLanguage,
    )

    companion object { const val COLUMNS = "id,title,year,genre,overview,poster_url,source_key,age_rating,original_language" }
}

@Serializable
data class AccountProfile(
    val id: String,
    val name: String,
    val avatarUrl: String? = null,
    val avatarColor: String? = null,
    val isKids: Boolean = false,
    val isDefault: Boolean = false,
    val audioPref: String? = null,
    val subtitlePref: String? = null,
) {
    val avatarImageUrl: String?
        get() = avatarUrl?.takeIf { it.isNotEmpty() }?.let { if (it.startsWith("/")) Config.siteUrl + it else it }

    companion object { const val COLUMNS = "id,name,avatar_url,avatar_color,is_kids,is_default,audio_pref,subtitle_pref" }
}

@Serializable
data class ContinueRow(
    val id: Long,
    val mediaType: String,
    val mediaId: Long,
    val currentSeason: Int? = null,
    val currentEpisode: Int? = null,
    val positionSeconds: Double? = null,
    val durationSeconds: Double? = null,
    val updatedAt: String? = null,
) {
    val updatedMillis: Long? get() = updatedAt?.let(IsoDate::parse)

    companion object { const val COLUMNS = "id,media_type,media_id,current_season,current_episode,position_seconds,duration_seconds,updated_at" }
}

object IsoDate {
    fun parse(text: String): Long? {
        val trimmed = text.replace(Regex("(\\.\\d{3})\\d+"), "$1").replace("Z", "+00:00")
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX")) {
            runCatching { return SimpleDateFormat(pattern, Locale.US).parse(trimmed)?.time }.getOrNull()
        }
        return null
    }

    fun now(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(System.currentTimeMillis())

    fun day(text: String?): Long? = text?.take(10)?.let {
        runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(it)?.time }.getOrNull()
    }
}

data class ContinueItem(
    val title: Title,
    val season: Int?,
    val episode: Int?,
    val position: Double?,
    val duration: Double?,
    val newEpisode: String? = null,
    val seasonNote: String? = null,
) {
    val id: String get() = title.id
    val progress: Float?
        get() = if (position != null && duration != null && duration > 0) (position / duration).toFloat().coerceIn(0f, 1f) else null
    val episodeLabel: String?
        get() = if (title.kind == MediaKind.TV && season != null && episode != null) "S$season:E$episode" else null
}

@Serializable
data class WatchlistRow(val id: Long, val mediaType: String, val mediaId: Long)

// Same rule as the site's releaseWindow.js: released → shown; out within
// 30 days → shown as Coming Soon; later → hidden.
object ReleaseWindow {
    private fun daysUntil(value: String?): Double? = IsoDate.day(value)?.let { (it - System.currentTimeMillis()) / 86_400_000.0 }
    fun isRecent(value: String?, days: Double): Boolean = daysUntil(value)?.let { it <= 0 && it > -days } ?: false
    fun isVisible(value: String?): Boolean = (daysUntil(value) ?: 0.0) <= 30
    fun isComingSoon(value: String?): Boolean = daysUntil(value)?.let { it > 0 && it <= 30 } ?: false
}

// Kids profiles only see titles rated for kids (unknown ratings are left out).
object KidsFilter {
    private val allowed = setOf("G", "PG", "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG")
    fun allows(rating: String?) = rating != null && rating.uppercase() in allowed
}
