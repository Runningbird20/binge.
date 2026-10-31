package com.binge.tv.data

import java.util.Calendar
import java.util.GregorianCalendar

// The seasonal row on the Movies and Series tabs: what's relevant this time
// of year (horror in October, Christmas after Thanksgiving, romance before
// Valentine's Day…), picked from today's date so the row and its title
// change by themselves. Same calendar as the website's src/utils/seasonal.js
// and the Apple TV's Data/Seasonal.swift — keep the three in sync.
// Dates are plain local days (java.util.Calendar: java.time needs API 26).
object Seasonal {
    // A local calendar day; compared by its yyyymmdd key.
    data class Day(val year: Int, val month: Int, val day: Int) : Comparable<Day> {
        private val key get() = year * 10000 + month * 100 + day
        override fun compareTo(other: Day) = key.compareTo(other.key)
        fun plus(days: Int): Day {
            val c = GregorianCalendar(year, month - 1, day)
            c.add(Calendar.DAY_OF_MONTH, days)
            return of(c)
        }

        companion object {
            fun of(c: Calendar) = Day(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
            fun today() = of(Calendar.getInstance())
        }
    }

    class Season(
        val id: String,
        val window: (Int) -> Pair<Day, Day>, // year → first and last day, inclusive
        val title: (Day, MediaKind) -> String,
        val movie: Map<String, String>? = null,
        val tv: Map<String, String>? = null,
        val kids: Map<String, String>? = null,
    )

    data class Pick(val id: String, val title: String, val params: Map<String, String>)

    // The nth `weekday` (Calendar.SUNDAY = 1 …) of a month; n = -1 is the last one.
    fun nthWeekday(year: Int, month: Int, weekday: Int, n: Int): Day {
        val c = GregorianCalendar(year, month - 1, 1)
        if (n > 0) {
            val first = c.get(Calendar.DAY_OF_WEEK)
            return Day(year, month, 1 + (weekday - first + 7) % 7 + (n - 1) * 7)
        }
        val lastDate = c.getActualMaximum(Calendar.DAY_OF_MONTH)
        val last = GregorianCalendar(year, month - 1, lastDate).get(Calendar.DAY_OF_WEEK)
        return Day(year, month, lastDate - (last - weekday + 7) % 7)
    }

    // Western Easter Sunday (anonymous Gregorian algorithm).
    fun easter(year: Int): Day {
        val a = year % 19; val b = year / 100; val c = year % 100; val d = b / 4; val e = b % 4
        val f = (b + 8) / 25; val g = (b - f + 1) / 3; val h = (19 * a + b - d - g + 15) % 30
        val i = c / 4; val k = c % 4; val l = (32 + 2 * e + 2 * i - h - k) % 7; val m = (a + 11 * h + 22 * l) / 451
        val n = h + l - 7 * m + 114
        return Day(year, n / 31, n % 31 + 1)
    }

    fun thanksgiving(year: Int) = nthWeekday(year, 11, Calendar.THURSDAY, 4)
    fun memorialDay(year: Int) = nthWeekday(year, 5, Calendar.MONDAY, -1)
    private fun mothersDay(year: Int) = nthWeekday(year, 5, Calendar.SUNDAY, 2)
    private fun fathersDay(year: Int) = nthWeekday(year, 6, Calendar.SUNDAY, 3)
    private fun lastOfFebruary(year: Int) = Day(year, 3, 1).plus(-1)

    private fun any(vararg ids: String) = ids.joinToString("|")

    // TMDB keyword ids, checked against TMDB (2026-10-31).
    private val spookyTv = mapOf("with_keywords" to any("3335", "3358", "12377", "3133", "12564", "616"), "without_genres" to "10762,10766", "vote_count.gte" to "100")
    private val spookyKids = mapOf("with_keywords" to any("3335", "3358", "616", "162846"))
    private val christmas = any("207317", "1991")
    private val blackHistory = any("4098", "270891", "256015", "190675")
    private val sports = any("6075", "6496", "579", "1480")
    private val snow = any("10794", "1442")
    private val summer = any("13088", "14714", "966")

