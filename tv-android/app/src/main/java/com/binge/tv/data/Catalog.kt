package com.binge.tv.data

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

data class RowSpec(val id: String, val title: String, val kind: MediaKind, val path: String, val params: Map<String, String> = emptyMap())

data class LoadedRow(val id: String, val title: String, val items: List<Title>)

// TMDB lists matched back to catalog rows through
// source_key = 'tmdb:{movie|tv}:{id}', like the site's catalogLookup.js.
object Catalog {
    suspend fun match(items: List<TmdbItem>, kind: MediaKind, kids: Boolean): List<Title> {
        val candidates = items.filter { ReleaseWindow.isVisible(it.date) }
        if (candidates.isEmpty()) return emptyList()
        val keys = candidates.joinToString(",") { "\"tmdb:${kind.tmdbPath}:${it.id}\"" }
        val rows: List<CatalogRow> = Supabase.selectAs(kind.table, listOf(
            "select" to CatalogRow.COLUMNS, "source_key" to "in.($keys)",
        ), Supabase.Auth.OPTIONAL)
        val byKey = HashMap<String, CatalogRow>()
        rows.forEach { row -> row.sourceKey?.let { if (it !in byKey) byKey[it] = row } }
        val seen = HashSet<Long>()
        return candidates.mapNotNull { item ->
            val row = byKey["tmdb:${kind.tmdbPath}:${item.id}"] ?: return@mapNotNull null
            if (!seen.add(row.id)) return@mapNotNull null
            if (kids && !KidsFilter.allows(row.ageRating)) return@mapNotNull null
            row.asTitle(kind).copy(
                poster = Tmdb.image(item.posterPath, Tmdb.POSTER) ?: row.posterUrl,
                backdrop = Tmdb.image(item.backdropPath, Tmdb.WIDE),
                tmdbId = item.id,
                comingSoon = ReleaseWindow.isComingSoon(item.date),
                originalLanguage = row.originalLanguage ?: item.originalLanguage,
            )
        }
    }

    suspend fun titles(kind: MediaKind, ids: List<Long>): Map<Long, Title> {
        val unique = ids.distinct()
        if (unique.isEmpty()) return emptyMap()
        val rows: List<CatalogRow> = Supabase.selectAs(kind.table, listOf(
            "select" to CatalogRow.COLUMNS, "id" to "in.(${unique.joinToString(",")})",
        ), Supabase.Auth.OPTIONAL)
        return rows.associate { it.id to it.asTitle(kind) }
    }

    suspend fun load(spec: RowSpec, kids: Boolean): LoadedRow? = runCatching {
        val page: TmdbPage = Tmdb.get(spec.path, spec.params)
        val items = match(page.results, spec.kind, kids)
        if (items.isEmpty()) null else LoadedRow(spec.id, spec.title, items)
    }.getOrNull()

    suspend fun loadAll(specs: List<RowSpec>, kids: Boolean): List<LoadedRow> = coroutineScope {
        specs.map { async { load(it, kids) } }.awaitAll().filterNotNull()
    }

    // Movies and series for a search, in TMDB's relevance order. People
    // contribute the titles they're known for.
    suspend fun search(query: String, kids: Boolean): List<Title> = coroutineScope {
        val page: TmdbPage = Tmdb.get("search/multi", mapOf("query" to query, "include_adult" to "false"))
        val ordered = ArrayList<Pair<MediaKind, TmdbItem>>()
        for (item in page.results) {
            when (item.mediaType) {
                "movie" -> ordered += MediaKind.MOVIE to item
                "tv" -> ordered += MediaKind.TV to item
                "person" -> item.knownFor.orEmpty().forEach { known ->
                    if (known.mediaType == "movie") ordered += MediaKind.MOVIE to known
                    if (known.mediaType == "tv") ordered += MediaKind.TV to known
                }
            }
        }
        val movies = async { match(ordered.filter { it.first == MediaKind.MOVIE }.map { it.second }, MediaKind.MOVIE, kids) }
        val shows = async { match(ordered.filter { it.first == MediaKind.TV }.map { it.second }, MediaKind.TV, kids) }
        val found = movies.await() + shows.await()
        val byTmdb = found.associateBy { "${it.kind.raw}:${it.tmdbId}" }
        val seen = HashSet<String>()
        ordered.mapNotNull { (kind, item) -> byTmdb["${kind.raw}:${item.id}"]?.takeIf { seen.add(it.id) } }
    }
}

