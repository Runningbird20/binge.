package com.binge.tv.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrl

@Serializable
data class TmdbItem(
    val id: Int,
    val title: String? = null,
    val name: String? = null,
    val overview: String? = null,
    val posterPath: String? = null,
    val backdropPath: String? = null,
    val releaseDate: String? = null,
    val firstAirDate: String? = null,
    val voteAverage: Double? = null,
    val mediaType: String? = null,
    val genreIds: List<Int>? = null,
    val knownFor: List<TmdbItem>? = null,
    val originalLanguage: String? = null,
) {
    val date: String? get() = releaseDate ?: firstAirDate
}

@Serializable
data class TmdbPage(val results: List<TmdbItem> = emptyList())

@Serializable
data class TmdbDetails(
    val id: Int,
    val overview: String? = null,
    val tagline: String? = null,
    val runtime: Int? = null,
    val episodeRunTime: List<Int>? = null,
    val genres: List<Genre>? = null,
    val voteAverage: Double? = null,
    val backdropPath: String? = null,
    val posterPath: String? = null,
    val numberOfSeasons: Int? = null,
    val originalLanguage: String? = null,
    val seasons: List<Season>? = null,
    val lastEpisodeToAir: AiredEpisode? = null,
    val nextEpisodeToAir: AiredEpisode? = null,
    val releaseDate: String? = null,
    val status: String? = null,
    val credits: Credits? = null,
    val images: Images? = null,
    val belongsToCollection: Collection? = null,
) {
    @Serializable data class Genre(val id: Int, val name: String)
    @Serializable data class Season(val seasonNumber: Int, val name: String? = null, val episodeCount: Int? = null, val airDate: String? = null)
    @Serializable data class Cast(val name: String)
    @Serializable data class Credits(val cast: List<Cast> = emptyList())
    @Serializable data class Logo(val filePath: String, @SerialName("iso_639_1") val iso6391: String? = null)
    @Serializable data class Images(val logos: List<Logo> = emptyList())
    @Serializable data class AiredEpisode(val airDate: String? = null, val seasonNumber: Int, val episodeNumber: Int, val name: String? = null)
    @Serializable data class Collection(val id: Int)

    val logoPath: String?
        get() { val logos = images?.logos.orEmpty(); return (logos.firstOrNull { it.iso6391 == "en" } ?: logos.firstOrNull())?.filePath }
}

@Serializable
data class TmdbSeason(val episodes: List<Episode> = emptyList()) {
    @Serializable
    data class Episode(
        val id: Int,
        val episodeNumber: Int,
        val seasonNumber: Int,
        val name: String? = null,
        val overview: String? = null,
        val stillPath: String? = null,
        val runtime: Int? = null,
        val airDate: String? = null,
        val voteAverage: Double? = null,
    )
}

// TMDB's live lists drive the rows, same as the website. Responses are
// cached for 30 minutes.
object Tmdb {
    private val cache = HashMap<String, Pair<Long, String>>()

    suspend fun raw(path: String, params: Map<String, String> = emptyMap()): String {
        if (Config.tmdbKey.isEmpty()) throw BingeException("Missing TMDB key")
        val url = "https://api.themoviedb.org/3/$path".toHttpUrl().newBuilder().apply {
            addQueryParameter("api_key", Config.tmdbKey)
            addQueryParameter("language", "en-US")
            params.toSortedMap().forEach { (k, v) -> addQueryParameter(k, v) }
        }.build().toString()
        synchronized(cache) { cache[url]?.let { (at, body) -> if (System.currentTimeMillis() - at < 1_800_000) return body } }
        val reply = Net.get(url)
        if (reply.status != 200) throw BingeException("TMDB error (${reply.status})", reply.status)
        synchronized(cache) { cache[url] = System.currentTimeMillis() to reply.body }
        return reply.body
    }

    suspend inline fun <reified T> get(path: String, params: Map<String, String> = emptyMap()): T =
        json.decodeFromString(raw(path, params))

    // Sizes for a 1080p/4K TV. Coil decodes to the view's size, so big
    // sources don't cost memory, only bandwidth.
    const val FULL_SCREEN = "original"
    const val WIDE = "w1280"
    const val POSTER = "w500"

    fun image(path: String?, size: String = "w500"): String? = path?.takeIf { it.isNotEmpty() }?.let { "https://image.tmdb.org/t/p/$size$it" }

    // Same image at another size ("…/w780/abc.jpg" → "…/original/abc.jpg").
    fun resized(url: String?, size: String): String? =
        if (url == null || !url.contains("image.tmdb.org")) url else url.replace(Regex("/t/p/[a-z0-9]+/"), "/t/p/$size/")
}
