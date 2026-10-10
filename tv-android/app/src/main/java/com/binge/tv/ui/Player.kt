package com.binge.tv.ui

import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.focus.focusProperties
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.FastForward
import androidx.compose.material.icons.rounded.FastRewind
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.binge.tv.data.PlaybackPrefs
import com.binge.tv.data.Prefs
import com.binge.tv.data.QualityPreference
import com.binge.tv.data.Tmdb
import com.binge.tv.data.TmdbSeason
import com.binge.tv.player.PlayRequest
import com.binge.tv.player.PlayerModel
import com.binge.tv.player.SleepOption

// The activity tells the open player when the app leaves the screen.
object PlayerLifecycle { var current: PlayerModel? = null }

@Composable
fun PlayerScreen(request: PlayRequest) {
    val context = LocalContext.current
    val model = remember(request) { PlayerModel(context, request) }
    var panelOpen by remember { mutableStateOf(false) }
    val surfaceFocus = remember { FocusRequester() }

    DisposableEffect(model) {
        PlayerLifecycle.current = model
        onDispose { model.close(); if (PlayerLifecycle.current === model) PlayerLifecycle.current = null }
    }

    BackHandler {
        when {
            (model.upNextCountdown ?: -1) > 0 -> model.cancelUpNext()
            else -> { model.close(); Nav.pop() }
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(factory = { model.surface }, modifier = Modifier.fillMaxSize())

        // The remote's layer: invisible, holds focus while the panel is closed.
        Box(
            Modifier.fillMaxSize().focusRequester(surfaceFocus).focusable()
                .onPreviewKeyEvent { event ->
                    if (panelOpen || event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (event.key.nativeKeyCode) {
                        AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER, AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                        AndroidKeyEvent.KEYCODE_MEDIA_PLAY, AndroidKeyEvent.KEYCODE_MEDIA_PAUSE -> { model.togglePlay(); true }
                        AndroidKeyEvent.KEYCODE_DPAD_LEFT, AndroidKeyEvent.KEYCODE_MEDIA_REWIND -> { model.seek(-10.0); true }
                        AndroidKeyEvent.KEYCODE_DPAD_RIGHT, AndroidKeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { model.seek(10.0); true }
                        AndroidKeyEvent.KEYCODE_DPAD_DOWN, AndroidKeyEvent.KEYCODE_MENU -> {
                            if (model.showSkipIntro) model.dismissSkipIntro() else panelOpen = true
                            true
                        }
                        AndroidKeyEvent.KEYCODE_DPAD_UP -> { if (model.showSkipIntro) model.skipIntro() else model.showHUD(); true }
                        else -> false
                    }
                },
        )

        // Subtitles, drawn by the app (OpenSubtitles or the server's own track).
        val line = model.subtitleText
        if (model.started && line.isNotEmpty()) {
            SubtitleLine(line, Modifier.align(Alignment.BottomCenter).padding(bottom = if (model.hudVisible) 100.dp else if (model.showSkipIntro) 75.dp else 35.dp))
        }

        if (!model.started) LoadingCard(model, Modifier.align(Alignment.Center))
        else if (model.buffering) Box(Modifier.align(Alignment.Center).background(Color.Black.copy(alpha = 0.45f), CircleShape).padding(20.dp)) { Spinner(30.dp) }

        AnimatedVisibility(model.hudVisible || !model.started, enter = fadeIn(), exit = fadeOut()) { Hud(model) }

        // Bottom-right corner, out of the picture's way; ▲ skips, ▼ hides it.
        AnimatedVisibility(model.showSkipIntro, enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomEnd).padding(end = 30.dp, bottom = if (model.hudVisible) 95.dp else 25.dp)) {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(Modifier.background(Color.White, CircleShape).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.FastForward, null, tint = Color.Black, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Skip intro", style = Type.headline.copy(fontSize = 14.sp), color = Color.Black)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.KeyboardArrowUp, null, tint = Color.White.copy(alpha = 0.75f), modifier = Modifier.size(14.dp))
                    Text(" skip  ·  ", style = Type.caption.copy(fontWeight = FontWeight.Bold), color = Color.White.copy(alpha = 0.75f))
                    Icon(Icons.Rounded.KeyboardArrowDown, null, tint = Color.White.copy(alpha = 0.75f), modifier = Modifier.size(14.dp))
                    Text(" hide", style = Type.caption.copy(fontWeight = FontWeight.Bold), color = Color.White.copy(alpha = 0.75f))
                }
            }
        }

        if (model.stillWatching) Column(Modifier.align(Alignment.Center).background(Color.Black.copy(alpha = 0.8f), RoundedCornerShape(16.dp)).padding(30.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Still watching?", style = Type.hero)
            Text(model.request.title.name, style = Type.headline, color = Palette.muted)
            Text("OK to keep going · Back to stop", style = Type.callout, color = Palette.muted)
        }

        val countdown = model.upNextCountdown
        val next = model.nextEpisode
        if (countdown != null && countdown > 0 && next != null) {
            Column(Modifier.align(Alignment.BottomEnd).padding(end = Dimens.edge, bottom = 85.dp).background(Palette.surface.copy(alpha = 0.95f), RoundedCornerShape(12.dp)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Next: S${next.first}:E${next.second}", style = Type.section)
                Text("Starts in $countdown seconds", style = Type.callout)
                Text("OK to play now · Back to keep watching", style = Type.caption, color = Palette.muted)
            }
        }

        if (model.pausedAmbient) AmbientView(listOf(model.request.title) + Ambient.titles.filter { it.id != model.request.title.id },
            resumeLabel = "Resume ${model.request.title.name}", resume = { model.togglePlay(); runCatching { surfaceFocus.requestFocus() } },
            dismiss = { model.leaveAmbient(); runCatching { surfaceFocus.requestFocus() } })

        AnimatedVisibility(panelOpen, enter = androidx.compose.animation.slideInHorizontally { it / 4 } + fadeIn(), exit = androidx.compose.animation.slideOutHorizontally { it / 4 } + fadeOut()) {
            // Focus goes back to the video before the sidebar leaves (its removal would otherwise drop focus entirely).
            PlayerPanel(model) { runCatching { surfaceFocus.requestFocus() }; panelOpen = false }
        }
    }
    LaunchedEffect(panelOpen) {
        if (!panelOpen) {
            // Again once the slide-out has finished, in case focus was lost on the way.
            kotlinx.coroutines.delay(30); runCatching { surfaceFocus.requestFocus() }
            kotlinx.coroutines.delay(450); runCatching { surfaceFocus.requestFocus() }
        }
    }
}

@Composable
fun Spinner(size: Dp, color: Color = Color.White) {
    val transition = rememberInfiniteTransition(label = "spin")
    val angle by transition.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "angle")
    Canvas(Modifier.size(size).rotate(angle)) {
        drawArc(color, startAngle = 0f, sweepAngle = 270f, useCenter = false, style = Stroke(width = size.toPx() * 0.1f, cap = StrokeCap.Round))
    }
}

@Composable
private fun SubtitleLine(text: String, modifier: Modifier) {
    val bg = when (PlaybackPrefs.captionBackground) { "transparent" -> Color.Transparent; "rgba(0,0,0,1)" -> Color.Black; else -> Color.Black.copy(alpha = 0.6f) }
    Text(
        text, textAlign = TextAlign.Center, color = Color.White,
        style = Type.headline.copy(fontSize = (23f * PlaybackPrefs.captionSize / 100f).sp, fontWeight = FontWeight.SemiBold, lineHeight = (29f * PlaybackPrefs.captionSize / 100f).sp,
            shadow = if (PlaybackPrefs.captionBackground == "transparent") androidx.compose.ui.graphics.Shadow(Color.Black, Offset(0f, 1f), 6f) else null),
        modifier = modifier.widthIn(max = 750.dp).background(bg, RoundedCornerShape(4.dp)).padding(horizontal = 9.dp, vertical = 4.dp),
    )
}

@Composable
private fun Hud(model: PlayerModel) {
    val playback = model.playback
    Box(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.8f), Color.Transparent)))
            .padding(start = Dimens.edge, end = Dimens.edge, top = 24.dp, bottom = 34.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(model.request.title.name, style = Type.section.copy(fontWeight = FontWeight.Bold))
                model.episodeLabel?.let { Text(it, style = Type.callout, color = Palette.muted) }
            }
            model.resolutionLabel?.let {
                Text(it, style = Type.caption.copy(fontWeight = FontWeight.ExtraBold), modifier = Modifier.border(1.dp, Color.White.copy(alpha = 0.7f), RoundedCornerShape(3.dp)).padding(horizontal = 5.dp, vertical = 1.dp))
                Spacer(Modifier.width(10.dp))
            }
            model.server?.let { Text(it.name, style = Type.caption.copy(fontWeight = FontWeight.SemiBold), color = Palette.muted) }
        }
        if (model.started) Column(Modifier.align(Alignment.BottomStart).fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f))))
            .padding(start = Dimens.edge, end = Dimens.edge, top = 40.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            model.notice?.let { Text(it, style = Type.callout.copy(fontWeight = FontWeight.SemiBold), color = Palette.gold) }
            if (model.request.isLive) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(9.dp).background(Palette.live, CircleShape))
                    Text("LIVE", style = Type.callout.copy(fontWeight = FontWeight.ExtraBold), color = Palette.live)
                    Icon(if (playback.paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause, null, modifier = Modifier.size(18.dp))
                }
                Text("OK  Pause / play     ▼  Other streams     Back  Exit", style = Type.caption, color = Palette.muted)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(if (playback.paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause, null, modifier = Modifier.size(20.dp))
                    Text(clock(playback.t), style = Type.callout.copy(fontWeight = FontWeight.SemiBold))
                    Box(Modifier.weight(1f).height(4.dp).background(Color.White.copy(alpha = 0.25f), CircleShape)) {
                        Box(Modifier.fillMaxWidth(if (playback.d > 0) (playback.t / playback.d).toFloat().coerceIn(0f, 1f) else 0f).height(4.dp).background(Palette.gold, CircleShape))
                    }
                    Text("-" + clock(maxOf(0.0, playback.d - playback.t)), style = Type.callout.copy(fontWeight = FontWeight.SemiBold))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.FastRewind, null, tint = Palette.muted, modifier = Modifier.size(13.dp))
                    Icon(Icons.Rounded.FastForward, null, tint = Palette.muted, modifier = Modifier.size(13.dp))
                    Text("  10 seconds      ▼  Servers, audio, subtitles & episodes      Back  Exit", style = Type.caption, color = Palette.muted)
                }
            }
        }
    }
}

