package com.binge.tv.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.FrameLayout
import com.binge.tv.data.AppModel
import com.binge.tv.data.MediaKind
import com.binge.tv.data.QualityPreference
import com.binge.tv.data.Tmdb
import com.binge.tv.data.TmdbDetails
import com.binge.tv.data.TmdbSeason
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Startup time varies wildly by server and title, so instead of trying
// servers one at a time, load several at once (muted) and keep the first
// whose video actually plays. The rest are torn down immediately.
//
// A race can run "warm" in the background (title page open, a Continue
// Watching card focused, the next episode): the winner holds on its first
// frame, buffered, so pressing Play is instant.
class StreamRace(
    context: Context,
    val request: PlayRequest,
    servers: List<StreamServer>,
    mode: Mode,
    // Multiview tiles decide their own sound; the winner stays muted.
    val keepMuted: Boolean = false,
) {
    enum class Mode { WARM, LIVE }

    class Candidate(val server: StreamServer, val web: WebEngine, val url: String)

    val container = FrameLayout(context).apply { setBackgroundColor(android.graphics.Color.BLACK) }
    var mode = mode
        private set
    var candidates: List<Candidate> = emptyList()
        private set
    var winner: Candidate? = null
        private set
    var failed = false
        private set
    val startedAt = System.currentTimeMillis()
    var onChange: (() -> Unit)? = null
    // The real runtime (TMDB): a stream whose length is clearly different is the wrong video.
    var expectedDuration: Double? = null
    var rejected = emptySet<String>()
        private set
    // Set by the player when the viewer pauses, so a sharper stream never "un-pauses" them.
    var userPaused = false

    private val handler = Handler(Looper.getMainLooper())
    private var running = true
    private var seekedToStart = false
    private var upgradeUntil: Long? = null
    private val heights = HashMap<String, Int>()
    private val times = HashMap<String, Double>()
    private val playingHeights = HashMap<String, Int>()
    private var firstPlayAt: Long? = null

    val key get() = request.key

    init {
        val tmdbId = request.title.tmdbId ?: if (request.isLive) 0 else null
        if (tmdbId == null) failed = true else {
            // A Fire TV has far less memory than a computer: at most 3 pages
            // at once (2 for live); the player keeps the rest as backups.
            val limit = if (request.isLive) MAX_LIVE else MAX_VOD
            candidates = servers.take(limit).map { server ->
                val url = server.build(tmdbId, request.title.kind, request.season ?: 1, request.episode ?: 1)
                val web = WebEngine(context, WebEngine.hostOf(url))
                web.view.alpha = 0f
                container.addView(web.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                web.load(url)
                Candidate(server, web, url)
            }
            if (candidates.isEmpty()) failed = true
        }
        loop()
    }

    private fun loop() {
        if (!running) return
        tick()
        handler.postDelayed(::loop, 300)
    }

    fun goLive() {
        mode = Mode.LIVE
        winner?.let { if (!keepMuted) it.web.send(MediaCommand.Unmute); it.web.send(MediaCommand.Play) }
        onChange?.invoke()
    }

    fun stop() {
        running = false
        handler.removeCallbacksAndMessages(null)
        candidates.forEach { it.web.destroy() }
        candidates = emptyList()
        winner = null
    }

    // Low on memory: stop shopping for a sharper live stream.
    fun trimMemory() { if (upgradeUntil != null) upgradeUntil = System.currentTimeMillis() }

    private fun tick() {
        val w = winner
        val until = upgradeUntil
        if (w != null && until != null) { upgradeTick(w, until); return }
        if (w != null) {
            // Warm: hold the winner on the start point, buffered and silent.
            if (mode == Mode.WARM) {
                w.web.send(MediaCommand.Mute)
                if (!request.isLive) w.web.send(MediaCommand.Pause)
                if (!seekedToStart && !request.isLive) {
                    seekedToStart = true
                    val saved = request.startAt ?: 0.0
                    w.web.send(MediaCommand.SeekTo(if (saved > 30) saved else 0.0))
                }
            }
            w.web.poll()
            return
        }

        // Nudge any that loaded but wait for a click, and crown the first
        // whose clock moves. "Best quality" (movies and shows) gives the
        // others 1.5s more and takes the sharpest playing.
        val shopping = !request.isLive && mode == Mode.LIVE && QualityPreference.current == QualityPreference.BEST && candidates.size > 1
        for (candidate in candidates.toList()) {
            if (winner != null) break
            val state = candidate.web.poll() ?: continue
            // Nudge a paused video to play: a loaded one directly, an empty one
            // through its player's own Play button (the bridge presses it).
            if (state.paused) candidate.web.send(MediaCommand.Play)
            val expected = expectedDuration
            if (expected != null && ExpectedRuntime.isWrong(state.d, expected)) { reject(candidate); continue }
            if (state.t <= 0.4 || state.paused) continue
            if (!shopping) { crown(candidate); break }
            playingHeights[candidate.server.id] = state.height
            if (firstPlayAt == null) firstPlayAt = System.currentTimeMillis()
            if (state.height >= 2000 || System.currentTimeMillis() - firstPlayAt!! > 1500) {
                val best = candidates.maxByOrNull { playingHeights[it.server.id] ?: -1 }
                crown(best ?: candidate)
                break
            }
        }
        if (winner == null && System.currentTimeMillis() - startedAt > (if (request.isLive) LIVE_GIVE_UP_MS else GIVE_UP_MS)) {
            if (request.isLive) candidates.forEach { SportsMemory.record(it.server.name, worked = false) }
            failed = true
            stop()
            onChange?.invoke()
        }
    }

    private fun upgradeTick(w: Candidate, until: Long) {
        val others = candidates.filter { it.server != w.server }
        if (System.currentTimeMillis() > until || others.isEmpty()) {
            others.forEach { it.web.destroy() }
            candidates = listOf(w)
            upgradeUntil = null
            return
        }
        w.web.poll()?.let { state ->
            if (state.height > 0) heights[w.server.id] = state.height
            times[w.server.id] = state.t
            if (state.paused && !state.ended && !userPaused) w.web.send(MediaCommand.Play)
        }
        for (other in others) {
            val state = other.web.poll() ?: continue
            if (state.paused && state.ready >= 2) other.web.send(MediaCommand.Play)
            heights[other.server.id] = state.height
            val current = heights[w.server.id] ?: 0
            if (current <= 0 || state.height < (current * 1.3).toInt() || state.paused || state.t <= 0.4) continue
            // Promote the sharper stream.
            if (!request.isLive) times[w.server.id]?.takeIf { it > 1 }?.let { other.web.send(MediaCommand.SeekTo(it)) }
            w.web.view.alpha = 0f
            w.web.destroy()
            candidates = candidates.filter { it.server != w.server }
            winner = other
            other.web.view.alpha = 1f
            if (!keepMuted) other.web.send(MediaCommand.Unmute)
            onChange?.invoke()
            return
        }
    }

    private fun reject(candidate: Candidate) {
        rejected = rejected + candidate.server.id
        candidate.web.destroy()
        candidates = candidates.filter { it.server != candidate.server }
        playingHeights.remove(candidate.server.id)
        if (candidates.isEmpty()) { failed = true; stop(); onChange?.invoke() }
    }

    private fun crown(candidate: Candidate) {
        winner = candidate
        if (request.isLive && mode == Mode.LIVE && !keepMuted && candidates.size > 1 && QualityPreference.current == QualityPreference.BEST) {
            upgradeUntil = System.currentTimeMillis() + 6000
        } else {
            candidates.filter { it.server != candidate.server }.forEach { it.web.destroy() }
            candidates = listOf(candidate)
        }
        candidate.web.view.alpha = 1f
        if (!request.isLive) StreamServer.rememberWorking(candidate.server, request.title)
        else SportsMemory.record(candidate.server.name, worked = true)
        if (mode == Mode.LIVE) {
            val start = request.startAt ?: 0.0
            if (start > 30 && !request.isLive) candidate.web.send(MediaCommand.SeekTo(start))
            if (!keepMuted) candidate.web.send(MediaCommand.Unmute)
        }
        onChange?.invoke()
    }

    companion object {
        const val GIVE_UP_MS = 45_000L
        // Live: a stream page that hasn't played in 20s rarely will; the player moves on to the next batch.
        const val LIVE_GIVE_UP_MS = 20_000L
        const val MAX_LIVE = 3
        const val MAX_VOD = 3
    }
}

// One background race at a time, shared by the title page, Continue
// Watching focus and Up Next. Its views sit in an invisible host inside the
// window (players won't decode otherwise).
object Warmup {
    var host: FrameLayout? = null
    var race: StreamRace? = null
        private set
    private var pendingKey: String? = null
    private var expiry: Job? = null

    fun prepare(request: PlayRequest) {
        val host = host ?: return
        if (request.title.tmdbId == null && !request.isLive) return
        // Optional work: skip when several video pages are already open.
        if (race == null && WebEngine.live >= 4) return
        val key = request.key
        if (race?.key == key || pendingKey == key) return
        cancel()
        pendingKey = key
        AppModel.scope.launch {
            val servers = if (request.isLive) request.liveStreams else ServerPlan.servers(request.title, request.title.originalLanguage)
            if (pendingKey != key) return@launch
            pendingKey = null
            val fresh = StreamRace(host.context, request, servers.ifEmpty { StreamServer.all }, StreamRace.Mode.WARM)
            AppModel.scope.launch { fresh.expectedDuration = ExpectedRuntime.seconds(request) }
            host.addView(fresh.container, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            race = fresh
            // Don't keep buffering something nobody played.
            expiry = AppModel.scope.launch { delay(180_000); if (race === fresh) cancel() }
        }
    }

    fun isWarming(key: String) = race?.key == key || pendingKey == key

    // Hands over the warm race if it matches (and hasn't given up).
    fun take(request: PlayRequest): StreamRace? {
        val r = race ?: return null
        if (r.key != request.key || r.failed) return null
        race = null
        expiry?.cancel()
        (r.container.parent as? ViewGroup)?.removeView(r.container)
        return r
    }

    fun cancel() {
        pendingKey = null
        expiry?.cancel()
        race?.let { it.stop(); (it.container.parent as? ViewGroup)?.removeView(it.container) }
        race = null
    }
}

// How long a movie or episode really is (TMDB), so a server that plays
// something else under the same id can be caught (Vidy served a 98-minute
// video for the 156-minute Demon Slayer: Infinity Castle).
object ExpectedRuntime {
    private val cache = HashMap<String, Double>()

    suspend fun seconds(request: PlayRequest): Double? {
        if (request.isLive) return null
        val tmdbId = request.title.tmdbId ?: return null
        cache[request.key]?.let { return it }
        val minutes = if (request.title.kind == MediaKind.TV && request.season != null && request.episode != null) {
            runCatching { Tmdb.get<TmdbSeason>("tv/$tmdbId/season/${request.season}") }.getOrNull()
                ?.episodes?.firstOrNull { it.episodeNumber == request.episode }?.runtime
        } else if (request.title.kind == MediaKind.MOVIE) {
            runCatching { Tmdb.get<TmdbDetails>("movie/$tmdbId") }.getOrNull()?.runtime
        } else null
        if (minutes == null || minutes <= 0) return null
        return (minutes * 60.0).also { cache[request.key] = it }
    }

    // Different cuts and credits vary a little; a different video doesn't.
    fun isWrong(duration: Double, expected: Double) = duration > 60 && expected > 0 && Math.abs(duration - expected) > maxOf(240.0, expected * 0.2)
}

// Which sports feeds play on this TV (the website's sportsServerMemory idea):
// a feed family that worked here goes first next time, one that keeps
// failing goes last. Families: "PPV", "Streamed · admin", "StreamFree".
object SportsMemory {
    fun family(label: String): String = when {
        label.startsWith("PPV") -> "PPV"
        label.startsWith("StreamFree") -> "StreamFree"
        label.startsWith("Streamed") -> "Streamed · " + (label.split(" · ").getOrNull(1)?.substringBefore(' ') ?: "")
        else -> label.substringBefore(" ·")
    }

    fun record(label: String, worked: Boolean) {
        val key = "sportsFeed.${family(label)}"
        val score = com.binge.tv.data.Prefs.int(key, 0)
        com.binge.tv.data.Prefs.set(key, (if (worked) score + 3 else score - 1).coerceIn(-9, 30))
    }

    fun score(label: String) = com.binge.tv.data.Prefs.int("sportsFeed.${family(label)}", 0)

    // Stable: feeds with equal scores keep the interleaved order.
    fun <T> rank(items: List<T>, label: (T) -> String): List<T> = items.withIndex()
        .sortedWith(compareBy({ -score(label(it.value)) }, { it.index })).map { it.value }
}
