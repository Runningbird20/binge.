package com.binge.tv.data

import com.binge.tv.player.StreamServer
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.net.URLEncoder
import java.util.UUID

// ESPN's public scoreboard feed (same as the site's live score panel).
data class League(val id: String, val name: String, val path: String) {
    companion object {
        val all = listOf(
            League("nfl", "NFL", "football/nfl"), League("nba", "NBA", "basketball/nba"), League("mlb", "MLB", "baseball/mlb"),
            League("nhl", "NHL", "hockey/nhl"), League("cfb", "College Football", "football/college-football"),
            League("wnba", "WNBA", "basketball/wnba"), League("epl", "Premier League", "soccer/eng.1"),
            League("ucl", "Champions League", "soccer/uefa.champions"), League("mls", "MLS", "soccer/usa.1"),
        )
    }
}

object Scoreboard {
    @Serializable data class Board(val events: List<Event> = emptyList())
    @Serializable data class Event(val id: String, val shortName: String? = null, val date: String? = null, val status: Status, val competitions: List<Competition> = emptyList()) {
        val competitors get() = competitions.firstOrNull()?.competitors.orEmpty()
        val away get() = competitors.firstOrNull { it.homeAway == "away" } ?: competitors.firstOrNull()
        val home get() = competitors.firstOrNull { it.homeAway == "home" } ?: competitors.lastOrNull()
        val isLive get() = status.type.state == "in"
        val isFinal get() = status.type.state == "post"
        val sortRank get() = if (isLive) 0 else if (isFinal) 2 else 1
    }
    @Serializable data class Status(val type: Kind, val period: Int? = null, val displayClock: String? = null) {
        @Serializable data class Kind(val state: String, val shortDetail: String? = null)
    }
    @Serializable data class Competition(val competitors: List<Competitor> = emptyList())
    @Serializable data class Competitor(val homeAway: String? = null, val score: String? = null, val winner: Boolean? = null, val team: Team) {
        @Serializable data class Team(val id: String? = null, val displayName: String? = null, val shortDisplayName: String? = null,
                                      val abbreviation: String? = null, val logo: String? = null, val color: String? = null)
        val name get() = team.shortDisplayName ?: team.displayName ?: team.abbreviation ?: "TBD"
    }

    private val espnJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true; explicitNulls = false }

    suspend fun load(league: League): List<Event> {
        val body = Net.text("https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard") ?: return emptyList()
        return runCatching { espnJson.decodeFromString<Board>(body).events.sortedBy { it.sortRank } }.getOrDefault(emptyList())
    }
}

data class SportStream(val label: String, val embed: String? = null, val streamedSource: String? = null, val streamedId: String? = null) {
    // Admin switches (server_config, same keys as the website's sportsSwitchKeys).
    val switchKeys: List<String>
        get() = if (streamedSource != null) listOf("sports:streamed", "sports:streamed:$streamedSource")
        else listOf(if (label.startsWith("PPV")) "sports:ppv" else "sports:streamfree")
}

data class SportGame(
    val id: String,
    val title: String,
    val category: String,
    val startsAt: Long? = null,
    val endsAt: Long? = null,
    val alwaysLive: Boolean = false,
    val teams: Pair<String, String>? = null, // home, away
    val logos: Pair<String?, String?>? = null,
    val poster: String? = null,
    val streams: List<SportStream> = emptyList(),
    val tag: String? = null,
    val colors: List<String>? = null,
) {
    override fun equals(other: Any?) = other is SportGame && other.id == id
    override fun hashCode() = id.hashCode()

    val isLive: Boolean
        get() {
            if (alwaysLive) return true
            val start = startsAt ?: return false
            val now = System.currentTimeMillis()
            return start <= now + 10 * 60_000 && now <= (endsAt ?: (start + 3 * 3_600_000))
        }
    val teamTokens: Set<String>? get() = SportsFeed.tokens(teams, title)
    val is247 get() = alwaysLive || (tag?.contains("24/7") ?: false)

    // Same rules as the site's inferLeague (sportsProviders.js).
    val league: String
        get() {
            if (!tag.isNullOrEmpty() && !tag.contains("24/7")) return tag
            if (is247) return "24/7 Channels"
            val tokens = teamTokens
            if (tokens != null) {
                fun inSet(set: Set<String>) = tokens.all { it in set }
                when {
                    category == "American Football" -> return if (inSet(SportsFeed.nflTeams)) "NFL" else "College Football"
                    category == "Basketball" && inSet(SportsFeed.nbaTeams) -> return "NBA"
                    category == "Hockey" && inSet(SportsFeed.nhlTeams) -> return "NHL"
                    category == "Baseball" -> return "MLB"
                }
            }
            return category
        }
}

