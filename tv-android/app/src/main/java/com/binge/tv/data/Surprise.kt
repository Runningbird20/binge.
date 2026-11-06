package com.binge.tv.data

// "Surprise me with a movie / a series" on Home, the website's
// utils/surprise.js: one title of that kind from the profile's own picks
// (Top Picks, then the "Because you watched" rows: already without what
// they've watched, rated or saved, and filtered for the profile's maturity),
// leaning toward the strongest. Titles not out yet are skipped, and so are
// the last few surprises, so pressing again finds something new. A profile
// with no history yet gets a trending title.
object Surprise {
    private val recent = ArrayDeque<String>()

    fun pool(personal: Personal.Rows, fallback: List<Title>, kind: MediaKind, exclude: Set<String>): List<Title> {
        val seen = HashSet(exclude)
        val pool = ArrayList<Title>()
        fun add(items: List<Title>, limit: Int) = items
            .filter { it.kind == kind && !it.comingSoon && it.id !in seen }
            .take(limit)
            .forEach { if (seen.add(it.id)) pool += it }
        add(personal.topPicks?.items.orEmpty(), 15)
        personal.because.forEach { add(it.items, 6) }
        if (pool.isEmpty()) add(fallback, 20)
        return pool
    }

    // Random, weighted toward the top of the pool; not a recent surprise
    // unless nothing else is left. null when there's nothing to pick.
    fun pick(pool: List<Title>, random: () -> Double = Math::random): Title? {
        val fresh = pool.filter { it.id !in recent }
        val choices = fresh.ifEmpty { pool }
        if (choices.isEmpty()) return null
        val weights = choices.indices.map { 1.0 / (1 + it * 0.12) }
        var roll = random() * weights.sum()
        val chosen = choices.indices.firstOrNull { roll -= weights[it]; roll <= 0 }?.let { choices[it] } ?: choices.last()
        recent.addFirst(chosen.id)
        while (recent.size > 6) recent.removeLast()
        return chosen
    }
}
