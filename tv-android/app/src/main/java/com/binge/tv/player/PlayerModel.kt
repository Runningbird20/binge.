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
import com.binge.tv.data.Binge
import com.binge.tv.data.CrashReporter
import com.binge.tv.data.DisplayMatch
import com.binge.tv.data.IntroSkips
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
import com.binge.tv.data.SubtitleSync
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
    // Remembered / shared timing (SubtitleSync) for the file and server on now.
    private var syncKey: SubtitleSync.Key? = null
    private var syncPending = false
    private var offsetChangedAt = 0L

    val surface = FrameLayout(context).apply { setBackgroundColor(android.graphics.Color.BLACK) }
    private val handler = Handler(Looper.getMainLooper())
    private var race: StreamRace? = null
    private val web: Engine? get() = race?.winner?.web
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
    var handPicked = false
        private set
    // Playing in the native player (no page: "Picture" doesn't apply).
    val isNative get() = (race?.winner?.web as? HybridEngine)?.isNative == true
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
    private var subsNoticeShown = false

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

    // The line to draw now: our file, else the server's own track. Refreshed
    // 10 times a second from the video's clock estimated between the page's
    // reports (every 0.25s), so lines appear on time; shifted by the viewer's
    // offset (+ = later: the line shown is the one for time - offset).
    var subtitleText by mutableStateOf(""); private set
    private fun refreshSubtitle() {
        val file = external
        val line = when {
            useExternal && file != null -> {
                val moving = started && !playback.paused && !playback.cushion
                val clock = playback.t + if (moving) minOf(1.0, (now() - stateAt) / 1000.0) else 0.0
                file.text(clock - subtitleOffset)
            }
            useExternal && externalLoading -> ""
            else -> playback.cue
        }
        if (line != subtitleText) subtitleText = line
    }
    private val subtitleTicker = object : Runnable {
        override fun run() { if (closed) return; refreshSubtitle(); handler.postDelayed(this, 100) }
    }
    // Any subtitles on screen (ours or the server's): timing can be adjusted.
    val subtitlesShowing get() = usingExternalSubtitles || textTracks.any { it.on }
    val usingExternalSubtitles get() = useExternal && external != null

    init {
        Perf.start("player ${initial.key}")
        Warmup.playingKey = initial.key
        val warm = Warmup.take(initial)
        Perf.mark(if (warm != null) "took warm race (winner=${warm.winner?.server?.name})" else "no warm race")
        // A preload for something else would compete with this video for the CPU.
        if (warm == null) Warmup.cancel()
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

    private var tickerStarted = false
    private fun loop() {
        if (closed) return
        if (!tickerStarted) { tickerStarted = true; handler.post(subtitleTicker) }
        tick()
        handler.postDelayed(::loop, 250)
    }

    // MARK: Races

    private fun startPlannedRace() {
        val planned = request
        racingNames = ""
        AppModel.scope.launch {
            val list = ServerPlan.servers(planned.title, planned.title.originalLanguage)
            Perf.mark("server plan ${list.joinToString { it.name }}")
            if (planned.key != request.key || closed) return@launch
            startRace(list.ifEmpty { StreamServer.all })
        }
    }

    private fun startRace(list: List<StreamServer>) {
        val ordered = list.filter { it.id !in raced } + list.filter { it.id in raced }
        adopt(StreamRace(context, request, ordered, StreamRace.Mode.LIVE))
    }

    private fun adopt(next: StreamRace) {
        if (backup != null && backup !== next) dropBackup()
        Warmup.playingKey = next.key
        raced.addAll(next.candidates.map { it.server.id })
        val req = request
        AppModel.scope.launch {
            val seconds = ExpectedRuntime.seconds(req)
            if (req.key != request.key) return@launch
            expected = seconds
            next.expectedDuration = seconds
            if (com.binge.tv.BuildConfig.DEBUG) android.util.Log.d("binge", "expected runtime ${seconds}s for ${req.key}")
        }
        race?.let { it.stop(); surface.removeView(it.container) }
        race = next
        if (next.container.parent !== surface) {
            (next.container.parent as? ViewGroup)?.removeView(next.container)
            surface.addView(next.container, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        } else next.container.bringToFront()
        next.onChange = { raceChanged() }
        racingNames = next.candidates.joinToString(", ") { it.server.name }
        if (next.winner == null) server = null // the corner shows the new server once one plays
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
            resolveSubtitleSync()
        } else if (r.failed) {
            // Nothing in this race played, but there are untried servers.
            if (!handPicked && recoveries < 3 && servers.any { it.id !in raced }) {
                recoveries++
                notice = "Trying more servers…"
                startRace(servers)
                return
            }
            notice = "No server could play this right now. Press ▼ to try one again."
            // The admin panel hears about it (once a day per episode).
            val key = "reported.${request.key}"
            if (System.currentTimeMillis() - (Prefs.string(key)?.toLongOrNull() ?: 0L) > 86_400_000L) {
                Prefs.set(key, "${System.currentTimeMillis()}")
                CrashReporter.report("Fire TV: no server could play ${request.title.name}${episodeLabel?.let { " $it" } ?: ""}", "Raced: ${raced.sorted().joinToString()}", "fire-tv/player")
            }
        }
    }

    fun close() {
        if (closed) return
        saveProgress(force = true)
        syncKey?.let { if (syncPending) SubtitleSync.report(it, subtitleOffset) }
        closed = true
        handler.removeCallbacksAndMessages(null)
        dropBackup()
        DisplayMatch.clear()
        // Kept paused for a few minutes: going back in resumes at once. On a
        // stick only a native stream (a server page is too heavy to keep).
        val current = race
        if (current != null && current.winner != null && started && !playback.ended && (isNative || !com.binge.tv.data.Performance.light)) Warmup.park(current)
        else current?.stop()
        race = null
        dropSwitch()
        Warmup.cancel()
        Warmup.playingKey = null
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

    fun nudgeSubtitles(by: Double) {
        subtitleOffset = Math.round((subtitleOffset + by).coerceIn(-30.0, 30.0) * 10) / 10.0
        web?.send(MediaCommand.CueShift(subtitleOffset))
        syncKey?.let {
            SubtitleSync.remember(context, it, subtitleOffset)
            syncPending = true
            offsetChangedAt = now()
        }
        refreshSubtitle()
        showHUD()
    }

    // The file and server are both known: start from the timing you (or
    // other viewers) settled on for them.
    private fun resolveSubtitleSync() {
        val file = external ?: return
        val current = server ?: return
        if (request.isLive || !useExternal) return
        val key = SubtitleSync.Key(request.title.kind, request.title.dbId, request.season ?: 0, request.episode ?: 0,
            subtitleLanguage, file.release ?: "version-${file.version}", if ("://" in current.id) current.name else current.id)
        if (key == syncKey) return
        syncKey?.let { if (syncPending) SubtitleSync.report(it, subtitleOffset) }
        syncKey = key
        syncPending = false
        subtitleOffset = 0.0
        web?.send(MediaCommand.CueShift(0.0))
        AppModel.scope.launch {
            val found = SubtitleSync.start(context, key) ?: return@launch
            if (syncKey != key || subtitleOffset != 0.0) return@launch
            subtitleOffset = found.first
            web?.send(MediaCommand.CueShift(subtitleOffset))
            refreshSubtitle()
            if (found.first == 0.0 || found.second == SubtitleSync.Source.MINE) return@launch
            notice = "Subtitles shifted %+.1fs to match".format(found.first) +
                (if (found.second == SubtitleSync.Source.VIEWERS) ", as other viewers set them." else ", as on your last episode.") +
                " Change it in Options › Subtitle timing."
            showHUD()
        }
    }

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
        syncKey?.let { if (syncPending) SubtitleSync.report(it, subtitleOffset) }
        syncPending = false
        syncKey = null
        subtitleOffset = 0.0
        web?.send(MediaCommand.CueShift(0.0))
        val language = subtitleLanguage
        AppModel.scope.launch {
            val file = ExternalSubtitles.load(req.title, req.season, req.episode, language, version)
            if (externalKey != key) return@launch
            externalLoading = false
            external = file
            if (file != null && useExternal) web?.send(MediaCommand.TextTrack(-1))
            resolveSubtitleSync()
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
    private fun applyPreferredTracks(web: Engine) {
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
    private fun fixEmptySubtitles(state: MediaState, web: Engine) {
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
    fun skipIntro(automatic: Boolean = false) {
        if (!automatic && isEpisode) {
            val s = request.season; val e = request.episode
            if (s != null && e != null && IntroSkips.shouldOffer(request.title, IntroSkips.recordManual(request.title, s, e)))
                notice = "Skip intros on ${request.title.name} automatically? Turn it on in Options (press ▼)."
        }
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

    // A hand-picked server plays alone, from where you were. While something
    // is playing it keeps playing: the new server loads hidden (a warm race)
    // and takes over at the current second once it plays; if it can't, you
    // stay where you were.
    private var switching: StreamRace? = null

    fun choose(next: StreamServer) {
        saveProgress(force = true)
        notice = null
        handPicked = true
        dropSwitch()
        // Already playing on it: nothing to do.
        if (started && next == server && race?.winner != null) { notice = null; return }
        if (!started || race?.winner == null) {
            if (playback.t > 5 && !request.isLive) request = request.copy(startAt = playback.t)
            startRace(listOf(next))
            return
        }
        val at = playback.t
        val pending = StreamRace(context, if (!request.isLive && at > 5) request.copy(startAt = at) else request, listOf(next), StreamRace.Mode.WARM)
        // Behind the current video, in the player itself: handing over then
        // never moves a video surface (a MediaTek decoder fails when it does).
        surface.addView(pending.container, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        switching = pending
        raced.add(next.id)
        notice = "Switching to ${next.name}… keep watching"
        showHUD()
    }

    private fun dropSwitch() {
        switching?.let { it.stop(); (it.container.parent as? ViewGroup)?.removeView(it.container) }
        switching = null
    }

    private fun checkSwitch() {
        val pending = switching ?: return
        val winner = pending.winner
        if (winner != null) {
            switching = null
            if (!request.isLive && playback.t > 1) winner.web.send(MediaCommand.SeekTo(playback.t))
            adopt(pending)
        } else if (pending.failed) {
            val name = pending.candidates.firstOrNull()?.server?.name ?: "That server"
            dropSwitch()
            notice = "$name didn't play. Still on ${server?.name ?: "this server"}."
            showHUD()
        }
    }

    fun play(season: Int, episode: Int, automatic: Boolean = false) {
        saveProgress(force = true)
        autoAdvances = if (automatic) autoAdvances + 1 else 0
        skippedIntro = false; markedWatched = false; showSkipIntro = false; subsNoticeShown = false
        request = request.copy(season = season, episode = episode, startAt = null)
        dropSwitch()
        upNextCountdown = null
        openedAt = now(); recoveries = 0; handPicked = false; raced.clear()
        markers = EpisodeMarkers(); introSeekFrom = null; ownIntroSkip = false
        loadMarkers()
        external = null
        loadExternalSubtitles()
        val warm = Warmup.take(request)
        if (warm == null) Warmup.cancel()
        if (warm != null) adopt(warm) else {
            // The last episode must stop now: planning the next race takes a
            // moment, and meanwhile it would keep playing (and be heard) and
            // its state would be read as the new episode's.
            race?.let { it.stop(); surface.removeView(it.container) }
            race = null
            started = false
            playback = MediaState()
            startPlannedRace()
        }
    }

    // MARK: Polling

    private fun tick() {
        checkSwitch()
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
        // Never give up a working video for subtitles (the other servers may
        // not have the episode at all): say so, and ▼ lets you try another.
        if (now() - since > 8000 && !subsNoticeShown) {
            subsNoticeShown = true
            notice = "No ${PlaybackPrefs.languageName(wanted)} subtitles found for this episode. Press ▼ to try another server."
            showHUD()
        }
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
        buffering = stuck > 1500 || state.cushion
        // A backup stream is ready: switch to it now rather than wait.
        if (!request.isLive && stuck > 2000 && backup?.winner != null) { switchToBackup(); return }
        if (stuck > (if (request.isLive) 12_000 else 20_000)) recover("stopped playing")
    }

    private fun recover(reason: String) {
        if (com.binge.tv.BuildConfig.DEBUG) android.util.Log.d("binge", "recover: ${server?.name} $reason")
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

    private fun apply(state: MediaState, w: Engine) {
        playback = state
        // A shift left alone for 20s of playing is the viewer's answer: shared.
        syncKey?.let { if (syncPending && !state.paused && now() - offsetChangedAt > 20_000) { syncPending = false; SubtitleSync.report(it, subtitleOffset) } }
        watchClock(state)
        watchBuffer(state)
        // The TV follows the video's frame rate (native player only).
        if (started && !displayMatched && state.native && state.fps > 0f) { displayMatched = true; DisplayMatch.request(state.fps) }
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
        if (started && state.paused && !state.ended && !userPaused && !state.cushion && now() - lastResume > 2000) { lastResume = now(); w.send(MediaCommand.Play) }
        if (!started && state.isPlaying) {
            started = true
            Perf.mark("picture on screen")
            // Live: build a few seconds of buffer before settling in (a little behind live, far fewer stalls).
            if (request.isLive) w.send(MediaCommand.CushionStart)
        }

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
            // Kept on a new server too (the shift lives in its page).
            w.send(MediaCommand.CueShift(subtitleOffset))
        }

        val intro = markers.intro
        // Binge mode, or this show set to skip intros: only a known intro.
        if (intro != null && isEpisode && started && !skippedIntro && !state.paused && state.t >= intro.start - 0.5 && state.t < intro.end - 2 &&
            (Binge.on || IntroSkips.isOn(request.title))) {
            skipIntro(automatic = true)
            notice = "Skipped the intro."
            showHUD()
        }
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
            Warmup.prepare(PlayRequest(request.title, next.first, next.second, seasons = request.seasons), fromPlayer = true)
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
            // Binge mode: straight on to the next episode (unless Up Next was dismissed).
            if (Binge.on && upNextCountdown != -1) { playNext(automatic = true); return }
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

    // MARK: Backup stream (movies and episodes)

    // Live games already keep a standby. A movie or episode gets one only
    // when needed: the buffer has been draining (or the picture froze), so
    // the next-best server loads silently at this second and takes over the
    // moment the picture stops. Closed again after a minute of full buffer.
    // One page at most, and only with room (a stick's memory is short).
    private var backup: StreamRace? = null
    private val aheadSamples = ArrayDeque<Pair<Long, Double>>()
    private var backupStartedAt = 0L
    private var smoothSince: Long? = null
    private var displayMatched = false

    val backupStatus: String? get() {
        val b = backup ?: return null
        return b.winner?.let { "A backup stream (${it.server.name}) is ready in case this one stalls." } ?: "Loading a backup stream in case this one stalls…"
    }

    val playbackDiagnosis: String get() {
        val p = playback
        return when {
            !started -> "Starting…"
            p.native && p.bandwidth > 0 && p.bitrate > 0 && p.bandwidth < p.bitrate * 1.2 -> "Downloads are only just keeping up with this stream. If it buffers, try another server; if every server does, it's the connection."
            p.stalls > 0 || buffering -> "This stream has stalled. A backup stream takes over if it keeps happening."
            !p.native -> "This server plays in its own page, which shares fewer details."
            else -> "Playing smoothly."
        }
    }

    private fun watchBuffer(state: MediaState) {
        if (!started || request.isLive || handPicked || userPaused || state.paused) { aheadSamples.clear(); return }
        val t = now()
        aheadSamples.addLast(t to state.ahead)
        while (aheadSamples.isNotEmpty() && t - aheadSamples.first().first > 20_000) aheadSamples.removeFirst()
        if (backup == null) {
            val first = aheadSamples.firstOrNull()
            val draining = state.ahead > 0 && state.ahead < 10 && first != null && first.second - state.ahead > 3 && t - first.first > 12_000
            if ((draining || buffering) && t - backupStartedAt > 60_000) startBackup()
        } else {
            smoothSince = if (state.ahead > 30) smoothSince ?: t else null
            smoothSince?.let { if (t - it > 60_000) dropBackup() }
        }
    }

    private fun startBackup() {
        val current = server
        val others = servers.filter { it != current && it.id !in (race?.rejected ?: emptySet()) }
        if (others.isEmpty() || WebEngine.live + NativeEngine.live >= 3) return
        val held = request.copy(startAt = playback.t + 2)
        val next = StreamRace(context, held, others.take(1), StreamRace.Mode.WARM)
        next.expectedDuration = expected
        surface.addView(next.container, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        backup = next
        backupStartedAt = now()
        smoothSince = null
    }

    private fun switchToBackup() {
        val next = backup ?: return
        val winner = next.winner ?: return
        val at = playback.t
        val from = server?.name ?: "The server"
        backup = null
        saveProgress(force = true)
        if (at > 1) request = request.copy(startAt = at)
        adopt(next)
        if (at > 1) winner.web.send(MediaCommand.SeekTo(at))
        notice = "$from slowed down. Switched to ${winner.server.name} to keep playing."
    }

    private fun dropBackup() {
        backup?.let { it.stop(); surface.removeView(it.container) }
        backup = null
        smoothSince = null
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
            if (track.language.isNotEmpty() && track.language != "und") return PlaybackPrefs.languageName(track.language.take(2))
            // Unlabeled (most native streams): the first is the film's own audio.
            return if (track.index == 0) "Original audio" else "Track ${track.index + 1}"
        }
    }
}