@Composable
private fun LoadingCard(model: PlayerModel, modifier: Modifier) {
    Column(modifier.background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(16.dp)).padding(24.dp).widthIn(max = 420.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // Nothing could play: say so plainly (no spinner, one hint).
        val gaveUp = model.notice?.startsWith("No server") == true
        if (!gaveUp) {
            Spinner(28.dp)
            Text(if (!model.request.isLive && QualityPreference.current == QualityPreference.BEST) "Finding the best-quality server…" else "Finding the fastest server…", style = Type.headline)
            if (model.racingNames.isNotEmpty()) Text("Trying ${model.racingNames} at once", style = Type.callout, color = Palette.muted, textAlign = TextAlign.Center)
        }
        model.notice?.let { Text(it, style = if (gaveUp) Type.headline else Type.callout, color = if (gaveUp) Color.White else Palette.gold, textAlign = TextAlign.Center) }
        if (!gaveUp) Text("Press ▼ to pick another server", style = Type.caption, color = Palette.muted)
    }
}

// ▼ opens a sidebar on the right (like Prime Video's): a short menu, each
// item opening its own list. The video keeps playing beside it. Back goes up
// a level, then closes; focus can't wander out of the sidebar.
private enum class Pane(val title: String) {
    MENU("Options"), AUDIO("Audio"), SUBTITLES("Subtitles"), TIMING("Subtitle timing"), SERVER("Server"),
    PICTURE("Picture"), QUALITY("Quality"), SLEEP("Sleep timer"), EPISODES("Episodes"),
}