object Rows {
    fun home(kids: Boolean): List<RowSpec> = if (kids) kidsRows else listOf(
        RowSpec("trending-tv", "Trending Series", MediaKind.TV, "trending/tv/day"),
        RowSpec("trending-movies", "Trending Movies", MediaKind.MOVIE, "trending/movie/day"),
        RowSpec("kdrama", "Popular K-Dramas", MediaKind.TV, "discover/tv",
            mapOf("with_original_language" to "ko", "sort_by" to "popularity.desc", "vote_count.gte" to "50")),
        RowSpec("top-movies", "Top Rated Movies", MediaKind.MOVIE, "movie/top_rated"),
        RowSpec("gems", "Hidden Gems", MediaKind.MOVIE, "discover/movie",
            mapOf("vote_average.gte" to "7.4", "vote_count.gte" to "150", "vote_count.lte" to "2500",
                "with_runtime.gte" to "80", "sort_by" to "vote_average.desc")),
        RowSpec("anime", "Anime", MediaKind.TV, "discover/tv",
            mapOf("with_genres" to "16", "with_original_language" to "ja", "sort_by" to "popularity.desc")),
        RowSpec("top-tv", "Top Rated Series", MediaKind.TV, "tv/top_rated"),
    )

    fun browse(kind: MediaKind, kids: Boolean): List<RowSpec> {
        if (kids) return kidsRows.filter { it.kind == kind }
        return if (kind == MediaKind.MOVIE) listOf(
            RowSpec("m-popular", "Popular Now", MediaKind.MOVIE, "movie/popular"),
            RowSpec("m-now", "New Releases", MediaKind.MOVIE, "movie/now_playing"),
            RowSpec("m-top", "Top Rated", MediaKind.MOVIE, "movie/top_rated"),
        ) + genres(listOf(28 to "Action", 35 to "Comedy", 27 to "Horror", 878 to "Sci-Fi", 10749 to "Romance",
            53 to "Thrillers", 16 to "Animation", 99 to "Documentaries"), MediaKind.MOVIE)
        else listOf(
            RowSpec("t-popular", "Popular Now", MediaKind.TV, "tv/popular"),
            RowSpec("t-air", "New Episodes This Week", MediaKind.TV, "tv/on_the_air"),
            RowSpec("t-top", "Top Rated", MediaKind.TV, "tv/top_rated"),
            RowSpec("t-kdrama", "K-Dramas", MediaKind.TV, "discover/tv",
                mapOf("with_original_language" to "ko", "sort_by" to "popularity.desc", "vote_count.gte" to "50")),
        ) + genres(listOf(80 to "Crime", 35 to "Comedy", 18 to "Drama", 10765 to "Sci-Fi & Fantasy",
            16 to "Animation", 10764 to "Reality", 99 to "Documentaries"), MediaKind.TV)
    }

    private fun genres(list: List<Pair<Int, String>>, kind: MediaKind) = list.map { (id, name) ->
        RowSpec("${kind.raw}-g$id", name, kind, "discover/${kind.tmdbPath}",
            mapOf("with_genres" to "$id", "sort_by" to "popularity.desc", "vote_count.gte" to "100"))
    }

    private val kidsRows = listOf(
        RowSpec("k-family", "Family Movies", MediaKind.MOVIE, "discover/movie",
            mapOf("with_genres" to "10751", "certification_country" to "US", "certification.lte" to "PG", "sort_by" to "popularity.desc")),
        RowSpec("k-animated", "Animated Movies", MediaKind.MOVIE, "discover/movie",
            mapOf("with_genres" to "16", "certification_country" to "US", "certification.lte" to "PG", "sort_by" to "popularity.desc")),
        RowSpec("k-shows", "Kids Series", MediaKind.TV, "discover/tv", mapOf("with_genres" to "10762", "sort_by" to "popularity.desc")),
        RowSpec("k-cartoons", "Cartoons", MediaKind.TV, "discover/tv", mapOf("with_genres" to "16,10751", "sort_by" to "popularity.desc")),
    )
}