// The same three feeds the website's Sports page uses, fetched directly,
// merged into one entry per game; each game's feeds become the servers raced
// by the player, exactly like movie servers.
object SportsFeed {
    val nflTeams = setOf("cardinals", "falcons", "ravens", "bills", "panthers", "bears", "bengals", "browns", "cowboys", "broncos", "lions", "packers", "texans", "colts", "jaguars", "chiefs", "raiders", "chargers", "rams", "dolphins", "vikings", "patriots", "saints", "giants", "jets", "eagles", "steelers", "49ers", "seahawks", "buccaneers", "titans", "commanders")
    val nbaTeams = setOf("hawks", "celtics", "nets", "hornets", "bulls", "cavaliers", "mavericks", "nuggets", "pistons", "warriors", "rockets", "pacers", "clippers", "lakers", "grizzlies", "heat", "bucks", "timberwolves", "pelicans", "knicks", "thunder", "magic", "76ers", "suns", "blazers", "kings", "spurs", "raptors", "jazz", "wizards")
    val nhlTeams = setOf("ducks", "bruins", "sabres", "flames", "hurricanes", "blackhawks", "avalanche", "jackets", "stars", "wings", "oilers", "panthers", "kings", "wild", "canadiens", "predators", "devils", "islanders", "rangers", "senators", "flyers", "penguins", "sharks", "kraken", "blues", "lightning", "leafs", "canucks", "knights", "capitals", "jets", "mammoth")
    private val ppvCategories = mapOf("Ice Hockey" to "Hockey", "Football" to "Soccer", "MMA" to "Combat Sports", "Boxing" to "Combat Sports",
        "Wrestling" to "Combat Sports", "Motorsport" to "Racing", "Motorsports" to "Racing")
    private val durations = mapOf("Basketball" to 3.0, "Soccer" to 2.25, "American Football" to 3.5, "Baseball" to 3.5, "Hockey" to 3.0,
        "Combat Sports" to 5.0, "Tennis" to 3.0, "Golf" to 5.0, "Racing" to 3.0, "Rugby" to 2.0, "Cricket" to 8.0)
    private val streamedCategories = mapOf("basketball" to "Basketball", "football" to "Soccer", "american-football" to "American Football",
        "hockey" to "Hockey", "baseball" to "Baseball", "motor-sports" to "Racing", "fight" to "Combat Sports", "tennis" to "Tennis",
        "rugby" to "Rugby", "golf" to "Golf", "cricket" to "Cricket")
    private val streamfreeCategories = mapOf("soccer" to "Soccer", "basketball" to "Basketball", "hockey" to "Hockey", "combat" to "Combat Sports",
        "baseball" to "Baseball", "football" to "American Football", "racing" to "Racing", "tennis" to "Tennis", "cricket" to "Cricket")

