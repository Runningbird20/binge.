package com.binge.tv.data

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

// Site features reused by the TV app: admin server switches, outside
// ratings, the AI search and franchise order. Same tables / endpoints.

object ServerSwitches {
    private var disabled: Set<String> = emptySet()
    private var fetchedAt = 0L

    @Serializable private data class Row(val provider: String, val enabled: Boolean)

    // Servers an admin has turned off in the panel. Refreshed every 2 min.
    suspend fun disabledServers(): Set<String> {
        if (System.currentTimeMillis() - fetchedAt < 120_000) return disabled
        runCatching { Supabase.selectAs<List<Row>>("server_config", listOf("select" to "provider,enabled"), Supabase.Auth.OPTIONAL) }
            .getOrNull()?.let { rows -> disabled = rows.filter { !it.enabled }.map { it.provider }.toSet(); fetchedAt = System.currentTimeMillis() }
        return disabled
    }
}

// The title's own language: the catalog's, or TMDB's when the catalog row doesn't have one.
object OriginalLanguage {
    suspend fun of(title: Title): String? {
        title.originalLanguage?.takeIf { it.isNotEmpty() }?.let { return it }
        val tmdbId = title.tmdbId ?: return null
        return runCatching { Tmdb.get<TmdbDetails>("${title.kind.tmdbPath}/$tmdbId") }.getOrNull()?.originalLanguage
    }
}

@Serializable
data class OutsideRatings(val imdbRating: Double? = null, val imdbVotes: Int? = null, val rottenTomatoes: Int? = null, val metacritic: Int? = null) {
    companion object {
        // Looked up by the site's server (its OMDb key stays server-side) and cached in title_ratings.
        suspend fun load(title: Title): OutsideRatings? {
            val tmdbId = title.tmdbId ?: return null
            val body = Net.text("${Config.siteUrl}/api/extras/ratings?type=${if (title.kind == MediaKind.TV) "tv" else "movie"}&tmdb=$tmdbId") ?: return null
            val ratings = runCatching { json.decodeFromString<OutsideRatings>(body) }.getOrNull() ?: return null
            return if (ratings.imdbRating == null && ratings.rottenTomatoes == null) null else ratings
        }
    }
}

// Ask binge. (the site's Groq-backed /api/extras/ai/picks)
object AskBinge {
    @Serializable data class Pick(val tmdbId: Int, val mediaType: String, val why: String? = null)
    @Serializable data class Response(val summary: String? = null, val picks: List<Pick>? = null, val error: String? = null)

    fun isConversational(query: String): Boolean {
        val words = query.trim().split(Regex("\\s+"))
        val lower = query.lowercase()
        val spoken = listOf("show me", "find me", "i want", "i'm in the mood", "im in the mood", "recommend", "what should i", "give me", "play something")
        if (spoken.any { lower.startsWith(it) }) return true
        val cues = listOf("like ", "something", "movies ", "shows ", "series ", "funny", "scary", "under ", "about ", "with ", "for a ", "feel", "similar")
        return words.size >= 4 || (cues.any { lower.contains(it) } && words.size >= 3)
    }

    private val slowClient = Net.client.newBuilder().readTimeout(30, TimeUnit.SECONDS).build()

    suspend fun ask(query: String, kids: Boolean): Pair<String?, List<Pair<Title, String?>>> = coroutineScope {
        val request = Request.Builder().url("${Config.siteUrl}/api/extras/ai/picks")
            .post(toJson(mapOf("q" to query)).toString().toRequestBody("application/json".toMediaType())).build()
        val body = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { slowClient.newCall(request).execute().use { it.body?.string() ?: "" } }
        val response = json.decodeFromString<Response>(body)
        response.error?.let { throw BingeException(it) }
        val picks = response.picks.orEmpty()
        fun stub(p: Pick) = TmdbItem(id = p.tmdbId)
        val movies = async { Catalog.match(picks.filter { it.mediaType != "tv_show" }.map(::stub), MediaKind.MOVIE, kids) }
        val shows = async { Catalog.match(picks.filter { it.mediaType == "tv_show" }.map(::stub), MediaKind.TV, kids) }
        val byKey = (movies.await() + shows.await()).associateBy { "${it.kind.raw}:${it.tmdbId}" }
        response.summary to picks.mapNotNull { pick -> byKey["${if (pick.mediaType == "tv_show") "tv_show" else "movie"}:${pick.tmdbId}"]?.let { it to pick.why } }
    }
}

