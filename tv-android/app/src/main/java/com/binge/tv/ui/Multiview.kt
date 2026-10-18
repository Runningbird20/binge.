package com.binge.tv.ui

import android.content.Context
import android.view.KeyEvent as AndroidKeyEvent
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.material.icons.rounded.Check
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.binge.tv.data.AppModel
import com.binge.tv.data.PlaybackPrefs
import com.binge.tv.data.SportGame
import com.binge.tv.data.SportsFeed
import com.binge.tv.player.MediaCommand
import com.binge.tv.player.StreamRace
import com.binge.tv.player.Warmup
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

// One game in Multiview: its own muted race; only the focused tile has sound.
class MultiviewTile(val game: SportGame, context: Context) {
    val surface = FrameLayout(context).apply { setBackgroundColor(android.graphics.Color.BLACK) }
    var status by mutableStateOf("Finding a stream…"); private set
    var started by mutableStateOf(false); private set
    var paused by mutableStateOf(false); private set
    var audible by mutableStateOf(false)
    private var race: StreamRace? = null
    private var userPaused = false
    // Leaving Multiview stops every tile, including ones still waiting for their staggered start.
    private var stopped = false
    private var lastStateAt = System.currentTimeMillis()
    private var restarts = 0
    private var perTile = 1
    // Servers that stalled or stopped on this tile; a restart skips them.
    private val dropped = HashSet<String>()
    // Paused by the app (another game is full screen): no decoding, no auto-resume.
    private var held = false
    private var trimmed = false
    private var lastT = 0.0
    private var lastMoveAt = System.currentTimeMillis()
    private var nudged = false
    var gaveUp by mutableStateOf(false); private set
    // Decoding health: share of frames dropped over the last ~10s.
    var dropRate by mutableStateOf(0f); private set
    // Paused by Multiview because the TV couldn't decode every game smoothly.
    var throttled by mutableStateOf(false); private set
    val isHeld get() = held
    private val samples = ArrayDeque<Triple<Long, Int, Int>>()
    private var lastFrames = -1
    private var lastFramesAt = 0L
    // How long the clock has run without a new picture (decoder starved or gave up).
    var frozenMs by mutableStateOf(0L); private set
    // Waiting to start until the viewer picks it (the TV was already at its limit).
    private var deferredStreams = 0
    private var failedBatches = 0
    // The server playing (shown on the tile) and one the viewer picked by hand
    // (hold OK): a picked server is never switched away from automatically.
    var serverName by mutableStateOf<String?>(null); private set
    private var picked: com.binge.tv.player.StreamServer? = null
    val isPicked get() = picked != null
    private val ctx = context
    private val createdAt = System.currentTimeMillis()