    suspend fun load(): List<SportGame> = coroutineScope {
        val ppv = async { fetchPPV() }
        val streamed = async { fetchStreamed() }
        val streamfree = async { fetchStreamFree() }
        val disabled = ServerSwitches.disabledServers()
        val all = (ppv.await() + streamed.await() + streamfree.await()).mapNotNull { game ->
            if (disabled.isEmpty()) game else game.copy(streams = game.streams.filter { s -> s.switchKeys.none { it in disabled } })
                .takeIf { it.streams.isNotEmpty() }
        }
        merge(all).sortedWith(compareBy({ if (it.isLive) 0 else 1 }, { it.startsAt ?: Long.MAX_VALUE }))
    }

    private suspend fun fetch(url: String): JsonElement? {
        val body = Net.text(url, mapOf("Accept" to "application/json", "User-Agent" to "Mozilla/5.0 (Linux; Android) binge.")) ?: return null
        return runCatching { plainJson.parseToJsonElement(body) }.getOrNull()
    }

    private fun JsonElement?.obj() = this as? JsonObject
    private fun JsonElement?.arr() = (this as? JsonArray).orEmpty()
    private fun JsonElement?.str() = (this as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }
    private fun JsonElement?.num() = (this as? JsonPrimitive)?.doubleOrNull
    private fun JsonElement?.truthy(): Boolean { val p = this as? JsonPrimitive ?: return false; return p.booleanOrNull ?: (p.contentOrNull == "1" || p.contentOrNull == "true") || (p.doubleOrNull ?: 0.0) > 0 }
    private fun date(value: JsonElement?): Long? { val v = value.num() ?: return null; if (v <= 0) return null; return if (v > 1e11) v.toLong() else (v * 1000).toLong() }

    private suspend fun fetchPPV(): List<SportGame> {
        val categories = fetch("https://api.ppv.st/api/streams").obj()?.get("streams").arr()
        val now = System.currentTimeMillis()
        val out = ArrayList<SportGame>()
        for (category in categories) {
            val c = category.obj() ?: continue
            val catLive = c["always_live"].truthy()
            for (stream in c["streams"].arr()) {
                val s = stream.obj() ?: continue
                val iframe = s["iframe"].str() ?: continue
                val rawName = s["category_name"].str() ?: c["category"].str() ?: "Other"
                if (rawName == "24/7 Streams") continue
                val alwaysLive = catLive || s["always_live"].truthy()
                val ends = date(s["ends_at"])
                if (!alwaysLive && ends != null && ends < now) continue
                val tag = s["source_tag"].str()
                val streams = mutableListOf(SportStream(tag?.let { "PPV · $it" } ?: "PPV", embed = iframe))
                for (sub in s["substreams"].arr()) {
                    val so = sub.obj() ?: continue
                    val url = so["iframe"].str() ?: continue
                    if (url == iframe) continue
                    streams += SportStream(so["source_tag"].str()?.let { "PPV · $it" } ?: "PPV mirror", embed = url)
                }
                out += SportGame(
                    id = "ppv:${s["id"].str() ?: s["name"].str() ?: UUID.randomUUID()}", title = s["name"].str() ?: "Live",
                    category = ppvCategories[rawName] ?: rawName, startsAt = date(s["starts_at"]), endsAt = ends, alwaysLive = alwaysLive,
                    poster = s["poster"].str(), streams = streams, tag = s["tag"].str(),
                    colors = s["colors"].arr().mapNotNull { it.str() }.ifEmpty { null },
                )
            }
        }
        return out
    }

