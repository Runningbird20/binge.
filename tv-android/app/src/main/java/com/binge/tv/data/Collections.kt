package com.binge.tv.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.time.LocalDate

// Collections: the website's ready-made sets (Marvel Studios, Christmas,
// Malayalam classics, All-time top 100…). The list is the site's own
// /collections.json (scripts/generate-collections.js), read here too, so a
// new set needs no app update. Each set is live TMDB queries, so new
// releases join by themselves; titles are matched to the catalog like every
// row (Catalog.match: release window, the profile's maturity level). Twins:
// the website's src/utils/collections.js, Apple TV's Data/Collections.swift.
@Serializable
data class CollectionsFile(val groups: List<Group> = emptyList(), val collections: List<CollectionSet> = emptyList()) {
    @Serializable data class Group(val id: String, val title: String)

    // The groups with the sets a profile may see (no mature sets on a
    // restricted level), empty groups left out.
    fun visible(restricted: Boolean): List<Pair<Group, List<CollectionSet>>> = groups.mapNotNull { group ->
        val sets = collections.filter { it.group == group.id && !(restricted && it.mature) }
        if (sets.isEmpty()) null else group to sets
    }
}

@Serializable
data class CollectionSet(
    val id: String,
    val group: String,
    val title: String,
    val subtitle: String,
    val sources: List<Source> = emptyList(),
    val order: String? = null,
    val limit: Int? = null,
    val mature: Boolean = false,
) {
    @Serializable
    data class Source(
        val type: String,
        val media: String,
        val params: Map<String, String> = emptyMap(),
        val path: String? = null,
        val ids: List<Int> = emptyList(),
        val id: Int? = null,
        val job: String? = null,
        val minVotes: Int = 0,
    )
}

object Collections {
    private var cached: CollectionsFile? = null

    suspend fun load(): CollectionsFile? {
        cached?.let { return it }
        val body = Net.text("${com.binge.tv.DebugLaunch.collectionsUrl ?: "${Config.siteUrl}/collections.json"}") ?: return null
        return runCatching { plainJson.decodeFromString<CollectionsFile>(body) }.getOrNull()?.also { cached = it }
    }

    private val token = Regex("""\{today([+-]\d+)?\}""")

    // "{today}", "{today+30}", "{today-365}" → a local YYYY-MM-DD.
    fun fill(params: Map<String, String>, today: LocalDate = LocalDate.now()): Map<String, String> =
        params.mapValues { (_, value) -> token.replace(value) { match -> today.plusDays(match.groupValues[1].toLongOrNull() ?: 0).toString() } }

    // Kept per set and maturity level, so going back shows what was loaded.
    private val feeds = HashMap<String, CollectionFeed>()
    fun feed(set: CollectionSet, maturity: Maturity): CollectionFeed =
        feeds.getOrPut("${set.id}|$maturity") { CollectionFeed(set, maturity) }
}

@Serializable private data class PagedItems(val results: List<TmdbItem> = emptyList(), val totalPages: Int? = null)
@Serializable private data class CollectionParts(val parts: List<TmdbItem> = emptyList())
@Serializable private data class Credits(val crew: List<Credit> = emptyList())
@Serializable private data class Credit(
    val id: Int, val title: String? = null, val posterPath: String? = null, val backdropPath: String? = null,
    val releaseDate: String? = null, val originalLanguage: String? = null, val job: String? = null, val voteCount: Int? = null,
) {
    fun item() = TmdbItem(id = id, title = title, posterPath = posterPath, backdropPath = backdropPath, releaseDate = releaseDate, originalLanguage = originalLanguage)
}

// One set as a feed: loadMore() adds the next titles on binge., in the set's
// order, until done. A batch that matched nothing reads on (up to 4 pages),
// so scrolling never stalls on a page of titles the catalog doesn't have.
class CollectionFeed(val set: CollectionSet, private val maturity: Maturity) {
    val items = mutableStateListOf<Title>()
    var done by mutableStateOf(set.sources.isEmpty())
        private set
    var loading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    private val pages = IntArray(set.sources.size) { 1 }
    private val more = BooleanArray(set.sources.size) { true }
    private val seen = HashSet<String>()
    private val lock = Mutex()

    suspend fun loadMore() {
        if (done || !lock.tryLock()) return
        loading = true
        failed = false
        try {
            repeat(4) {
                val added = batch()
                items.addAll(added)
                if (added.isNotEmpty() || done) return
            }
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            failed = true
        } finally {
            loading = false
            lock.unlock()
        }
    }

    private suspend fun batch(): List<Title> = coroutineScope {
        val live = set.sources.indices.filter { more[it] }
        val read = live.map { index -> async { index to read(set.sources[index], pages[index]) } }.awaitAll()
        var found = read.flatMap { (index, result) ->
            pages[index] += 1
            more[index] = result.second
            val kind = if (set.sources[index].media == "tv") MediaKind.TV else MediaKind.MOVIE
            result.first.map { kind to it }
        }.filter { (kind, item) -> "${kind.raw}:${item.id}" !in seen }
        if (set.order == "release") found = found.sortedBy { it.second.date ?: "9999" }
        val movies = async { Catalog.match(found.filter { it.first == MediaKind.MOVIE }.map { it.second }, MediaKind.MOVIE, maturity) }
        val shows = async { Catalog.match(found.filter { it.first == MediaKind.TV }.map { it.second }, MediaKind.TV, maturity) }
        val byKey = (movies.await() + shows.await()).associateBy { "${it.kind.raw}:${it.tmdbId}" }
        val limit = set.limit ?: Int.MAX_VALUE
        val added = ArrayList<Title>()
        for ((kind, item) in found) {
            val key = "${kind.raw}:${item.id}"
            seen.add(key)
            val title = byKey[key] ?: continue
            if (items.size + added.size < limit) added.add(title)
        }
        done = items.size + added.size >= limit || more.none { it }
        added
    }

    private suspend fun read(source: CollectionSet.Source, page: Int): Pair<List<TmdbItem>, Boolean> {
        val byDate = compareBy<TmdbItem> { it.date ?: "9999" }
        return when (source.type) {
            "discover", "list" -> {
                val path = if (source.type == "discover") "discover/${source.media}" else source.path.orEmpty().trimStart('/')
                val params = if (source.type == "discover") {
                    mapOf("include_adult" to "false", "sort_by" to "popularity.desc") + Collections.fill(source.params)
                } else emptyMap()
                val result: PagedItems = Tmdb.get(path, params + ("page" to "$page"))
                result.results to (page < minOf(result.totalPages ?: 1, 500))
            }
            "collection" -> source.ids.flatMap { id -> runCatching { Tmdb.get<CollectionParts>("collection/$id").parts }.getOrDefault(emptyList()) }
                .sortedWith(byDate) to false
            "titles" -> source.ids.mapNotNull { id -> runCatching { Tmdb.get<TmdbItem>("${source.media}/$id") }.getOrNull() } to false
            "person" -> {
                val id = source.id ?: return emptyList<TmdbItem>() to false
                val credits: Credits = Tmdb.get("person/$id/${if (source.media == "tv") "tv" else "movie"}_credits")
                credits.crew.filter { it.job == source.job && (it.voteCount ?: 0) >= source.minVotes }.map { it.item() }.sortedWith(byDate) to false
            }
            else -> emptyList<TmdbItem>() to false
        }
    }
}