    // In priority order: the first season holding today (with a query for
    // the tab's type) wins, so short holidays sit above the seasons around them.
    val seasons = listOf(
        Season("halloween-night", { y -> Day(y, 10, 25) to Day(y, 10, 31) },
            { d, _ -> if (d.day == 31) "Happy Halloween" else "Halloween Week" },
            movie = mapOf("with_keywords" to "3335", "vote_count.gte" to "100"), tv = spookyTv, kids = spookyKids),
        Season("spooky-season", { y -> Day(y, 10, 1) to Day(y, 10, 24) }, { _, _ -> "Spooky Season" },
            movie = mapOf("with_genres" to "27", "vote_count.gte" to "500"), tv = spookyTv, kids = spookyKids),
        Season("thanksgiving", { y -> Day(y, 11, 1) to thanksgiving(y) },
            { d, kind ->
                val tg = thanksgiving(d.year)
                when {
                    d == tg -> "Happy Thanksgiving"
                    kind == MediaKind.TV -> "Comfort TV for Thanksgiving"
                    tg.plus(-6) <= d -> "Thanksgiving Week"
                    else -> "Thanksgiving Movies"
                }
            },
            movie = mapOf("with_keywords" to "4543", "vote_count.gte" to "30"),
            tv = mapOf("with_genres" to "35", "without_genres" to "16,10762,10764", "vote_count.gte" to "500"),
            kids = mapOf("with_keywords" to "4543")),
        Season("christmas", { y -> thanksgiving(y).plus(1) to Day(y, 12, 25) },
            { d, kind ->
                when {
                    d.month == 11 -> "The Holidays Start Now"
                    d.day >= 24 -> "Merry Christmas"
                    d.day >= 18 -> "Countdown to Christmas"
                    kind == MediaKind.TV -> "Christmas Shows"
                    else -> "Christmas Movies"
                }
            },
            movie = mapOf("with_keywords" to christmas, "without_genres" to "27", "vote_count.gte" to "100"),
            tv = mapOf("with_keywords" to christmas, "vote_count.gte" to "10"),
            kids = mapOf("with_keywords" to christmas)),
        Season("new-year", { y -> Day(y, 12, 26) to Day(y + 1, 1, 1) },
            { d, kind -> if (d.month == 1) "Happy New Year" else if (kind == MediaKind.TV) "Binge a Limited Series" else "Ring In the New Year" },
            movie = mapOf("with_keywords" to "613", "vote_count.gte" to "50"),
            tv = mapOf("with_type" to "2", "sort_by" to "vote_average.desc", "vote_count.gte" to "500")),
        Season("valentines", { y -> Day(y, 2, 1) to Day(y, 2, 14) },
            { d, _ -> if (d.day >= 11) "Date Night for Valentine's" else "Valentine's Day Romance" },
            movie = mapOf("with_genres" to "10749", "vote_count.gte" to "500"),
            tv = mapOf("with_keywords" to "9840", "with_genres" to "18|35", "vote_count.gte" to "100")),
        Season("black-history-month", { y -> Day(y, 2, 15) to lastOfFebruary(y) }, { _, _ -> "Celebrating Black History Month" },
            movie = mapOf("with_keywords" to blackHistory, "vote_count.gte" to "200"),
            tv = mapOf("with_keywords" to blackHistory, "vote_count.gte" to "10")),
        Season("winter", { y -> Day(y, 1, 2) to Day(y, 1, 31) }, { _, _ -> "Snowed In" },
            movie = mapOf("with_keywords" to snow, "vote_count.gte" to "300"),
            tv = mapOf("with_keywords" to snow, "vote_count.gte" to "20"),
            kids = mapOf("with_keywords" to snow)),
        Season("easter", { y -> easter(y).plus(-7) to easter(y) },
            { d, _ -> if (d == easter(d.year)) "Happy Easter" else "Easter Favorites" },
            movie = mapOf("with_keywords" to any("9921", "9923"), "vote_count.gte" to "20"),
            kids = mapOf("with_keywords" to any("9921", "9923"))),
        Season("may-the-4th", { y -> Day(y, 4, 28) to Day(y, 5, 4) }, { _, _ -> "May the 4th Be With You" },
            movie = mapOf("with_companies" to "1", "vote_count.gte" to "500"),
            tv = mapOf("with_companies" to "1", "vote_count.gte" to "20")),
        Season("mothers-day", { y -> mothersDay(y).plus(-6) to mothersDay(y) }, { _, _ -> "Mother's Day Movies" },
            movie = mapOf("with_keywords" to "240315", "without_genres" to "27,28,53,878", "vote_count.gte" to "300")),
        Season("fathers-day", { y -> fathersDay(y).plus(-6) to fathersDay(y) }, { _, _ -> "Father's Day Movies" },
            movie = mapOf("with_keywords" to any("240119", "240303"), "without_genres" to "27,53", "vote_count.gte" to "500")),
        Season("fourth-of-july", { y -> Day(y, 6, 28) to Day(y, 7, 4) }, { _, _ -> "Fourth of July Movies" },
            movie = mapOf("with_keywords" to any("159743", "235503"), "vote_count.gte" to "50")),
        Season("shark-week", { y -> Day(y, 7, 20) to Day(y, 7, 31) }, { _, _ -> "Shark Week" },
            movie = mapOf("with_keywords" to "15097", "vote_count.gte" to "100"),
            tv = mapOf("with_keywords" to "15097", "vote_count.gte" to "1"),
            kids = mapOf("with_keywords" to "15097")),
        Season("pride", { y -> Day(y, 6, 1) to Day(y, 6, 30) }, { _, _ -> "Pride Month" },
            movie = mapOf("with_keywords" to any("158718", "156501"), "vote_count.gte" to "500"),
            tv = mapOf("with_keywords" to "158718", "vote_count.gte" to "20")),
        Season("march-madness", { y -> Day(y, 3, 1) to Day(y, 4, 7) }, { _, _ -> "March Madness" },
            movie = mapOf("with_keywords" to sports, "vote_count.gte" to "300"),
            tv = mapOf("with_keywords" to sports, "vote_count.gte" to "20"),
            kids = mapOf("with_keywords" to sports)),
        Season("spring", { y -> Day(y, 4, 8) to memorialDay(y).plus(-1) },
            { _, kind -> if (kind == MediaKind.TV) "Feel-Good Comedies for Spring" else "Spring Break Road Trips" },
            movie = mapOf("with_keywords" to any("7312", "158054"), "vote_count.gte" to "500"),
            tv = mapOf("with_genres" to "35", "without_genres" to "16,10762,10764", "vote_count.gte" to "300"),
            kids = mapOf("with_keywords" to "7312")),
        Season("summer", { y -> memorialDay(y) to Day(y, 8, 14) },
            { _, kind -> if (kind == MediaKind.TV) "Summer Binge" else "Summer Blockbusters" },
            movie = mapOf("with_genres" to "28|12", "vote_count.gte" to "3000"),
            tv = mapOf("with_keywords" to summer, "vote_count.gte" to "20"),
            kids = mapOf("with_keywords" to summer)),
        Season("back-to-school", { y -> Day(y, 8, 15) to Day(y, 9, 7) }, { _, _ -> "Back to School" },
            movie = mapOf("with_keywords" to any("6270", "187282", "3616"), "without_genres" to "27", "vote_count.gte" to "500"),
            tv = mapOf("with_keywords" to any("6270", "3616"), "vote_count.gte" to "50"),
            kids = mapOf("with_keywords" to any("6270", "187282"))),
        Season("fall", { y -> Day(y, 9, 8) to Day(y, 9, 30) }, { _, _ -> "Cozy Fall Mysteries" },
            movie = mapOf("with_genres" to "9648", "vote_count.gte" to "1000"),
            tv = mapOf("with_genres" to "9648", "vote_count.gte" to "200")),
    )