@Composable
private fun PlayerPanel(model: PlayerModel, close: () -> Unit) {
    var pane by remember { mutableStateOf(Pane.MENU) }
    var from by remember { mutableStateOf(Pane.MENU) }
    var episodes by remember { mutableStateOf<List<TmdbSeason.Episode>>(emptyList()) }
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(model.request.season) {
        val id = model.request.title.tmdbId
        if (model.isEpisode && id != null) episodes = runCatching { Tmdb.get<TmdbSeason>("tv/$id/season/${model.request.season ?: 1}") }.getOrNull()?.episodes.orEmpty()
    }
    // Focus the selected option (or the item we came back from) whenever the list changes.
    LaunchedEffect(pane) { kotlinx.coroutines.delay(40); runCatching { firstFocus.requestFocus() } }
    androidx.activity.compose.BackHandler { if (pane == Pane.MENU) close() else { from = pane; pane = Pane.MENU } }
    fun open(next: Pane) { from = Pane.MENU; pane = next }

    val audioLabel = model.audioTracks.firstOrNull { it.on }?.let(PlayerModel::displayName) ?: if (model.audioTracks.isEmpty()) "Default" else PlayerModel.displayName(model.audioTracks[0])
    val subtitleLabel = when {
        model.useExternal && model.subtitleLanguage != "off" -> PlaybackPrefs.languageName(model.subtitleLanguage) + if (model.external == null && !model.externalLoading) " (not found)" else ""
        model.textTracks.any { it.on } -> PlayerModel.displayName(model.textTracks.first { it.on }) + " (server)"
        else -> "Off"
    }

    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.6f))))
        Column(
            Modifier.align(Alignment.CenterEnd).width(380.dp).fillMaxHeight().background(Palette.raised.copy(alpha = 0.97f))
                .focusGroup().focusProperties { exit = { FocusRequester.Cancel } }
                .padding(top = 28.dp, bottom = 18.dp),
        ) {
            Text(pane.title, style = Type.section.copy(fontWeight = FontWeight.Bold), modifier = Modifier.padding(horizontal = 22.dp))
            if (pane == Pane.MENU) Text(model.request.title.name + (model.episodeLabel?.let { " · $it" } ?: ""), style = Type.caption, color = Palette.muted,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 22.dp))
            if (pane != Pane.MENU) Text("Back to return", style = Type.caption, color = Palette.muted, modifier = Modifier.padding(horizontal = 22.dp))
            Spacer(Modifier.height(12.dp))
            LazyColumn(Modifier.fillMaxWidth().weight(1f), contentPadding = PaddingValues(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                when (pane) {
                    Pane.MENU -> {
                        val rows = buildList {
                            add(Triple(Pane.AUDIO, "Audio", audioLabel))
                            add(Triple(Pane.SUBTITLES, "Subtitles", subtitleLabel))
                            if (model.usingExternalSubtitles) add(Triple(Pane.TIMING, "Subtitle timing", if (model.subtitleOffset == 0.0) "In sync" else "%+.1fs".format(model.subtitleOffset)))
                            add(Triple(Pane.SERVER, if (model.request.isLive) "Stream" else "Server", model.server?.name ?: "Choosing…"))
                            add(Triple(Pane.PICTURE, "Picture", if (model.fillScreen) "Fill screen" else "Server's layout"))
                            if (!model.request.isLive) add(Triple(Pane.QUALITY, "Quality", QualityPreference.current.label))
                            add(Triple(Pane.SLEEP, "Sleep timer", model.sleep.label))
                            if (model.isEpisode && episodes.isNotEmpty()) add(Triple(Pane.EPISODES, "Episodes", "Season ${model.request.season ?: 1}"))
                        }
                        items(rows, key = { it.first.name }) { (target, label, value) ->
                            SideItem(label, value, chevron = true, modifier = if (target == from || (from == Pane.MENU && target == rows.first().first)) Modifier.focusRequester(firstFocus) else Modifier) { open(target) }
                        }
                    }
                    Pane.AUDIO -> {
                        if (model.audioTracks.size <= 1) item { Note(if (model.audioTracks.isEmpty()) "This server has one audio track. Pick another server for a different language." else "Only ${PlayerModel.displayName(model.audioTracks[0])} on this server. Pick another server for a different language.") }
                        val tracks = model.audioTracks
                        items(tracks, key = { it.index }) { track ->
                            SideItem(PlayerModel.displayName(track), selected = track.on, modifier = if (track.on || (tracks.none { it.on } && track == tracks.first())) Modifier.focusRequester(firstFocus) else Modifier) {
                                model.selectAudio(track); close()
                            }
                        }
                        if (model.audioTracks.size <= 1) item { SideItem("Pick another server", chevron = true, modifier = Modifier.focusRequester(firstFocus)) { open(Pane.SERVER) } }
                    }
                    Pane.SUBTITLES -> {
                        item { Note(when {
                            model.usingExternalSubtitles -> model.external?.release ?: "From OpenSubtitles"
                            model.useExternal && model.externalLoading -> "Finding subtitles…"
                            else -> "From OpenSubtitles, drawn the same on every server."
                        }) }
                        items(PlaybackPrefs.subtitleChoices, key = { "l:" + it.first }) { (code, label) ->
                            val selected = if (code == "off") !model.useExternal && model.textTracks.none { it.on } else model.useExternal && model.subtitleLanguage == code
                            SideItem(label, selected = selected, modifier = if (selected) Modifier.focusRequester(firstFocus) else Modifier) { model.chooseSubtitleLanguage(code); close() }
                        }
                        if (model.textTracks.isNotEmpty()) {
                            item { Text("This server's own", style = Type.caption, color = Palette.muted, modifier = Modifier.padding(start = 10.dp, top = 12.dp, bottom = 2.dp)) }
                            items(model.textTracks.take(30), key = { "t:" + it.index }) { track ->
                                SideItem(PlayerModel.displayName(track), selected = !model.useExternal && track.on) { model.selectSubtitles(track); close() }
                            }
                        }
                    }
                    Pane.TIMING -> {
                        item { Note("If the words come early or late, shift them half a second at a time. Now: " + if (model.subtitleOffset == 0.0) "in sync" else "%+.1fs".format(model.subtitleOffset)) }
                        item { SideItem("Show them earlier", modifier = Modifier.focusRequester(firstFocus)) { model.nudgeSubtitles(-0.5) } }
                        item { SideItem("Show them later") { model.nudgeSubtitles(0.5) } }
                        if (model.subtitleOffset != 0.0) item { SideItem("Reset") { model.nudgeSubtitles(-model.subtitleOffset) } }
                        if ((model.external?.versions ?: 0) > 1) item { SideItem("Try another version", "${(model.external?.version ?: 0) + 1} of ${minOf(model.external?.versions ?: 1, 10)}") { model.nextSubtitleVersion() } }
                    }
                    Pane.SERVER -> items(model.servers, key = { it.id }) { server ->
                        val current = server == (model.server ?: model.servers.firstOrNull())
                        SideItem(server.name, selected = server == model.server, modifier = if (current) Modifier.focusRequester(firstFocus) else Modifier) { model.choose(server); close() }
                    }
                    Pane.PICTURE -> {
                        item { SideItem("Fill screen", "The picture edge to edge", selected = model.fillScreen, modifier = if (model.fillScreen) Modifier.focusRequester(firstFocus) else Modifier) { model.setFill(true); close() } }
                        item { SideItem("Server's layout", "If subtitles or the server's buttons go missing", selected = !model.fillScreen, modifier = if (!model.fillScreen) Modifier.focusRequester(firstFocus) else Modifier) { model.setFill(false); close() } }
                    }
                    Pane.QUALITY -> items(QualityPreference.entries.toList(), key = { it.raw }) { option ->
                        SideItem(option.label, if (option == QualityPreference.BEST) "Compares servers for a moment and keeps the sharpest" else "Plays the first server that starts",
                            selected = QualityPreference.current == option, modifier = if (QualityPreference.current == option) Modifier.focusRequester(firstFocus) else Modifier) {
                            Prefs.set("quality", option.raw); close()
                        }
                    }
                    Pane.SLEEP -> items(SleepOption.entries.filter { it != SleepOption.EPISODE || model.isEpisode }, key = { it.name }) { option ->
                        SideItem(option.label, selected = model.sleep == option, modifier = if (model.sleep == option) Modifier.focusRequester(firstFocus) else Modifier) { model.chooseSleep(option); close() }
                    }
                    Pane.EPISODES -> items(episodes, key = { it.id }) { episode ->
                        val current = episode.episodeNumber == model.request.episode
                        EpisodeItem(episode, current, if (current) Modifier.focusRequester(firstFocus) else Modifier) { model.play(episode.seasonNumber, episode.episodeNumber); close() }
                    }
                }
            }
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(text, style = Type.caption, color = Palette.muted, modifier = Modifier.padding(start = 10.dp, end = 10.dp, bottom = 6.dp))
}