    private suspend fun fetchStreamed(): List<SportGame> {
        val matches = fetch("https://streamed.pk/api/matches/all").arr()
        val now = System.currentTimeMillis()
        val out = ArrayList<SportGame>()
        for (match in matches) {
            val m = match.obj() ?: continue
            val sources = m["sources"].arr()
            if (sources.isEmpty()) continue
            val category = streamedCategories[m["category"].str() ?: ""] ?: "Other"
            val starts = date(m["date"])
            val ends = starts?.plus(((durations[category] ?: 3.0) * 3_600_000).toLong())
            if (ends != null && now > ends) continue
            val teams = m["teams"].obj()
            val home = teams?.get("home").obj(); val away = teams?.get("away").obj()
            fun badge(team: JsonObject?) = team?.get("badge").str()?.let { "https://streamed.pk/api/images/badge/$it.webp" }
            val names = home?.get("name").str()?.let { h -> away?.get("name").str()?.let { a -> h to a } }
            out += SportGame(
                id = "streamed:${m["id"].str() ?: UUID.randomUUID()}", title = m["title"].str() ?: "Live", category = category,
                startsAt = starts, endsAt = ends, alwaysLive = starts == null, teams = names,
                logos = if (names == null) null else badge(home) to badge(away),
                poster = m["poster"].str()?.let { "https://streamed.pk$it" },
                streams = sources.mapNotNull { src ->
                    val o = src.obj() ?: return@mapNotNull null
                    val source = o["source"].str() ?: return@mapNotNull null
                    val id = o["id"].str() ?: return@mapNotNull null
                    SportStream("Streamed · $source", streamedSource = source, streamedId = id)
                },
            )
        }
        return out
    }

    private suspend fun fetchStreamFree(): List<SportGame> {
        val streams = fetch("https://streamfree.top/api/v1/streams").obj()?.get("streams").arr()
        val now = System.currentTimeMillis()
        val out = ArrayList<SportGame>()
        for (stream in streams) {
            val s = stream.obj() ?: continue
            val seen = HashSet<String>()
            val embeds = (s["sources"].arr().mapNotNull { it.str() } + listOfNotNull(s["embed_url"].str()))
                .filter { it.startsWith("http") && seen.add(it) }
            if (embeds.isEmpty()) continue
            val category = streamfreeCategories[s["category"].str() ?: ""] ?: "Other"
            var starts = date(s["match_timestamp"])
            var ends = starts?.plus(((durations[category] ?: 3.0) * 3_600_000).toLong())
            // Channels keep a weeks-old timestamp; with embeds and 2+ days "in", it's a channel.
            if (starts != null && now - starts > 2 * 86_400_000L) { starts = null; ends = null }
            if (ends != null && now > ends) continue
            val t1 = s["team1"].obj(); val t2 = s["team2"].obj()
            val names = t1?.get("name").str()?.let { h -> t2?.get("name").str()?.let { a -> h to a } }
            out += SportGame(
                id = "streamfree:${s["id"].str() ?: s["name"].str() ?: UUID.randomUUID()}", title = s["name"].str() ?: "Live",
                category = category, startsAt = starts, endsAt = ends, alwaysLive = starts == null, teams = names,
                logos = if (names == null) null else t1?.get("logo").str() to t2?.get("logo").str(),
                poster = s["thumbnail_url"].str(),
                streams = embeds.mapIndexed { index, url -> SportStream(streamfreeLabel(url, index, embeds.size), embed = url) },
                tag = s["league"].str(),
            )
        }
        return out
    }

    // "…/football/redzone1080p" → "StreamFree 1080p" (same as the website).
    fun streamfreeLabel(url: String, index: Int, count: Int): String {
        Regex("(2160|1080|720|480)p").find(url)?.value?.let { return "StreamFree " + if (it == "2160p") "4K" else it }
        return if (count > 1) "StreamFree ${index + 1}" else "StreamFree"
    }

    fun tokens(teams: Pair<String, String>?, name: String): Set<String>? {
        fun nickname(team: String) = team.lowercase().split(Regex("[^a-z0-9]+")).lastOrNull { it.isNotEmpty() }
        if (teams != null) { val a = nickname(teams.first); val b = nickname(teams.second); if (a != null && b != null) return setOf(a, b) }
        val lower = " ${name.lowercase()} "
        for (separator in listOf(" vs. ", " vs ", " v ", " at ", " @ ", " - ")) {
            if (!lower.contains(separator)) continue
            val parts = lower.split(separator)
            if (parts.size != 2) continue
            val left = parts[0].split(":").last()
            val a = nickname(left); val b = nickname(parts[1])
            if (a != null && b != null) return setOf(a, b)
        }
        return null
    }