    fun pick(kind: MediaKind, kids: Boolean = false, today: Day = Day.today()): Pick? {
        for (season in seasons) {
            // A window can cross New Year (Dec 26 – Jan 1), so last year's counts too.
            val holds = listOf(today.year, today.year - 1).any { y ->
                val (first, last) = season.window(y)
                today >= first && today <= last
            }
            if (!holds) continue
            val params = (if (kids) season.kids else if (kind == MediaKind.MOVIE) season.movie else season.tv) ?: continue
            return Pick(season.id, season.title(today, kind), params)
        }
        return null
    }

    // What a profile watches, as the website's taste summary: genres ranked
    // (top 8, lowercase) and each language's share of their history.
    data class Taste(val genres: List<String> = emptyList(), val languageShare: Map<String, Double> = emptyMap()) {
        val isEmpty get() = genres.isEmpty() && languageShare.isEmpty()

        companion object {
            // Recent titles count more (history arrives newest first).
            fun of(history: List<Title>): Taste {
                val genreScore = HashMap<String, Double>()
                val languageScore = HashMap<String, Double>()
                var total = 0.0
                history.take(40).forEachIndexed { index, title ->
                    val weight = maxOf(0.25, Math.pow(0.9, index.toDouble()))
                    total += weight
                    title.genre.orEmpty().split(",").map { it.trim().lowercase() }.filter { it.isNotEmpty() }
                        .forEach { genreScore[it] = (genreScore[it] ?: 0.0) + weight }
                    title.originalLanguage?.takeIf { it.isNotEmpty() }?.let { languageScore[it] = (languageScore[it] ?: 0.0) + weight }
                }
                val genres = genreScore.entries.sortedWith(compareByDescending<Map.Entry<String, Double>> { it.value }.thenBy { it.key })
                    .take(8).map { it.key }
                return Taste(genres, if (total > 0) languageScore.mapValues { it.value / total } else emptyMap())
            }
        }
    }