// One row in the sidebar: white when focused, a check for the current choice
// (gold marks state), a chevron for rows that open another list.
@Composable
private fun SideItem(label: String, detail: String? = null, selected: Boolean = false, chevron: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    androidx.tv.material3.ListItem(
        selected = false, onClick = onClick, modifier = modifier,
        headlineContent = { Text(label, style = Type.headline.copy(fontSize = 15.sp), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = detail?.let { { Text(it, style = Type.caption, color = androidx.tv.material3.LocalContentColor.current.copy(alpha = 0.65f), maxLines = 1, overflow = TextOverflow.Ellipsis) } },
        trailingContent = when {
            selected -> { { Icon(Icons.Rounded.Check, "Selected", tint = Palette.gold, modifier = Modifier.size(18.dp)) } }
            chevron -> { { Icon(Icons.Rounded.ChevronRight, null, modifier = Modifier.size(18.dp)) } }
            else -> null
        },
        colors = androidx.tv.material3.ListItemDefaults.colors(containerColor = Color.Transparent, focusedContainerColor = Color.White, focusedContentColor = Color.Black),
        shape = androidx.tv.material3.ListItemDefaults.shape(RoundedCornerShape(8.dp)),
        scale = androidx.tv.material3.ListItemDefaults.scale(focusedScale = 1f),
    )
}

@Composable
private fun EpisodeItem(episode: TmdbSeason.Episode, current: Boolean, modifier: Modifier, onClick: () -> Unit) {
    androidx.tv.material3.ListItem(
        selected = false, onClick = onClick, modifier = modifier,
        leadingContent = { Art(Tmdb.image(episode.stillPath, Tmdb.WIDE), "${episode.episodeNumber}", Modifier.width(88.dp).height(50.dp).clip(RoundedCornerShape(4.dp))) },
        headlineContent = { Text("${episode.episodeNumber}. ${episode.name ?: "Episode ${episode.episodeNumber}"}", style = Type.callout.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(if (current) "Playing now" else episode.runtime?.let { "${it}m" } ?: "", style = Type.caption, color = androidx.tv.material3.LocalContentColor.current.copy(alpha = 0.65f)) },
        colors = androidx.tv.material3.ListItemDefaults.colors(containerColor = Color.Transparent, focusedContainerColor = Color.White, focusedContentColor = Color.Black),
        shape = androidx.tv.material3.ListItemDefaults.shape(RoundedCornerShape(8.dp)),
        scale = androidx.tv.material3.ListItemDefaults.scale(focusedScale = 1f),
    )
}
