package com.binge.tv.data

import android.content.Context
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

// Subtitle timing that sticks (the Apple TV app's SubtitleSync). A file made
// for another cut of the video is off by the same gap all the way through,
// so once a viewer has shifted it to match, the shift is kept: on this TV
// for this file and server, for the show's next episodes on that server, and
// (subtitle_sync) for every viewer after them, who then start in sync.
object SubtitleSync {
    data class Key(val kind: MediaKind, val mediaId: Long, val season: Int, val episode: Int,
                   val lang: String, val release: String, val server: String) {
        val local get() = "${kind.raw}:$mediaId:$season:$episode:$lang:$server:$release"
        val show get() = "show:${kind.raw}:$mediaId:$lang:$server"
    }

    enum class Source { MINE, VIEWERS, LAST_EPISODE }

    private fun prefs(context: Context) = context.getSharedPreferences("binge.subtitleSync", Context.MODE_PRIVATE)

    // Where to start: your own shift for this file, else what other viewers
    // settled on, else (a series) your shift on the last episode from this
    // server. Null: nothing known, start at 0.
    suspend fun start(context: Context, key: Key): Pair<Double, Source>? {
        val store = prefs(context)
        store.getString(key.local, null)?.toDoubleOrNull()?.let { return it to Source.MINE }
        shared(key)?.let { return it to Source.VIEWERS }
        if (key.kind == MediaKind.TV) store.getString(key.show, null)?.toDoubleOrNull()?.takeIf { it != 0.0 }?.let { return it to Source.LAST_EPISODE }
        return null
    }

    fun remember(context: Context, key: Key, offset: Double) {
        val store = prefs(context)
        if (store.all.size > 400) store.edit().clear().apply()
        store.edit().apply {
            putString(key.local, offset.toString())
            if (key.kind == MediaKind.TV) putString(key.show, offset.toString())
        }.apply()
    }

    @Serializable private data class Row(val offsetS: Double? = null, val viewers: Int? = null)

    private suspend fun shared(key: Key): Double? {
        val rows = runCatching {
            json.decodeFromString<List<Row>>(Supabase.rpc("subtitle_sync_summary", mapOf(
                "p_media_type" to key.kind.raw, "p_media_id" to key.mediaId, "p_season" to key.season, "p_episode" to key.episode,
                "p_lang" to key.lang, "p_release" to key.release, "p_server" to key.server,
            )))
        }.getOrNull()
        val value = rows?.firstOrNull()?.offsetS ?: return null
        return Math.round(value * 10) / 10.0
    }

    // Shared once the viewer has left it alone for a while (see PlayerModel).
    fun report(key: Key, offset: Double) {
        val userId = Supabase.session?.userId ?: return
        AppModel.scope.launch {
            runCatching {
                Supabase.upsert("subtitle_sync", "user_id,media_type,media_id,season,episode,lang,release,server", mapOf(
                    "user_id" to userId, "media_type" to key.kind.raw, "media_id" to key.mediaId,
                    "season" to key.season, "episode" to key.episode, "lang" to key.lang,
                    "release" to key.release.take(300), "server" to key.server.take(40),
                    "offset_s" to Math.round(offset * 10) / 10.0, "updated_at" to IsoDate.now(),
                ))
            }
        }
    }
}