    private fun merge(entries: List<SportGame>): List<SportGame> {
        val games = ArrayList<SportGame>()
        fun key(text: String) = text.lowercase().filter { it.isLetterOrDigit() }
        for (entry in entries) {
            val tokens = entry.teamTokens
            val index = games.indexOfFirst { game ->
                val close = game.startsAt == null || entry.startsAt == null || Math.abs(game.startsAt - entry.startsAt) <= 3 * 3_600_000
                val other = game.teamTokens
                if (tokens != null && other != null) tokens == other && close else key(game.title) == key(entry.title) && close
            }
            if (index < 0) { games += entry; continue }
            val game = games[index]
            games[index] = game.copy(
                streams = game.streams + entry.streams.filter { it !in game.streams },
                teams = game.teams ?: entry.teams, logos = game.logos ?: entry.logos, poster = game.poster ?: entry.poster,
                tag = game.tag ?: entry.tag, colors = game.colors ?: entry.colors,
                category = if (game.category == "Other") entry.category else game.category,
                alwaysLive = game.alwaysLive && entry.alwaysLive,
            )
        }
        return games
    }

    // MARK: Streams → player servers

    private val serverCache = HashMap<String, Pair<Long, List<StreamServer>>>()

    // Cached for 90s: focusing a card and then pressing Play shouldn't resolve the same streams twice.
    suspend fun servers(game: SportGame, limit: Int = 10): List<StreamServer> {
        val key = "${game.id}:$limit"
        serverCache[key]?.let { (at, list) -> if (System.currentTimeMillis() - at < 90_000) return list }
        val fresh = resolve(game, limit)
        if (fresh.isNotEmpty()) serverCache[key] = System.currentTimeMillis() to fresh
        return fresh
    }

    private suspend fun resolve(game: SportGame, limit: Int): List<StreamServer> = coroutineScope {
        val perFeed = game.streams.map { async { streams(it) } }.awaitAll()
        // Interleave (each feed's best, then each feed's second…) so the
        // first few raced are from different feeds; the rest are backups.
        val urls = ArrayList<Pair<String, String>>()
        val seen = HashSet<String>()
        for (round in 0 until (perFeed.maxOfOrNull { it.size } ?: 0)) {
            for (list in perFeed) if (round < list.size && seen.add(list[round].second)) urls += list[round]
        }
        com.binge.tv.player.SportsMemory.rank(urls) { it.first }.take(limit).map { (label, url) -> StreamServer(url, label) { _, _, _, _ -> url } }
    }

    // Streamed sources resolve to every stream of that source, HD first, up to 4.
    private suspend fun streams(stream: SportStream): List<Pair<String, String>> {
        stream.embed?.let { return listOf(stream.label to it) }
        val source = stream.streamedSource ?: return emptyList()
        val id = URLEncoder.encode(stream.streamedId ?: return emptyList(), "UTF-8").replace("+", "%20")
        val list = fetch("https://streamed.pk/api/stream/$source/$id").arr().mapNotNull { it.obj() }
        val sorted = list.sortedWith(compareBy({ if (it["hd"].truthy()) 0 else 1 }, { (it["streamNo"] as? JsonPrimitive)?.intOrNull ?: 0 }))
        return sorted.take(4).mapNotNull { item ->
            val url = item["embedUrl"].str() ?: return@mapNotNull null
            val number = if (list.size > 1) " ${(item["streamNo"] as? JsonPrimitive)?.intOrNull ?: 1}" else ""
            val language = item["language"].str()?.takeIf { it.isNotEmpty() && it.lowercase() != "main" }?.let { " · $it" } ?: ""
            "${stream.label}$number${if (item["hd"].truthy()) " HD" else ""}$language" to url
        }
    }
}
