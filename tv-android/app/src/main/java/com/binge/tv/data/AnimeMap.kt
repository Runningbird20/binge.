package com.binge.tv.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Which AniList entry and episode a TMDB title is, for the anime server
// (AniXo finds a show by its AniList id): the site's /anime-map.json, written
// by scripts/generate-anime-map.js from Fribb's anime-lists. Twin of the
// website's utils/animeMap.js. tv rows are [tmdbSeason, anilistId, offset]:
// season -1 is an AniList entry running the series' own numbers (One Piece),
// and AniList episode = TMDB episode - offset (Frieren's season 1 holds three
// AniList entries, from episodes 1, 29 and 39).
@Serializable
data class AnimeMapFile(val tv: Map<String, List<List<Int>>> = emptyMap(), val movie: Map<String, Int> = emptyMap())

object AnimeMap {
    data class Ref(val id: Int, val episode: Int)

    private var cached: AnimeMapFile? = null

    suspend fun load(): AnimeMapFile? {
        cached?.let { return it }
        // Debug builds can point at another copy (-e animeMap <url or a path on the TV>).
        val other = com.binge.tv.DebugLaunch.animeMapUrl
        val body = (if (other != null && other.startsWith("/")) runCatching { java.io.File(other).readText() }.getOrNull()
            else Net.text(other ?: "${Config.siteUrl}/anime-map.json")) ?: return null
        return runCatching { plainJson.decodeFromString<AnimeMapFile>(body) }.getOrNull()?.also { cached = it }
    }

    // Animated and not known to be non-Japanese (the catalog's language is often empty).
    fun maybeAnime(title: Title): Boolean {
        val language = title.originalLanguage
        return language == "ja" || (title.genre.orEmpty().contains("animation", ignoreCase = true) && language.isNullOrEmpty())
    }

    // The map's rows for this title, or null when it isn't anime it has.
    suspend fun rows(title: Title): List<List<Int>>? {
        val tmdbId = title.tmdbId ?: return null
        if (!maybeAnime(title)) return null
        val file = kotlinx.coroutines.withTimeoutOrNull(1500) { load() } ?: return null
        return if (title.kind == MediaKind.TV) file.tv["$tmdbId"]?.takeIf { it.isNotEmpty() }
        else file.movie["$tmdbId"]?.let { listOf(listOf(-1, it, 0)) }
    }

    // A season split over several AniList entries is matched by offset. A
    // series-wide entry is used for the first season, or for a season numbered
    // from the series' start (its episode numbers run past any one season's).
    fun episode(rows: List<List<Int>>, kind: MediaKind, season: Int, episode: Int): Ref? {
        if (kind != MediaKind.TV) return rows.firstOrNull()?.let { Ref(it[1], 1) }
        rows.firstOrNull { it.size >= 3 && it[0] == season && episode > it[2] }?.let { return Ref(it[1], episode - it[2]) }
        val whole = rows.firstOrNull { it.isNotEmpty() && it[0] == -1 } ?: return null
        return if (season == 1 || episode > 50) Ref(whole[1], episode) else null
    }
}

// Sub or dub on the anime server: per show what was last picked in the player,
// else the profile's default (Settings › Anime on the website, account_profiles
// .settings.animeTrack), else sub.
object AnimeTrack {
    private fun key(title: Title) = "animeTrack.${AppModel.profile?.id ?: "none"}.${title.kind.raw}:${title.dbId}"

    fun get(title: Title): String {
        Prefs.string(key(title))?.takeIf { it == "sub" || it == "dub" }?.let { return it }
        val setting = ((AppModel.profile?.settings as? JsonObject)?.get("animeTrack") as? JsonPrimitive)?.takeIf { it.isString }?.content
        return if (setting == "dub") "dub" else "sub"
    }

    fun set(title: Title, track: String) { Prefs.set(key(title), track) }
}