    suspend fun start(streams: Int) {
        if (stopped) return
        perTile = streams
        val servers = picked?.let { listOf(it) }
            ?: SportsFeed.servers(game, limit = streams + dropped.size).filter { it.name !in dropped }.take(streams)
        if (stopped) return
        if (servers.isEmpty()) { status = "No stream found"; gaveUp = true; return }
        val next = StreamRace(ctx, liveRequest(game, servers), servers, StreamRace.Mode.LIVE, keepMuted = true)
        surface.addView(next.container, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        next.onChange = {
            if (next.failed) {
                // That batch failed: the next servers, a few times, before giving up.
                // A hand-picked server is left to the viewer.
                if (picked != null) { status = "${picked?.name} didn't play. Hold OK to pick another."; gaveUp = true }
                else if (failedBatches < 3) {
                    failedBatches++
                    servers.forEach { dropped += it.name }
                    status = "Trying another stream…"
                    surface.post { if (!stopped) { race?.stop(); race?.let { surface.removeView(it.container) }; race = null; AppModel.scope.launch { start(perTile) } } }
                } else { status = "No stream could play"; gaveUp = true }
            }
        }
        race = next
        lastStateAt = System.currentTimeMillis()
        loop()
    }

    private fun loop() {
        if (stopped) return
        tick()
        surface.postDelayed(::loop, 1000)
    }

    private fun tick() {
        val web = race?.winner?.web ?: return
        web.send(if (audible) MediaCommand.Unmute else MediaCommand.Mute)
        if (started) web.send(MediaCommand.Fill)
        val state = web.poll()
        if (state == null) {
            // The tile's page stopped reporting (renderer closed for memory, or the stream broke).
            if (started && System.currentTimeMillis() - lastStateAt > 10_000 && restarts < 2) restart()
            return
        }
        val now = System.currentTimeMillis()
        lastStateAt = now
        paused = state.paused
        if (!started && state.t > 0.4 && !state.paused) {
            started = true
            serverName = race?.winner?.server?.name
            startedAt = System.currentTimeMillis()
            lastT = state.t
            // Refill instead of stuttering when a tile's buffer runs dry.
            race?.winner?.web?.send(MediaCommand.CushionOn)
            if (com.binge.tv.BuildConfig.DEBUG) android.util.Log.i("binge", "multiview tile started ${game.title} in ${System.currentTimeMillis() - createdAt}ms on ${race?.winner?.server?.name}")
        }
        if (!started || held) return
        if (state.paused && !state.ended && !userPaused && !state.cushion) web.send(MediaCommand.Play)
        // Ad and tracker frames go once the game plays (memory and CPU on a Fire TV).
        if (!trimmed && now - startedAt > 8_000) { trimmed = true; web.send(MediaCommand.Trim) }
        measure(state, now)
        // A playing tile whose clock stops is buffering: jump to the live edge,
        // and if that doesn't help, move this tile to another server.
        if (state.paused || userPaused) { lastMoveAt = now; return }
        // Clock running but no new picture: Multiview decides (decoder
        // starved by the other games → pause one; alone → another server).
        frozenMs = if (lastFrames >= 0 && now - lastMoveAt < 2_000) now - lastFramesAt else 0L
        if (state.t != lastT) { lastT = state.t; lastMoveAt = now; nudged = false; return }
        val stuck = now - lastMoveAt
        if (stuck > 8_000 && !nudged) { nudged = true; web.send(MediaCommand.Edge) }
        else if (stuck > 18_000 && restarts < 3 && picked == null) { race?.winner?.server?.name?.let { dropped += it }; restart() }
    }

    private var startedAt = 0L

    private fun measure(state: com.binge.tv.player.MediaState, now: Long) {
        if (state.frames < 0) return
        if (state.frames < lastFrames) { samples.clear(); lastFrames = -1 } // a new video element
        if (state.frames > lastFrames) { lastFrames = state.frames; lastFramesAt = now }
        samples.addLast(Triple(now, state.frames, state.dropped))
        while (samples.size > 1 && now - samples.first().first > 10_000) samples.removeFirst()
        val first = samples.first()
        val decoded = state.frames - first.second
        dropRate = if (decoded > 30) (state.dropped - first.third).toFloat() / decoded else 0f
    }

    // The TV can't decode every game smoothly: this one pauses (never the one you're watching).
    fun throttle() {
        throttled = true
        frozenMs = 0
        hold()
    }

    // Not started at all: the TV was already at its limit when its turn came.
    fun defer(streams: Int) {
        deferredStreams = streams
        throttled = true
        status = "Paused to keep the others smooth"
    }

    fun unthrottle() {
        if (!throttled) return
        throttled = false
        if (deferredStreams > 0) {
            val streams = deferredStreams
            deferredStreams = 0
            status = "Finding a stream…"
            AppModel.scope.launch { start(streams) }
        } else release()
    }

    // Every server this game has, for the picker.
    suspend fun serverOptions() = SportsFeed.servers(game, limit = 12)

    // Picked by hand: this tile plays exactly that server from now on.
    fun choose(server: com.binge.tv.player.StreamServer) {
        picked = server
        dropped.clear(); restarts = 0; failedBatches = 0; gaveUp = false
        throttled = false; deferredStreams = 0; held = false
        race?.stop(); race?.let { surface.removeView(it.container) }; race = null
        started = false; trimmed = false; nudged = false; samples.clear(); lastFrames = -1; frozenMs = 0
        serverName = server.name
        status = "Switching to ${server.name}…"
        AppModel.scope.launch { start(perTile) }
    }

    // The picture froze and this is the only game playing: try another server.
    fun switchServer() {
        if (restarts >= 3 || picked != null) return
        race?.winner?.server?.name?.let { dropped += it }
        restart()
    }

    // Another game went full screen: stop decoding this one until it's back.
    fun hold() {
        if (held) return
        held = true
        race?.winner?.web?.send(MediaCommand.Pause)
    }

    fun release() {
        if (!held || throttled) return
        held = false
        lastMoveAt = System.currentTimeMillis()
        lastFramesAt = lastMoveAt
        samples.clear()
        race?.winner?.web?.send(MediaCommand.Edge)
    }

    fun togglePause() { userPaused = !paused; race?.winner?.web?.send(MediaCommand.Toggle) }

    fun stop() {
        stopped = true
        race?.stop()
        race?.let { surface.removeView(it.container) }
        race = null
    }

    private fun restart() {
        restarts++
        race?.stop(); race?.let { surface.removeView(it.container) }; race = null
        started = false
        trimmed = false
        nudged = false
        samples.clear()
        lastFrames = -1
        frozenMs = 0
        status = "Reconnecting…"
        AppModel.scope.launch { start(perTile) }
    }
}

@Composable
fun MultiviewScreen(games: List<SportGame>) {
    val context = LocalContext.current
    val tiles = remember(games) { games.take(4).map { MultiviewTile(it, context) } }
    var expanded by remember { mutableStateOf<String?>(null) }
    var main by remember { mutableStateOf<String?>(null) }
    var focused by remember { mutableStateOf<String?>(null) }
    val requesters = remember(tiles) { tiles.associate { it.game.id to FocusRequester() } }
    val mainLayout = PlaybackPrefs.multiviewLayout == "main" && tiles.size in 2..3
    val mainId = main ?: tiles.firstOrNull()?.game?.id
    // Set once this TV has shown it can't decode every game smoothly.
    var overloaded by remember { mutableStateOf(false) }
    // Server picker for one game (hold OK on its tile, or the ≡ button).
    var pickerFor by remember { mutableStateOf<MultiviewTile?>(null) }
    var longPress by remember { mutableStateOf(false) }
    var lastLoadAction by remember { mutableStateOf(0L) }

    DisposableEffect(tiles) { onDispose { tiles.forEach { it.stop() } } }
    BackHandler {
        if (expanded != null) expanded = null else { tiles.forEach { it.stop() }; Nav.pop() }
    }
    LaunchedEffect(tiles) {
        // Free memory for the games: no background preload while here.
        Warmup.cancel()
        runCatching { requesters[tiles.first().game.id]?.requestFocus() }
        // A Fire TV decodes every stream on screen: tiles start one after
        // another with few contenders. The next tile starts as soon as the
        // one before it plays (its page load is the heavy part), or after 3s.
        val perTile = if (tiles.size >= 3) 1 else 2
        tiles.forEachIndexed { index, tile ->
            if (index > 0) {
                val previous = tiles[index - 1]
                withTimeoutOrNull(3_000) { while (!previous.started && !previous.gaveUp && !previous.throttled) delay(150) }
            }
            // Already at this TV's limit (seen now, or learned before): the rest wait until picked.
            val smooth = PlaybackPrefs.multiviewMode != "all"
            if (smooth && (overloaded || index >= MultiviewCapacity.games)) tile.defer(perTile) else launch { tile.start(perTile) }
        }
    }
    // Full screen: only that game is decoded; the others pause and rejoin
    // at the live edge when the grid comes back.
    LaunchedEffect(expanded) {
        tiles.forEach { if (expanded != null && it.game.id != expanded) it.hold() else it.release() }
    }
    // A TV that can't decode every game (frames dropping) pauses one at a
    // time, worst first, never the one being watched. Fire TV models differ
    // a lot, so this is measured rather than a fixed limit.
    LaunchedEffect(tiles) {
        while (true) {
            delay(2_000)
            if (expanded != null) continue
            val playing = tiles.filter { it.started && !it.isHeld }
            // "All games": never pause one; a frozen picture alone still tries another server.
            if (PlaybackPrefs.multiviewMode == "all") { if (playing.size == 1) playing.firstOrNull { it.frozenMs > 8_000 }?.switchServer(); continue }
            val now = System.currentTimeMillis()
            // A frozen picture: with other games on, the decoder is starved
            // (pause it); alone, the stream itself is bad (another server).
            val frozen = playing.firstOrNull { it.frozenMs > 8_000 }
            if (frozen != null) {
                if (playing.size > 1 && frozen.game.id != focused) {
                    if (com.binge.tv.BuildConfig.DEBUG) android.util.Log.i("binge", "multiview frozen picture: pausing ${frozen.game.title}")
                    frozen.throttle(); overloaded = true; lastLoadAction = now
                    MultiviewCapacity.lower(playing.size - 1)
                } else if (playing.size == 1) frozen.switchServer()
                continue
            }
            // Smooth for a minute with more games than we thought it could take: remember that.
            if (playing.size > MultiviewCapacity.games && now - lastLoadAction > 60_000 && playing.all { it.dropRate < 0.45f }) MultiviewCapacity.raise(playing.size)
            if (playing.size < 2 || now - lastLoadAction < 15_000) continue
            // A Fire TV drops ~20% of a 60fps stream even alone, so choppy
            // side tiles are fine (they're previews). Act when the game being
            // watched suffers, or a side tile is a slideshow.
            val main = playing.firstOrNull { it.game.id == focused }
            val others = playing.filter { it.game.id != focused }
            val slideshow = others.filter { it.dropRate > 0.6f }.maxByOrNull { it.dropRate }
            val victim = slideshow ?: if ((main?.dropRate ?: 0f) > 0.45f)
                others.maxWithOrNull(compareBy<MultiviewTile> { it.dropRate }.thenBy { tiles.indexOf(it) }) else null
            if (victim == null) continue
            if (com.binge.tv.BuildConfig.DEBUG) android.util.Log.i("binge", "multiview overloaded ${playing.map { "%.2f".format(it.dropRate) }}: pausing ${victim.game.title}")
            victim.throttle()
            overloaded = true
            lastLoadAction = now
            MultiviewCapacity.lower(playing.size - 1)
        }
    }
    // Silence the others first; a moment later give the focused tile sound.
    LaunchedEffect(focused) {
        tiles.forEach { if (it.game.id != focused) it.audible = false }
        delay(150)
        tiles.firstOrNull { it.game.id == focused }?.audible = true
    }

    pickerFor?.let { ServerPicker(it) { pickerFor = null } }
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val frames = layout(tiles.map { it.game.id }, maxWidth, maxHeight, expanded, if (mainLayout) mainId else null)
        tiles.forEach { tile ->
            val frame = frames[tile.game.id] ?: return@forEach
            val hidden = expanded != null && expanded != tile.game.id
            val x by animateDpAsState(frame.first.x, label = "x"); val y by animateDpAsState(frame.first.y, label = "y")
            val w by animateDpAsState(frame.second.width, label = "w"); val h by animateDpAsState(frame.second.height, label = "h")
            val isFocused = focused == tile.game.id
            val showFocus = expanded == null
            Box(
                Modifier.offset(x, y).size(w, h).alpha(if (hidden) 0.01f else 1f)
                    .clip(RoundedCornerShape(if (showFocus) 8.dp else 0.dp))
                    .then(if (isFocused && showFocus) Modifier.border(3.dp, Palette.gold, RoundedCornerShape(8.dp)) else Modifier)
                    .focusRequester(requesters.getValue(tile.game.id))
                    .onFocusChanged { if (it.isFocused) focused = tile.game.id }
                    .focusable(enabled = !hidden)
                    .onKeyEvent { event ->
                        // Back: full screen → grid → leave (handled here; the tile's key
                        // handling otherwise kept Back from reaching the app).
                        if (event.key.nativeKeyCode == AndroidKeyEvent.KEYCODE_BACK) {
                            if (event.type == KeyEventType.KeyUp) {
                                if (expanded != null) expanded = null else { tiles.forEach { it.stop() }; Nav.pop() }
                            }
                            return@onKeyEvent true
                        }
                        val code = event.key.nativeKeyCode
                        val isOk = code == AndroidKeyEvent.KEYCODE_DPAD_CENTER || code == AndroidKeyEvent.KEYCODE_ENTER
                        // Hold OK (or ≡): this game's servers.
                        if (isOk && event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 1) {
                            longPress = true; pickerFor = tile; return@onKeyEvent true
                        }
                        if (isOk && event.type == KeyEventType.KeyUp && longPress) { longPress = false; return@onKeyEvent true }
                        if (code == AndroidKeyEvent.KEYCODE_MENU && event.type == KeyEventType.KeyUp) { pickerFor = tile; return@onKeyEvent true }
                        if (event.type != KeyEventType.KeyUp) return@onKeyEvent false
                        when (event.key.nativeKeyCode) {
                            AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER -> {
                                when {
                                    tile.throttled -> { tile.unthrottle(); lastLoadAction = System.currentTimeMillis() }
                                    expanded != null -> expanded = null
                                    mainLayout && tile.game.id != mainId -> main = tile.game.id // a small game: make it the big one
                                    else -> expanded = tile.game.id
                                }
                                true
                            }
                            AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { tile.togglePause(); true }
                            else -> false
                        }
                    },
            ) {
                AndroidView(factory = { tile.surface }, modifier = Modifier.fillMaxSize())
                if (!tile.started && !tile.throttled) Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!tile.gaveUp) Spinner(22.dp)
                    Text(tile.status, style = Type.callout.copy(fontWeight = FontWeight.SemiBold))
                }
                if (tile.throttled) Column(
                    Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.72f)).padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
                ) {
                    Icon(Icons.Rounded.Pause, null, modifier = Modifier.size(26.dp))
                    Text("Paused to keep the others smooth", style = Type.callout.copy(fontWeight = FontWeight.SemiBold))
                    Text("Press OK to watch this game", style = Type.caption, color = Palette.muted)
                }
                if (showFocus || !tile.started) Row(
                    Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f))))
                        .padding(horizontal = 10.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(6.dp).background(Palette.live, CircleShape))
                    Text(tile.game.title, style = Type.callout.copy(fontWeight = FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    // The server playing; on the focused tile, how to change it.
                    tile.serverName?.let { Text(if (isFocused && expanded == null) "$it · hold OK to change" else it, style = Type.caption, color = Palette.muted, maxLines = 1) }
                    if (tile.paused && tile.started) Icon(Icons.Rounded.Pause, null, modifier = Modifier.size(14.dp))
                    Icon(if (tile.audible) Icons.AutoMirrored.Rounded.VolumeUp else Icons.AutoMirrored.Rounded.VolumeOff, null,
                        tint = if (tile.audible) Palette.gold else Palette.muted, modifier = Modifier.size(14.dp))
                }
            }
        }
    }
}