// Franchise watch order (same curated lists as src/utils/franchises.js).
object Franchises {
    class Curated(val name: String, val release: List<Int>, val story: List<Int>)
    class Order(val name: String, val release: List<Title>, val story: List<Title>?)

    private val curated = listOf(
        Curated("Marvel Cinematic Universe",
            listOf(1726, 1724, 10138, 10195, 1771, 24428, 68721, 76338, 100402, 118340, 99861, 102899, 271110, 284052, 283995,
                315635, 284053, 284054, 299536, 363088, 299537, 299534, 429617, 497698, 566525, 524434, 634649, 453395, 616037,
                505642, 640146, 447365, 609681, 533535, 822119, 986056, 617126),
            listOf(1771, 299537, 1726, 10138, 1724, 10195, 24428, 76338, 68721, 100402, 118340, 283995, 99861, 102899, 271110,
                497698, 284054, 315635, 284052, 284053, 363088, 299536, 299534, 429617, 566525, 524434, 634649, 453395, 616037,
                505642, 447365, 640146, 609681, 533535, 822119, 986056, 617126)),
        Curated("Star Wars", listOf(11, 1891, 1892, 1893, 1894, 1895, 140607, 330459, 181808, 348350, 181812),
            listOf(1893, 1894, 1895, 348350, 330459, 11, 1891, 1892, 140607, 181808, 181812)),
        Curated("Fast & Furious", listOf(9799, 584, 9615, 13804, 51497, 82992, 168259, 337339, 384018, 385128, 385687),
            listOf(9799, 584, 13804, 51497, 82992, 9615, 168259, 337339, 384018, 385128, 385687)),
    )

    @Serializable private data class CollectionInfo(val name: String, val parts: List<TmdbItem> = emptyList())

    suspend fun find(title: Title, kids: Boolean): Order? = coroutineScope {
        val tmdbId = title.tmdbId
        if (title.kind != MediaKind.MOVIE || tmdbId == null) return@coroutineScope null
        curated.firstOrNull { tmdbId in it.release }?.let { franchise ->
            val matched = runCatching { Catalog.match(franchise.release.map { TmdbItem(id = it) }, MediaKind.MOVIE, kids) }.getOrDefault(emptyList())
            val byId = matched.associateBy { it.tmdbId ?: 0 }
            val posters = byId.keys.map { id -> async { id to runCatching { Tmdb.get<TmdbDetails>("movie/$id") }.getOrNull()?.posterPath } }.awaitAll()
                .mapNotNull { (id, path) -> Tmdb.image(path, Tmdb.POSTER)?.let { id to it } }.toMap()
            fun pick(ids: List<Int>) = ids.mapNotNull { id -> byId[id]?.let { it.copy(poster = posters[id] ?: it.poster) } }
            return@coroutineScope Order(franchise.name, pick(franchise.release), pick(franchise.story))
        }
        val details = runCatching { Tmdb.get<TmdbDetails>("movie/$tmdbId") }.getOrNull()
        val id = details?.belongsToCollection?.id ?: return@coroutineScope null
        val collection = runCatching { Tmdb.get<CollectionInfo>("collection/$id") }.getOrNull() ?: return@coroutineScope null
        val parts = collection.parts.filter { !it.releaseDate.isNullOrEmpty() }.sortedBy { it.releaseDate }
        val titles = runCatching { Catalog.match(parts, MediaKind.MOVIE, kids) }.getOrDefault(emptyList())
        if (titles.size < 2) null else Order(collection.name.replace(" Collection", ""), titles, null)
    }
}

