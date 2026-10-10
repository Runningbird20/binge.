package com.binge.tv.ui

import android.content.Context
import android.view.KeyEvent as AndroidKeyEvent
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
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
    private val ctx = context

    suspend fun start(streams: Int) {
        if (stopped) return
        perTile = streams
        val servers = SportsFeed.servers(game, limit = streams)
        if (stopped) return
        if (servers.isEmpty()) { status = "No stream found"; return }
        val next = StreamRace(ctx, liveRequest(game, servers), servers, StreamRace.Mode.LIVE, keepMuted = true)
        surface.addView(next.container, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        next.onChange = { if (next.failed) status = "No stream could play" }
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
        lastStateAt = System.currentTimeMillis()
        paused = state.paused
        if (!started && state.t > 0.4 && !state.paused) started = true
        if (started && state.paused && !state.ended && !userPaused) web.send(MediaCommand.Play)
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

    DisposableEffect(tiles) { onDispose { tiles.forEach { it.stop() } } }
    BackHandler {
        if (expanded != null) expanded = null else { tiles.forEach { it.stop() }; Nav.pop() }
    }
    LaunchedEffect(tiles) {
        // Free memory for the games: no background preload while here.
        Warmup.cancel()
        runCatching { requesters[tiles.first().game.id]?.requestFocus() }
        // A Fire TV decodes every stream on screen: tiles start one after another with few contenders.
        val perTile = if (tiles.size >= 3) 1 else 2
        tiles.forEachIndexed { index, tile ->
            if (index > 0) delay(1500)
            launch { tile.start(perTile) }
        }
    }
    // Silence the others first; a moment later give the focused tile sound.
    LaunchedEffect(focused) {
        tiles.forEach { if (it.game.id != focused) it.audible = false }
        delay(150)
        tiles.firstOrNull { it.game.id == focused }?.audible = true
    }

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
                        if (event.type != KeyEventType.KeyUp) return@onKeyEvent false
                        when (event.key.nativeKeyCode) {
                            AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER -> {
                                when {
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
                if (!tile.started) Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Spinner(22.dp)
                    Text(tile.status, style = Type.callout.copy(fontWeight = FontWeight.SemiBold))
                }
                if (showFocus || !tile.started) Row(
                    Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f))))
                        .padding(horizontal = 10.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(6.dp).background(Palette.live, CircleShape))
                    Text(tile.game.title, style = Type.callout.copy(fontWeight = FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (tile.paused && tile.started) Icon(Icons.Rounded.Pause, null, modifier = Modifier.size(14.dp))
                    Icon(if (tile.audible) Icons.AutoMirrored.Rounded.VolumeUp else Icons.AutoMirrored.Rounded.VolumeOff, null,
                        tint = if (tile.audible) Palette.gold else Palette.muted, modifier = Modifier.size(14.dp))
                }
            }
        }
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
