package com.binge.tv.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.binge.tv.data.AppModel
import com.binge.tv.data.EpisodeMarkerStore
import com.binge.tv.data.EpisodeMarkers
import com.binge.tv.data.ExternalSubtitleFile
import com.binge.tv.data.ExternalSubtitles
import com.binge.tv.data.MediaKind
import com.binge.tv.data.OriginalLanguage
import com.binge.tv.data.PlaybackPrefs
import com.binge.tv.data.Prefs
import com.binge.tv.data.SportGame
import com.binge.tv.data.SportsFeed
import com.binge.tv.data.Title
import com.binge.tv.data.Tmdb
import com.binge.tv.data.TmdbDetails
import kotlinx.coroutines.launch

enum class SleepOption(val label: String, val minutes: Int?) {
    OFF("Off", null), FIFTEEN("15 min", 15), THIRTY("30 min", 30), HOUR("1 hour", 60), EPISODE("End of episode", null)
}

// Drives the server's own player page from the remote. Which server plays
// is decided by a StreamRace (several servers at once, first to play wins).
// A port of the Apple TV app's PlayerModel; same rules throughout.
class PlayerModel(private val context: Context, initial: PlayRequest) {
    var request by mutableStateOf(initial); private set
    var server by mutableStateOf<StreamServer?>(null); private set
    var playback by mutableStateOf(MediaState()); private set
    var started by mutableStateOf(false); private set
    var racingNames by mutableStateOf(""); private set
    var notice by mutableStateOf<String?>(null)
    var hudVisible by mutableStateOf(true)
    var upNextCountdown by mutableStateOf<Int?>(null)
    var showSkipIntro by mutableStateOf(false); private set
    var stillWatching by mutableStateOf(false); private set
    var buffering by mutableStateOf(false); private set
    var pausedAmbient by mutableStateOf(false)
    var audioTracks by mutableStateOf<List<MediaTrack>>(emptyList()); private set
    var textTracks by mutableStateOf<List<MediaTrack>>(emptyList()); private set
    var markers by mutableStateOf(EpisodeMarkers()); private set
    var fillScreen by mutableStateOf(PlaybackPrefs.fillScreen); private set
    var sleep by mutableStateOf(SleepOption.OFF); private set
    var closed = false; private set

    // binge.'s own subtitles (OpenSubtitles), the same on every server.
    var external by mutableStateOf<ExternalSubtitleFile?>(null); private set
    var externalLoading by mutableStateOf(false); private set
    var useExternal by mutableStateOf(true); private set
    var subtitleLanguage by mutableStateOf(PlaybackPrefs.subtitle); private set
    var subtitleOffset by mutableStateOf(0.0); private set

    val surface = FrameLayout(context).apply { setBackgroundColor(android.graphics.Color.BLACK) }
    private val handler = Handler(Looper.getMainLooper())
    private var race: StreamRace? = null
    private val web: WebEngine? get() = race?.winner?.web
    private var sleepAt: Long? = null
    private var lastFill = 0L
    private var prefsAppliedFor: String? = null
    private var originalLanguage: String? = null
    private var skippedIntro = false
    private var markedWatched = false
    private var autoAdvances = 0
    private var hudHideAt = now() + 5000
    private var lastSaved = 0L
    private var warmedNext = false
    private var openedAt = now()
    private var userPaused = false
    private var lastClock = -1.0
    private var clockMovedAt = now()
    private var stateAt = now()
    private var recoveries = 0
    private var handPicked = false
    private var lastResume = 0L
    private var pausedSince: Long? = null
    private var raced = HashSet<String>()
    private var introSeekFrom: Double? = null
    private var introSeekAt = 0L
    private var ownIntroSkip = false
    private var expected: Double? = null
    private var externalKey: String? = null
    private var emptySubtitleSince: Long? = null
    private val triedSubtitleTracks = HashSet<Int>()
    private var noSubsSince: Long? = null
    private var trimmed = false

    private fun now() = System.currentTimeMillis()

    val servers: List<StreamServer> get() = if (request.isLive) request.liveStreams else StreamServer.all
    val isEpisode get() = request.title.kind == MediaKind.TV
    val episodeLabel: String?
        get() = request.subtitle ?: if (isEpisode && request.season != null && request.episode != null) "S${request.season}:E${request.episode}" else null

