package com.binge.tv.player

import android.net.Uri
import com.binge.tv.data.MediaKind
import com.binge.tv.data.OriginalLanguage
import com.binge.tv.data.PlaybackPrefs
import com.binge.tv.data.Prefs
import com.binge.tv.data.ServerSwitches
import com.binge.tv.data.Supabase
import com.binge.tv.data.TmdbDetails
import com.binge.tv.data.SportGame
import com.binge.tv.data.Title
import com.binge.tv.data.json
import kotlinx.serialization.Serializable

data class PlayRequest(
    val title: Title,
    val season: Int? = null,
    val episode: Int? = null,
    val startAt: Double? = null,
    // Episode counts per season, for Up Next.
    val seasons: List<TmdbDetails.Season> = emptyList(),
    // Live sports: the streams to race instead of the movie servers.
    val liveStreams: List<StreamServer> = emptyList(),
    val subtitle: String? = null,
    val game: SportGame? = null,
) {
    val isLive get() = liveStreams.isNotEmpty()
    val key: String get() = game?.let { "live:${it.id}" } ?: "${title.id}:${season ?: 0}:${episode ?: 0}"
}

// Streaming servers. Android's WebView is Chromium (Media Source Extensions
// included), so the website's servers work here, not just the native-HLS
// ones tvOS is limited to. Order = default ranking.
class StreamServer(val id: String, val name: String, val build: (tmdbId: Int, kind: MediaKind, season: Int, episode: Int) -> String) {
    override fun equals(other: Any?) = other is StreamServer && other.id == id
    override fun hashCode() = id.hashCode()

    companion object {
        private fun url(base: String, params: List<Pair<String, String>>) = Uri.parse(base).buildUpon().apply {
            params.forEach { (k, v) -> appendQueryParameter(k, v) }
        }.build().toString()

        val all = listOf(
            StreamServer("vidrift", "VidRift") { id, kind, s, e ->
                url(if (kind == MediaKind.TV) "https://embed.vidrift.net/embed/tv/$id/$s/$e" else "https://embed.vidrift.net/embed/movie/$id",
                    listOf("brand" to "binge.", "brandColor" to "f4f6f8"))
            },
            StreamServer("vidy", "Vidy") { id, kind, s, e ->
                url(if (kind == MediaKind.TV) "https://vidy.st/tv/$id/$s/$e" else "https://vidy.st/movie/$id",
                    listOf("autoplay" to "true", "color" to "F4F6F8"))
            },
            StreamServer("cinesrc", "CineSrc") { id, kind, s, e ->
                val params = mutableListOf<Pair<String, String>>()
                if (kind == MediaKind.TV) { params += "s" to "$s"; params += "e" to "$e" }
                params += listOf("autoplay" to "true", "autonext" to "false", "color" to "#f4f6f8")
                if (PlaybackPrefs.subtitle != "off") {
                    params += "subtitles" to "auto"
                    params += "subtitlelang" to PlaybackPrefs.languageName(PlaybackPrefs.subtitle)
                }
                url(if (kind == MediaKind.TV) "https://cinesrc.st/embed/tv/$id" else "https://cinesrc.st/embed/movie/$id", params)
            },
            StreamServer("vidlink", "VidLink") { id, kind, s, e ->
                if (kind == MediaKind.TV) "https://vidlink.pro/tv/$id/$s/$e?autoplay=true" else "https://vidlink.pro/movie/$id?autoplay=true"
            },
            StreamServer("videasy", "Videasy") { id, kind, s, e ->
                if (kind == MediaKind.TV) "https://player.videasy.net/tv/$id/$s/$e" else "https://player.videasy.net/movie/$id"
            },
            StreamServer("vidsrc-ru", "VidSrc") { id, kind, s, e ->
                url(if (kind == MediaKind.TV) "https://vidsrc.ru/tv/$id/$s/$e" else "https://vidsrc.ru/movie/$id",
                    listOfNotNull("autoplay" to "true", "colour" to "f4f6f8", if (kind == MediaKind.TV) "autonextepisode" to "false" else null))
            },
        )

        // The server that last worked for this title goes first (so episode 2
        // starts where episode 1 ended up), like the site's streamPreferences.
        fun ranked(title: Title): List<StreamServer> {
            val last = Prefs.string("server.${title.id}") ?: return all
            val hit = all.firstOrNull { it.id == last } ?: return all
            return listOf(hit) + all.filter { it != hit }
        }

        fun rememberWorking(server: StreamServer, title: Title) = Prefs.set("server.${title.id}", server.id)
    }
}

// Community audio reports → server choice (same as the Apple TV app's ServerPlan).
object ServerPlan {
    @Serializable private data class Report(val provider: String, val worksCount: Int? = null, val brokenCount: Int? = null,
                                            val audioLang: String? = null, val audioCount: Int? = null)

    suspend fun servers(title: Title, originalLanguage: String?): List<StreamServer> {
        val disabled = ServerSwitches.disabledServers()
        var list = StreamServer.ranked(title).filter { it.id !in disabled }
        com.binge.tv.DebugLaunch.server?.let { only -> list = list.filter { it.id == only } }
        val original = originalLanguage ?: OriginalLanguage.of(title)
        val wanted = if (PlaybackPrefs.audio == "original") original else PlaybackPrefs.audio
        if (wanted.isNullOrEmpty()) return list
        val reports = runCatching {
            json.decodeFromString<List<Report>>(Supabase.rpc("stream_report_summary", mapOf("p_media_type" to title.kind.raw, "p_media_id" to title.dbId)))
        }.getOrDefault(emptyList())
        val audio = reports.mapNotNull { r -> r.audioLang?.let { r.provider to it } }.toMap()
        val matching = list.filter { audio[it.id] == wanted }
        if (matching.isNotEmpty()) return matching + list.filter { audio[it.id] == null }
        list = list.filter { audio[it.id] == null || audio[it.id] == wanted }
        return list.ifEmpty { StreamServer.ranked(title).filter { it.id !in disabled } }
    }
}