@Composable
private fun ServerPicker(tile: MultiviewTile, onDismiss: () -> Unit) {
    var options by remember(tile) { mutableStateOf<List<com.binge.tv.player.StreamServer>?>(null) }
    LaunchedEffect(tile) { options = runCatching { tile.serverOptions() }.getOrDefault(emptyList()) }
    ActionSheet("Server for ${tile.game.title}", onDismiss) {
        val list = options
        when {
            list == null -> Spinner(22.dp)
            list.isEmpty() -> Text("No servers found for this game right now.", style = Type.callout, color = Palette.muted)
            else -> Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                list.forEach { server ->
                    val current = server.name == tile.serverName
                    Pill(server.name, selected = current, icon = if (current) Icons.Rounded.Check else null) { tile.choose(server); onDismiss() }
                }
            }
        }
        Text("A picked server stays until you pick another.", style = Type.caption, color = Palette.muted)
    }
}

// Layout 1 (default): equal 16:9 tiles, two per row. Layout 2 ("main"): with
// 2–3 games one is big on the left and the rest stack on the right.
// Expanded: one game full screen.
private fun layout(ids: List<String>, width: Dp, height: Dp, expanded: String?, mainId: String?): Map<String, Pair<DpOffset, DpSize>> {
    val frames = HashMap<String, Pair<DpOffset, DpSize>>()
    if (expanded != null) {
        ids.forEach { frames[it] = if (it == expanded) DpOffset(0.dp, 0.dp) to DpSize(width, height) else DpOffset(0.dp, 0.dp) to DpSize(8.dp, 5.dp) }
        return frames
    }
    val gap = 8.dp
    if (ids.size == 1) { frames[ids[0]] = DpOffset(0.dp, 0.dp) to DpSize(width, height); return frames }
    if (mainId != null && ids.size in 2..3) {
        val others = ids.filter { it != mainId }
        val rows = others.size.toFloat()
        val sideW = minOf(width * (if (others.size == 1) 0.27f else 0.3f), ((height - gap * (rows + 1)) / rows) * 16f / 9f)
        val sideH = sideW * 9f / 16f
        val bigW = minOf(width - sideW - gap * 3, (height - gap * 2) * 16f / 9f)
        val bigH = bigW * 9f / 16f
        val left = (width - (bigW + gap + sideW)) / 2
        frames[mainId] = DpOffset(left, (height - bigH) / 2) to DpSize(bigW, bigH)
        var y = (height - (sideH * rows + gap * (rows - 1))) / 2
        others.forEach { frames[it] = DpOffset(left + bigW + gap, y) to DpSize(sideW, sideH); y += sideH + gap }
        return frames
    }
    val rows = if (ids.size <= 2) 1 else 2
    val cellW0 = (width - gap * 3) / 2
    val cellH = minOf(cellW0 * 9f / 16f, (height - gap * (rows + 1)) / rows)
    val cellW = cellH * 16f / 9f
    val top = (height - (cellH * rows + gap * (rows - 1))) / 2
    ids.forEachIndexed { index, id ->
        val row = index / 2; val col = index % 2
        val inRow = minOf(2, ids.size - row * 2)
        val left = (width - (cellW * inRow + gap * (inRow - 1))) / 2
        frames[id] = DpOffset(left + (cellW + gap) * col, top + (cellH + gap) * row) to DpSize(cellW, cellH)
    }
    return frames
}

// How many games this TV decodes smoothly at once, learned from Multiview
// sessions (Fire TV models differ: a 4K Max handles about two 60fps games).
object MultiviewCapacity {
    private const val KEY = "multiviewCapacity"
    val games get() = com.binge.tv.data.Prefs.int(KEY, 4).coerceIn(1, 4)
    fun lower(to: Int) { if (to in 1 until games) com.binge.tv.data.Prefs.set(KEY, to) }
    fun raise(to: Int) { if (to > games) com.binge.tv.data.Prefs.set(KEY, to.coerceAtMost(4)) }
}