    // What's actually on screen, from the video's own height.
    val resolutionLabel: String?
        get() = when (playback.height) {
            in 2000..Int.MAX_VALUE -> "4K"
            in 1400 until 2000 -> "1440p"
            in 1000 until 1400 -> "1080p"
            in 700 until 1000 -> "720p"
            in 1 until 700 -> "SD"
            else -> null
        }

    // The line to draw now: our file (shifted by the viewer's offset), else the server's own track.
    val subtitleText: String
        get() {
            val file = external
            if (useExternal && file != null) return file.text(playback.t + subtitleOffset)
            return if (useExternal && externalLoading) "" else playback.cue
        }
    val usingExternalSubtitles get() = useExternal && external != null

    init {
        val warm = Warmup.take(initial)
        if (warm != null) adopt(warm) else if (initial.isLive) startRace(initial.liveStreams) else startPlannedRace()
        loop()
        AppModel.scope.launch { originalLanguage = OriginalLanguage.of(request.title) }
        loadMarkers()
        loadExternalSubtitles()
        val tmdbId = initial.title.tmdbId
        if (isEpisode && initial.seasons.isEmpty() && tmdbId != null) {
            AppModel.scope.launch {
                val details = runCatching { Tmdb.get<TmdbDetails>("tv/$tmdbId") }.getOrNull()
                request = request.copy(seasons = details?.seasons.orEmpty().filter { it.seasonNumber > 0 })
            }
        }
    }

    private fun loop() {
        if (closed) return
        tick()
        handler.postDelayed(::loop, 250)
    }

    // MARK: Races

    private fun startPlannedRace() {
        val planned = request
        racingNames = ""
        AppModel.scope.launch {
            val list = ServerPlan.servers(planned.title, planned.title.originalLanguage)
            if (planned.key != request.key || closed) return@launch
            startRace(list.ifEmpty { StreamServer.all })
        }
    }

    private fun startRace(list: List<StreamServer>) {
        val ordered = list.filter { it.id !in raced } + list.filter { it.id in raced }
        adopt(StreamRace(context, request, ordered, StreamRace.Mode.LIVE))
    }

