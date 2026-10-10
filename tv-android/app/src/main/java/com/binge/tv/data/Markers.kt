package com.binge.tv.data

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

// Intro and credits markers, same sources and rules as the website
// (src/utils/episodeMarkers.js): viewers' timings via the
// episode_marker_summary RPC, and AniSkip's community timings for anime.
data class EpisodeMarkers(val intro: Intro? = null, val credits: Double? = null) {
    data class Intro(val start: Double, val end: Double, val source: String)

    companion object {
        // An early 15s–3.5min forward jump: someone skipping the intro.
        fun looksLikeIntroSkip(from: Double, to: Double, duration: Double): Boolean {
            if (from < 0 || to <= from) return false
            val early = from < minOf(600.0, if (duration > 0) duration * 0.35 else 600.0)
            return early && (to - from) in 15.0..210.0
        }
        // Moving on this far in (but before the last 20s): the credits had started.
        fun looksLikeCredits(time: Double, duration: Double) = duration > 300 && time > 0 && time / duration >= 0.85 && duration - time >= 20
    }
}

object EpisodeMarkerStore {
    private val cache = HashMap<String, EpisodeMarkers>()

    suspend fun markers(title: Title, season: Int, episode: Int): EpisodeMarkers = coroutineScope {
        val key = "${title.dbId}:$season:$episode"
        cache[key]?.let { return@coroutineScope it }
        val crowd = async { crowdMarkers(title.dbId, season, episode) }
        val anime = async { AniSkip.markers(title, season, episode) }
        val viewers = crowd.await(); val aniskip = anime.await()
        val result = EpisodeMarkers(
            intro = if (viewers.intro?.source == "viewers") viewers.intro else (aniskip.intro ?: viewers.intro),
            credits = viewers.credits ?: aniskip.credits,
        )
        cache[key] = result
        result
    }

    @Serializable private data class Row(val kind: String, val startS: Double? = null, val endS: Double? = null, val source: String? = null)

    private suspend fun crowdMarkers(mediaId: Long, season: Int, episode: Int): EpisodeMarkers {
        val rows = runCatching {
            json.decodeFromString<List<Row>>(Supabase.rpc("episode_marker_summary", mapOf("p_media_id" to mediaId, "p_season" to season, "p_episode" to episode)))
        }.getOrDefault(emptyList())
        var out = EpisodeMarkers()
        for (row in rows) {
            if (row.kind == "intro" && row.startS != null && row.endS != null && row.endS > row.startS)
                out = out.copy(intro = EpisodeMarkers.Intro(row.startS, row.endS, if (row.source == "show") "show" else "viewers"))
            if (row.kind == "credits" && row.startS != null) out = out.copy(credits = row.startS)
        }
        return out
    }

    fun reportIntro(title: Title, season: Int, episode: Int, start: Double, end: Double, duration: Double) {
        if (EpisodeMarkers.looksLikeIntroSkip(start, end, duration)) report(title, season, episode, "intro", start, end, duration)
    }

    fun reportCredits(title: Title, season: Int, episode: Int, start: Double, duration: Double) {
        if (EpisodeMarkers.looksLikeCredits(start, duration)) report(title, season, episode, "credits", start, null, duration)
    }

    private fun report(title: Title, season: Int, episode: Int, kind: String, start: Double, end: Double?, duration: Double) {
        cache.remove("${title.dbId}:$season:$episode")
        val userId = Supabase.session?.userId ?: return
        AppModel.scope.launch {
            runCatching {
                Supabase.upsert("episode_markers", "user_id,media_id,season,episode,kind", mapOf(
                    "user_id" to userId, "media_id" to title.dbId, "season" to season, "episode" to episode, "kind" to kind,
                    "start_s" to Math.round(start * 10) / 10.0, "end_s" to end?.let { Math.round(it * 10) / 10.0 },
                    "duration_s" to duration.takeIf { it > 0 }, "updated_at" to IsoDate.now(),
                ))
            }
        }
    }
}

// AniSkip (api.aniskip.com): community-timed openings/endings for anime,
// keyed by MyAnimeList id, which AniList gives us from the title.
object AniSkip {
    suspend fun markers(title: Title, season: Int, episode: Int): EpisodeMarkers {
        if (title.genre?.contains("animation", ignoreCase = true) != true) return EpisodeMarkers()
        if (title.originalLanguage != null && title.originalLanguage != "ja") return EpisodeMarkers()
        val malId = malId(title.name, season, episode) ?: return EpisodeMarkers()
        val body = Net.text("https://api.aniskip.com/v2/skip-times/$malId/$episode?types[]=op&types[]=ed&episodeLength=0") ?: return EpisodeMarkers()
        val results = runCatching { plainJson.parseToJsonElement(body).jsonObject["results"]?.jsonArray }.getOrNull() ?: return EpisodeMarkers()
        var out = EpisodeMarkers()
        for (result in results) {
            val obj = result.jsonObject
            val interval = obj["interval"]?.jsonObject ?: continue
            val start = interval["startTime"]?.jsonPrimitive?.doubleOrNull ?: continue
            val end = interval["endTime"]?.jsonPrimitive?.doubleOrNull ?: continue
            if (end <= start) continue
            val type = obj["skipType"]?.jsonPrimitive?.contentOrNull
            if (type == "op" && out.intro == null) out = out.copy(intro = EpisodeMarkers.Intro(start, end, "aniskip"))
            if (type == "ed" && out.credits == null) out = out.copy(credits = start)
        }
        return out
    }

    private fun normalize(text: String) = text.lowercase().split(Regex("[^\\p{L}\\p{N}]+")).filter { it.isNotEmpty() }.joinToString(" ")

    private suspend fun malId(name: String, season: Int, episode: Int): Int? {
        val search = if (season > 1) "$name Season $season" else name
        val payload = toJson(mapOf(
            "query" to "query(\$s:String){Media(search:\$s,type:ANIME){idMal episodes countryOfOrigin synonyms title{english romaji}}}",
            "variables" to mapOf("s" to search),
        )).toString()
        val reply = runCatching {
            Net.send(Request.Builder().url("https://graphql.anilist.co").post(payload.toRequestBody("application/json".toMediaType())).build())
        }.getOrNull() ?: return null
        val media = runCatching { plainJson.parseToJsonElement(reply.body).jsonObject["data"]!!.jsonObject["Media"]!!.jsonObject }.getOrNull() ?: return null
        val id = media["idMal"]?.jsonPrimitive?.intOrNull ?: return null
        if (media["countryOfOrigin"]?.jsonPrimitive?.contentOrNull != "JP") return null
        val titles = media["title"] as? JsonObject
        val names = (listOfNotNull(titles?.get("english")?.jsonPrimitive?.contentOrNull, titles?.get("romaji")?.jsonPrimitive?.contentOrNull) +
            (runCatching { media["synonyms"]!!.jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull } }.getOrDefault(emptyList()))).map(::normalize)
        val wanted = normalize(name)
        if (names.none { if (season > 1) it.startsWith(wanted) else it == wanted }) return null
        media["episodes"]?.jsonPrimitive?.intOrNull?.let { if (episode > it) return null }
        return id
    }
}
