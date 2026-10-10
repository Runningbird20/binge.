package com.binge.tv.data

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

// The personalized rows: Top Picks (recommendations shared by several of
// your titles score highest), "Because you watched/liked X", New Episodes.
// Same rules as the Apple TV app's Personal.build.
object Personal {
    data class Rows(val topPicks: LoadedRow? = null, val because: List<LoadedRow> = emptyList(), val newEpisodes: LoadedRow? = null)

    private data class Seed(val title: Title, val verb: String, val weight: Double)

    suspend fun build(watched: List<ContinueItem>, loved: List<Title>, exclude: Set<String>, kids: Boolean, name: String?): Rows = coroutineScope {
        val fresh = watched.filter { it.newEpisode != null }.map { it.title.copy(badge = "New ${it.newEpisode}") }
        val newEpisodes = if (fresh.isNotEmpty()) LoadedRow("new-episodes", "New Episodes", fresh) else null

        // Up to 4 recent watches and 3 favourites seed the picks.
        val seeds = ArrayList<Seed>()
        watched.take(4).forEachIndexed { i, item -> seeds += Seed(item.title, "watched", 1.0 - i * 0.12) }
        for (title in loved) if (seeds.none { it.title.id == title.id } && seeds.size < 7) seeds += Seed(title, "liked", 0.9)
        if (seeds.isEmpty()) return@coroutineScope Rows(newEpisodes = newEpisodes)

        val recs = seeds.map { seed ->
            async {
                val tmdbId = seed.title.tmdbId ?: return@async emptyList<Title>()
                Catalog.load(RowSpec("rec-${seed.title.id}", "", seed.title.kind, "${seed.title.kind.tmdbPath}/$tmdbId/recommendations"), kids)?.items.orEmpty()
            }
        }.awaitAll()

        val scores = LinkedHashMap<String, Pair<Title, Double>>()
        val because = ArrayList<LoadedRow>()
        val usedFlavours = HashSet<String>()
        recs.forEachIndexed { index, items ->
            val seed = seeds[index]
            val candidates = items.filter { it.id !in exclude && it.id != seed.title.id }
            candidates.forEachIndexed { position, title ->
                val add = seed.weight * (1 - position / 25.0)
                scores[title.id] = title to ((scores[title.id]?.second ?: 0.0) + add)
            }
            // Seeds that look alike (same language and main genre) share one
            // "Because you…" row, so two recent K-dramas don't fill the page.
            val flavour = "${seed.title.originalLanguage ?: ""}|${seed.title.genre?.split(",")?.firstOrNull() ?: ""}"
            if (because.size < 4 && candidates.size >= 5 && usedFlavours.add(flavour)) {
                because += LoadedRow("because-${seed.title.id}", "Because you ${seed.verb} ${seed.title.name}", candidates)
            }
        }
        // After 4 titles in one non-English language, further ones are nudged down.
        val languageCount = HashMap<String, Int>()
        val picks = scores.values.sortedByDescending { it.second }
            .map { (title, score) ->
                val language = title.originalLanguage ?: "en"
                val seen = languageCount.getOrDefault(language, 0)
                languageCount[language] = seen + 1
                title to (score - if (language == "en") 0.0 else maxOf(0, seen - 3) * 0.35)
            }
            .sortedByDescending { it.second }.map { it.first }.take(24)
        Rows(
            topPicks = if (picks.size >= 5) LoadedRow("top-picks", "Top Picks for ${name ?: "You"}", picks) else null,
            because = because,
            newEpisodes = newEpisodes,
        )
    }
}