    // The seasonal row in the profile's taste order: a title in a genre or
    // language they watch moves up; popularity (TMDB's order) breaks ties.
    // Same scoring as the website's sortForTaste.
    fun sorted(items: List<Title>, taste: Taste): List<Title> {
        if (items.isEmpty() || taste.isEmpty) return items
        val weight = taste.genres.mapIndexed { index, genre -> genre.lowercase() to 1 - index.toDouble() / taste.genres.size }.toMap()
        return items.mapIndexed { index, title ->
            val match = title.genre.orEmpty().split(",").maxOfOrNull { weight[it.trim().lowercase()] ?: 0.0 } ?: 0.0
            val language = title.originalLanguage ?: "en"
            val languageBonus = if (language == "en") 0.0 else taste.languageShare[language] ?: 0.0
            val popularity = 1 - index.toDouble() / items.size
            title to match + languageBonus + popularity * 0.75
        }.sortedByDescending { it.second }.map { it.first } // stable: ties keep TMDB's order
    }

    // The tab's row: TMDB discover with the season's query (the catalog match
    // drops anything outside the release window).
    fun row(kind: MediaKind, kids: Boolean, today: Day = Day.today()): RowSpec? {
        val pick = pick(kind, kids, today) ?: return null
        val kidsParams = when {
            !kids -> emptyMap()
            kind == MediaKind.MOVIE -> mapOf("with_genres" to "10751|16", "certification_country" to "US", "certification.lte" to "PG", "vote_count.gte" to "30")
            else -> mapOf("with_genres" to "10762|10751", "vote_count.gte" to "1")
        }
        val params = mapOf("sort_by" to "popularity.desc", "include_adult" to "false") + kidsParams + pick.params
        return RowSpec("seasonal-${pick.id}", pick.title, kind, "discover/${kind.tmdbPath}", params)
    }
}