    private fun adopt(next: StreamRace) {
        raced.addAll(next.candidates.map { it.server.id })
        val req = request
        AppModel.scope.launch {
            val seconds = ExpectedRuntime.seconds(req)
            if (req.key != request.key) return@launch
            expected = seconds
            next.expectedDuration = seconds
        }
        race?.let { it.stop(); surface.removeView(it.container) }
        race = next
        (next.container.parent as? ViewGroup)?.removeView(next.container)
        surface.addView(next.container, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        next.onChange = { raceChanged() }
        racingNames = next.candidates.joinToString(", ") { it.server.name }
        started = false
        trimmed = false
        warmedNext = false
        userPaused = false
        triedSubtitleTracks.clear()
        emptySubtitleSince = null
        playback = MediaState()
        buffering = false
        resetStallClock()
        next.goLive()
        raceChanged()
        showHUD()
    }

    private fun raceChanged() {
        val r = race ?: return
        val w = r.winner
        if (w != null) {
            server = w.server
            notice = null
            w.web.onProcessGone = { checkLost(force = true) }
        } else if (r.failed) {
            // Nothing in this race played, but there are untried servers.
            if (!handPicked && recoveries < 3 && servers.any { it.id !in raced }) {
                recoveries++
                notice = "Trying more servers…"
                startRace(servers)
                return
            }
            notice = "No server could play this right now. Press ▼ to try one again."
        }
    }

    fun close() {
        if (closed) return
        saveProgress(force = true)
        closed = true
        handler.removeCallbacksAndMessages(null)
        race?.stop()
        race = null
        Warmup.cancel()
    }

    // MARK: Remote

    fun leaveAmbient() { pausedAmbient = false; pausedSince = now(); showHUD() }

    fun togglePlay() {
        autoAdvances = 0
        pausedAmbient = false
        if (stillWatching) { stillWatching = false; playNext(); return }
        upNextCountdown?.let { if (it >= 0) { playNext(); return } }
        userPaused = !playback.paused
        race?.userPaused = userPaused
        web?.send(MediaCommand.Toggle)
        showHUD()
    }

    fun selectAudio(track: MediaTrack) { web?.send(MediaCommand.AudioTrack(track.index)); showHUD() }

    fun selectSubtitles(track: MediaTrack?) {
        useExternal = false
        if (track == null) subtitleLanguage = "off"
        web?.send(MediaCommand.TextTrack(track?.index ?: -1))
        showHUD()
    }

    fun chooseSubtitleLanguage(code: String) {
        subtitleLanguage = code
        useExternal = code != "off"
        if (code == "off") web?.send(MediaCommand.TextTrack(-1))
        loadExternalSubtitles(force = true)
        showHUD()
    }

    fun nudgeSubtitles(by: Double) { subtitleOffset = (subtitleOffset + by).coerceIn(-30.0, 30.0); showHUD() }

    fun nextSubtitleVersion() {
        val file = external ?: return
        if (file.versions > 1) loadExternalSubtitles(force = true, version = (file.version + 1) % minOf(file.versions, 10))
    }

    private fun loadExternalSubtitles(force: Boolean = false, version: Int = 0) {
        if (request.isLive || subtitleLanguage == "off") { external = null; return }
        val req = request
        val key = "${req.key}:$subtitleLanguage:$version"
        if (!force && externalKey == key) return
        externalKey = key
        externalLoading = true
        if (version == 0) subtitleOffset = 0.0
        val language = subtitleLanguage
        AppModel.scope.launch {
            val file = ExternalSubtitles.load(req.title, req.season, req.episode, language, version)
            if (externalKey != key) return@launch
            externalLoading = false
            external = file
            if (file != null && useExternal) web?.send(MediaCommand.TextTrack(-1))
        }
    }

    fun setFill(fill: Boolean) {
        fillScreen = fill
        Prefs.set("fillScreen", fill)
        web?.send(if (fill) MediaCommand.Fill else MediaCommand.Unfill)
    }

    fun chooseSleep(option: SleepOption) {
        sleep = option
        sleepAt = option.minutes?.let { now() + it * 60_000L }
    }

    // Once per video, as soon as its tracks show up: the profile's saved audio and subtitle language.
    private fun applyPreferredTracks(web: WebEngine) {
        val key = "${server?.id}-${request.season}-${request.episode}"
        if (prefsAppliedFor == key || (audioTracks.isEmpty() && textTracks.isEmpty())) return
        prefsAppliedFor = key
        if (PlaybackPrefs.audio == "original" && originalLanguage == null && request.title.tmdbId != null && !request.isLive) {
            prefsAppliedFor = null
            return
        }
        val audio = if (PlaybackPrefs.audio == "original") originalLanguage ?: "" else PlaybackPrefs.audio
        val describes = { t: MediaTrack -> Regex("descri|\\bAD\\b", RegexOption.IGNORE_CASE).containsMatchIn(t.label) }
        if (PlaybackPrefs.audioDescription) {
            val match = audioTracks.firstOrNull { describes(it) && (audio.isEmpty() || matches(it, audio)) } ?: audioTracks.firstOrNull(describes)
            if (match != null && !match.on) web.send(MediaCommand.AudioTrack(match.index))
        } else if (audio.isNotEmpty()) {
            val match = audioTracks.firstOrNull { matches(it, audio) && !describes(it) } ?: audioTracks.firstOrNull { matches(it, audio) }
            if (match != null && !match.on) web.send(MediaCommand.AudioTrack(match.index))
        }
        val subtitles = PlaybackPrefs.subtitle
        if (usingExternalSubtitles || subtitles == "off") {
            if (textTracks.any { it.on }) web.send(MediaCommand.TextTrack(-1))
        } else {
            val match = textTracks.filter { matches(it, subtitles) }.maxByOrNull { it.cues }
            if (match != null && !match.on) web.send(MediaCommand.TextTrack(match.index))
        }
    }

    // The chosen server subtitle track has no lines: try the same language's other tracks in turn.
    private fun fixEmptySubtitles(state: MediaState, web: WebEngine) {
        val current = state.text.firstOrNull { it.on }
        if (!started || usingExternalSubtitles || (useExternal && externalLoading) || current == null) { emptySubtitleSince = null; return }
        if (current.cues > 0) { emptySubtitleSince = null; return }
        triedSubtitleTracks += current.index
        val since = emptySubtitleSince ?: run { emptySubtitleSince = now(); return }
        if (now() - since < 2500) return
        emptySubtitleSince = null
        val language = current.language.take(2).lowercase()
        val plain = PlaybackPrefs.languageName(language).lowercase()
        val next = state.text.filter { it.index !in triedSubtitleTracks &&
            (it.language.take(2).lowercase() == language || displayName(it).startsWith(displayName(current))) }
            .sortedWith(compareBy({ -it.cues }, { if (it.label.lowercase() == plain) 0 else 1 }))
            .firstOrNull()
        next?.let { web.send(MediaCommand.TextTrack(it.index)) }
    }

    private fun loadMarkers() {
        val season = request.season ?: return
        val episode = request.episode ?: return
        if (!isEpisode) return
        val title = request.title
        AppModel.scope.launch {
            val found = EpisodeMarkerStore.markers(title, season, episode)
            if (request.season == season && request.episode == episode) markers = found
        }
    }

    // ▼ while "Skip intro" shows: hide it for the rest of this episode.
    fun dismissSkipIntro() { skippedIntro = true; showSkipIntro = false }

    // ▲ during the intro: straight to its end when we know it, else a typical 85s.
    fun skipIntro() {
        skippedIntro = true
        showSkipIntro = false
        val intro = markers.intro
        val w = web
        if (intro != null && w != null) {
            ownIntroSkip = true
            w.send(MediaCommand.SeekTo(intro.end))
            playback = playback.copy(t = intro.end)
            showHUD()
        } else seek(85.0)
    }

    fun seek(by: Double) {
        autoAdvances = 0
        val w = web
        if (w == null || request.isLive) {
            notice = if (request.isLive) "This is live — skipping isn't available." else null
            showHUD(); return
        }
        if (by > 0 && isEpisode && !ownIntroSkip && introSeekFrom == null && playback.t < 600) introSeekFrom = playback.t
        introSeekAt = now()
        w.send(MediaCommand.SeekBy(by))
        playback = playback.copy(t = maxOf(0.0, playback.t + by)) // instant HUD feedback
        showHUD()
    }

    fun showHUD() { hudVisible = true; hudHideAt = now() + 4000 }

    // Switch this player to a live game.
    suspend fun switchToLive(game: SportGame) {
        val list = SportsFeed.servers(game)
        if (list.isEmpty()) { notice = "Couldn't find a stream for ${game.title}."; return }
        saveProgress(force = true)
        request = PlayRequest(Title(MediaKind.MOVIE, 0, game.title), liveStreams = list, subtitle = "LIVE · ${game.league}", game = game)
        upNextCountdown = null; stillWatching = false; raced.clear(); recoveries = 0; handPicked = false
        startRace(list)
    }

    // A hand-picked server plays alone, from where you were.
    fun choose(next: StreamServer) {
        saveProgress(force = true)
        if (playback.t > 30 && !request.isLive) request = request.copy(startAt = playback.t)
        notice = null
        handPicked = true
        startRace(listOf(next))
    }

    fun play(season: Int, episode: Int, automatic: Boolean = false) {
        saveProgress(force = true)
        autoAdvances = if (automatic) autoAdvances + 1 else 0
        skippedIntro = false; markedWatched = false; showSkipIntro = false
        request = request.copy(season = season, episode = episode, startAt = null)
        upNextCountdown = null
        openedAt = now(); recoveries = 0; handPicked = false; raced.clear()
        markers = EpisodeMarkers(); introSeekFrom = null; ownIntroSkip = false
        loadMarkers()
        external = null
        loadExternalSubtitles()
        val warm = Warmup.take(request)
        if (warm != null) adopt(warm) else startPlannedRace()
    }

    // MARK: Polling

    private fun tick() {
        val w = web ?: return
        val state = w.poll()
        if (state != null) apply(state, w) else checkLost()
    }

    private fun checkSubtitlesAvailable(state: MediaState) {
        val wanted = PlaybackPrefs.subtitle
        val original = originalLanguage
        if (!started || request.isLive || wanted == "off" || state.text.isNotEmpty() || usingExternalSubtitles || externalLoading ||
            original == null || original.startsWith(wanted)) { noSubsSince = null; return }
        val since = noSubsSince ?: run { noSubsSince = now(); return }
        if (now() - since > 8000) { noSubsSince = null; recover("has no subtitles") }
    }

    private fun resetStallClock() { lastClock = -1.0; clockMovedAt = now(); stateAt = now() }

    // The page stopped reporting its video altogether (its renderer died, or the server replaced the page).
    private fun checkLost(force: Boolean = false) {
        if (started && (force || now() - stateAt > 8000)) recover("lost the video")
    }

    private fun watchClock(state: MediaState) {
        val t = now()
        stateAt = t
        if (state.paused || state.ended || Math.abs(state.t - lastClock) > 0.15) { lastClock = state.t; clockMovedAt = t }
        val stuck = if (started) t - clockMovedAt else 0
        buffering = stuck > 1500
        if (stuck > (if (request.isLive) 12_000 else 20_000)) recover("stopped playing")
    }

    private fun recover(reason: String) {
        val current = server ?: return
        resetStallClock()
        // A server you chose yourself is never swapped out behind your back.
        if (handPicked || recoveries >= 3) {
            notice = "${current.name} $reason. Press ▼ to pick another server."
            hudVisible = true
            return
        }
        recoveries++
        saveProgress(force = true)
        if (!request.isLive && playback.t > 5) request = request.copy(startAt = playback.t)
        val others = servers.filter { it != current }
        startRace(others.ifEmpty { servers })
        notice = "${current.name} $reason. Switching servers…"
    }

    // A pause the app means (sleep timer, still watching, leaving the app): treated like the viewer's own.
    private fun holdPause() { userPaused = true; race?.userPaused = true; web?.send(MediaCommand.Pause) }

    // Leaving the app (Home button, screensaver): pause and save, like any streaming app. Live keeps going.
    fun onAppPause() {
        if (closed) return
        saveProgress(force = true)
        if (!request.isLive && started && !playback.paused) holdPause()
    }

    fun onAppResume() { if (!closed) { resetStallClock(); showHUD() } }

    fun trimMemory() { race?.trimMemory() }

    private fun apply(state: MediaState, w: WebEngine) {
        playback = state
        watchClock(state)
        val exp = expected
        if (started && exp != null && ExpectedRuntime.isWrong(state.d, exp)) { expected = null; recover("had the wrong video"); return }
        if (state.audio != audioTracks) audioTracks = state.audio
        // One entry per label (VidRift lists ~150 tracks, many repeats).
        val best = LinkedHashMap<String, MediaTrack>()
        for (track in state.text) {
            val label = displayName(track)
            val kept = best[label]
            if (kept == null || (!kept.on && (track.on || track.cues > kept.cues))) best[label] = track
        }
        val unique = best.values.toList()
        if (unique != textTracks) textTracks = unique
        checkSubtitlesAvailable(state)
        fixEmptySubtitles(state, w)
        applyPreferredTracks(w)
        // A handed-over warm race is paused on its first frame: keep asking it to play.
        if (!started && state.video && state.paused && !userPaused) { w.send(MediaCommand.Unmute); w.send(MediaCommand.Play) }
        // Servers that pause themselves (an overlay, a second player): only the remote pauses here.
        if (started && state.paused && !state.ended && !userPaused && now() - lastResume > 2000) { lastResume = now(); w.send(MediaCommand.Play) }
        if (!started && state.t > 0.4 && !state.paused) started = true

        if (hudVisible && now() > hudHideAt && !state.paused) hudVisible = false
        if (started && state.paused && userPaused) {
            val since = pausedSince ?: now().also { pausedSince = it }
            if (now() - since > 180_000 && PlaybackPrefs.ambient) pausedAmbient = true
        } else { pausedSince = null; pausedAmbient = false }
        if (state.paused && started) hudVisible = true

        // Keep the video pinned full screen (servers swap the <video> when they change quality).
        if (started && now() - lastFill > 3000) {
            lastFill = now()
            if (fillScreen) w.send(MediaCommand.Fill)
            // Ad frames go once the video has played a while (fill marks which frames hold it).
            if (fillScreen && state.t > 8 && !trimmed) { trimmed = true; w.send(MediaCommand.Trim) }
            w.send(MediaCommand.CaptionStyle(PlaybackPrefs.captionSize, PlaybackPrefs.captionBackground))
        }

        val intro = markers.intro
        showSkipIntro = PlaybackPrefs.skipIntroButton && isEpisode && started && !skippedIntro &&
            (if (intro != null) state.t >= intro.start - 0.5 && state.t < intro.end - 2 else state.t > 15 && state.t < 240)
        // A viewer's skip has settled: share where the intro was.
        introSeekFrom?.let { from ->
            if (now() - introSeekAt > 6000) {
                introSeekFrom = null
                val s = request.season; val e = request.episode
                if (s != null && e != null) EpisodeMarkerStore.reportIntro(request.title, s, e, from, state.t, state.d)
            }
        }
        val s = request.season; val e = request.episode
        if (isEpisode && !markedWatched && state.d > 120 && state.t / state.d > 0.9 && s != null && e != null) {
            markedWatched = true
            val title = request.title
            AppModel.scope.launch { AppModel.markEpisodeWatched(title, s, e) }
        }
        sleepAt?.let { if (now() > it) { sleepAt = null; sleep = SleepOption.OFF; holdPause(); notice = "Sleep timer: paused."; hudVisible = true } }
        handleUpNext(state)
        saveProgress(force = false)
    }

    // MARK: Up Next

    val nextEpisode: Pair<Int, Int>?
        get() {
            if (!isEpisode) return null
            val s = request.season ?: return null
            val e = request.episode ?: return null
            val count = request.seasons.firstOrNull { it.seasonNumber == s }?.episodeCount
            if (count != null && e < count) return s to e + 1
            if (request.seasons.any { it.seasonNumber == s + 1 && (it.episodeCount ?: 0) > 0 }) return s + 1 to 1
            return null
        }

    private var lastCountdownTick = 0L

    private fun handleUpNext(state: MediaState) {
        val next = nextEpisode ?: return
        if (!started || state.d <= 120) return
        val remaining = state.d - state.t
        val credits = markers.credits
        val atCredits = credits != null && state.t >= credits && remaining > 5
        if ((remaining < 90 || (credits != null && state.t >= credits - 60)) && !warmedNext) {
            warmedNext = true
            Warmup.prepare(PlayRequest(request.title, next.first, next.second, seasons = request.seasons))
        }
        if (state.ended || remaining < 25 || atCredits) {
            if (sleep == SleepOption.EPISODE || autoAdvances >= 3) {
                if (state.ended || remaining < 2) {
                    if (sleep == SleepOption.EPISODE) { sleep = SleepOption.OFF; notice = "Sleep timer: stopped after this episode." }
                    else stillWatching = true
                    holdPause()
                    upNextCountdown = null
                }
                return
            }
            // Counts down once a second (this runs 4× a second).
            if (now() - lastCountdownTick < 1000) return
            lastCountdownTick = now()
            val value = upNextCountdown
            if (value == null) upNextCountdown = 10 else if (value > 0) upNextCountdown = value - 1
            if (upNextCountdown == 0) playNext(automatic = true)
        }
    }

    fun cancelUpNext() { upNextCountdown = -1 }

    fun playNext(automatic: Boolean = false) {
        val next = nextEpisode ?: return
        val s = request.season; val e = request.episode
        if (!automatic && upNextCountdown == null && s != null && e != null)
            EpisodeMarkerStore.reportCredits(request.title, s, e, playback.t, playback.d)
        play(next.first, next.second, automatic)
    }

    // MARK: Progress (synced to continue_watching, like the site)

    private fun saveProgress(force: Boolean) {
        if (!started || playback.d <= 0 || request.isLive) return
        if (!force && now() - lastSaved < 30_000) return
        lastSaved = now()
        val req = request; val position = playback.t; val duration = playback.d
        AppModel.scope.launch { AppModel.saveProgress(req.title, req.season, req.episode, position, duration) }
    }

    companion object {
        fun matches(track: MediaTrack, code: String): Boolean {
            val language = track.language.lowercase()
            if (language == code || language.startsWith("$code-") || (language.length == 3 && language.startsWith(code))) return true
            return track.label.lowercase().contains(PlaybackPrefs.languageName(code).lowercase())
        }

        // "14. Korean" → "Korean"
        fun displayName(track: MediaTrack): String {
            val label = track.label.replace(Regex("^\\d+\\.\\s*"), "")
            if (label.isNotEmpty()) return label
            if (track.language.isNotEmpty()) return PlaybackPrefs.languageName(track.language.take(2))
            return "Track ${track.index + 1}"
        }
    }
}