// Subtitles from OpenSubtitles (through the site's /api/extras/subtitles,
// which caches each file for everyone), drawn by the app on top of any server.
data class SubtitleCue(val start: Double, val end: Double, val text: String)

data class ExternalSubtitleFile(val cues: List<SubtitleCue>, val release: String?, val versions: Int, val version: Int) {
    // The line(s) on screen at a given second (cues are sorted by start).
    fun text(at: Double): String {
        var low = 0; var high = cues.size
        while (low < high) { val mid = (low + high) / 2; if (cues[mid].start <= at) low = mid + 1 else high = mid }
        val lines = ArrayList<String>()
        var index = low - 1
        while (index >= 0 && lines.size < 3) {
            val cue = cues[index]
            if (cue.end > at) lines.add(0, cue.text)
            if (at - cue.start > 15) break
            index--
        }
        return lines.joinToString("\n")
    }
}

object ExternalSubtitles {
    suspend fun load(title: Title, season: Int?, episode: Int?, language: String, version: Int = 0): ExternalSubtitleFile? {
        val tmdbId = title.tmdbId ?: return null
        if (language == "off") return null
        val url = "${Config.siteUrl}/api/extras/subtitles".toHttpUrl().newBuilder().apply {
            addQueryParameter("type", if (title.kind == MediaKind.TV) "tv" else "movie")
            addQueryParameter("tmdb", "$tmdbId")
            addQueryParameter("lang", language)
            addQueryParameter("version", "$version")
            if (title.kind == MediaKind.TV) { addQueryParameter("season", "${season ?: 1}"); addQueryParameter("episode", "${episode ?: 1}") }
        }.build().toString()
        if (com.binge.tv.BuildConfig.DEBUG) android.util.Log.d("binge", "subtitles $url")
        val body = Net.text(url) ?: return null
        val root = runCatching { plainJson.parseToJsonElement(body) as kotlinx.serialization.json.JsonObject }.getOrNull() ?: return null
        fun str(key: String) = (root[key] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
        val vtt = str("vtt") ?: return null
        val cues = parse(vtt)
        if (cues.isEmpty()) return null
        val versions = (root["versions"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() ?: 1
        return ExternalSubtitleFile(cues, str("release"), versions, version)
    }

    // WebVTT (and SRT-style comma decimals): blocks of "start --> end" + text.
    fun parse(vtt: String): List<SubtitleCue> {
        val normalized = vtt.replace("\r\n", "\n").replace("\r", "\n")
        val cues = ArrayList<SubtitleCue>()
        for (block in normalized.split("\n\n")) {
            val lines = block.split("\n")
            val timing = lines.indexOfFirst { it.contains("-->") }.takeIf { it >= 0 } ?: continue
            val parts = lines[timing].split("-->")
            if (parts.size != 2) continue
            val start = seconds(parts[0]) ?: continue
            val end = seconds(parts[1].trim().split(" ").first()) ?: continue
            val text = lines.drop(timing + 1).joinToString("\n")
                .replace(Regex("<[^>]+>"), "").replace(Regex("\\{\\\\[^}]*\\}"), "")
                .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").trim()
            if (text.isNotEmpty() && end > start) cues += SubtitleCue(start, end, text)
        }
        return cues.sortedBy { it.start }
    }

    // "01:02:03.456", "02:03.456" or "01:02:03,456".
    fun seconds(raw: String): Double? {
        val parts = raw.trim().replace(",", ".").split(":")
        if (parts.size !in 2..3) return null
        var total = 0.0
        for (part in parts) total = total * 60 + (part.toDoubleOrNull() ?: return null)
        return total
    }
}
