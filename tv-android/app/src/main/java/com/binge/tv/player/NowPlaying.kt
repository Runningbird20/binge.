package com.binge.tv.player

import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState

// What's playing, for the system (Apple TV's NowPlaying.swift): a media
// session with the title, episode, artwork and position, so the remote's
// media keys, Alexa ("Alexa, pause") and Fire TV's own media controls work
// on binge.'s player. Android's own MediaSession, no extra library.
object NowPlaying {
    private var session: MediaSession? = null
    private var owner: PlayerModel? = null
    private var shownKey: String? = null
    private var lastState: Pair<Boolean, Long>? = null

    fun update(model: PlayerModel, state: MediaState) {
        val session = sessionFor(model) ?: return
        val request = model.request
        val key = "${request.key}|${state.d > 0}"
        if (key != shownKey) {
            shownKey = key
            val subtitle = if (request.isLive) "LIVE" + (request.game?.league?.let { " · $it" } ?: "") else model.episodeLabel ?: request.title.year?.toString()
            session.setMetadata(MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, request.title.name)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, request.title.name)
                .apply { subtitle?.let { putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, it); putString(MediaMetadata.METADATA_KEY_ARTIST, it) } }
                .apply { (request.title.backdrop ?: request.title.poster)?.let { putString(MediaMetadata.METADATA_KEY_ART_URI, it); putString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI, it) } }
                .apply { if (!request.isLive && state.d > 0) putLong(MediaMetadata.METADATA_KEY_DURATION, (state.d * 1000).toLong()) }
                .build())
        }
        // The position is only re-sent when playing starts or stops, or it drifts
        // (the system runs the clock in between).
        val playing = !state.paused
        val position = (state.t * 1000).toLong()
        val last = lastState
        if (last == null || last.first != playing || Math.abs(position - last.second) > 3000) {
            lastState = playing to position
            val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or
                (if (request.isLive) 0 else PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND) or
                (if (model.nextEpisode != null) PlaybackState.ACTION_SKIP_TO_NEXT else 0)
            session.setPlaybackState(PlaybackState.Builder()
                .setActions(actions)
                .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, if (request.isLive) PlaybackState.PLAYBACK_POSITION_UNKNOWN else position, if (playing) 1f else 0f)
                .build())
        } else if (last.first == playing) {
            lastState = playing to position
        }
    }

    private fun sessionFor(model: PlayerModel): MediaSession? {
        if (owner === model) return session
        release(owner)
        val created = runCatching { MediaSession(model.context, "binge") }.getOrNull() ?: return null
        created.setCallback(object : MediaSession.Callback() {
            override fun onPlay() { if (model.playback.paused) model.togglePlay() }
            override fun onPause() { if (!model.playback.paused) model.togglePlay() }
            override fun onStop() { com.binge.tv.ui.PlayerLifecycle.exit?.invoke() }
            override fun onSeekTo(pos: Long) { model.seek(pos / 1000.0 - model.playback.t) }
            override fun onFastForward() { model.seek(10.0) }
            override fun onRewind() { model.seek(-10.0) }
            override fun onSkipToNext() { if (model.nextEpisode != null) model.playNext() }
        })
        created.isActive = true
        session = created
        owner = model
        shownKey = null
        lastState = null
        return created
    }

    fun release(model: PlayerModel?) {
        if (model == null || owner !== model) return
        runCatching { session?.isActive = false; session?.release() }
        session = null
        owner = null
        shownKey = null
        lastState = null
    }
}
