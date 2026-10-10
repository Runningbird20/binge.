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
            panelOpen -> panelOpen = false
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

        AnimatedVisibility(panelOpen, enter = slideInVertically { it / 3 } + fadeIn(), exit = slideOutVertically { it / 3 } + fadeOut()) {
            PlayerPanel(model) { panelOpen = false }
        }
    }
    LaunchedEffect(panelOpen) { if (!panelOpen) { kotlinx.coroutines.delay(30); runCatching { surfaceFocus.requestFocus() } } }
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
            Text("Finding the fastest server…", style = Type.headline)
            if (model.racingNames.isNotEmpty()) Text("Trying ${model.racingNames} at once", style = Type.callout, color = Palette.muted, textAlign = TextAlign.Center)
        }
        model.notice?.let { Text(it, style = if (gaveUp) Type.headline else Type.callout, color = if (gaveUp) Color.White else Palette.gold, textAlign = TextAlign.Center) }
        if (!gaveUp) Text("Press ▼ to pick another server", style = Type.caption, color = Palette.muted)
    }
}

// ▼: switch server, audio and subtitles, picture, quality, sleep timer, episodes.
@Composable
private fun PlayerPanel(model: PlayerModel, close: () -> Unit) {
    var episodes by remember { mutableStateOf<List<TmdbSeason.Episode>>(emptyList()) }
    val first = remember { FocusRequester() }
    LaunchedEffect(model.request.season) {
        val id = model.request.title.tmdbId
        if (model.isEpisode && id != null) episodes = runCatching { Tmdb.get<TmdbSeason>("tv/$id/season/${model.request.season ?: 1}") }.getOrNull()?.episodes.orEmpty()
    }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(60); runCatching { first.requestFocus() } }
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Transparent, 0.3f to Color.Black.copy(alpha = 0.88f), 1f to Color.Black))) {
        PivotScroll(fraction = 0.35f) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 150.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                item { PanelRow(if (model.request.isLive) "Stream" else "Server") {
                    items(model.servers, key = { it.id }) { server ->
                        Pill(server.name, selected = server == model.server, icon = if (server == model.server) Icons.Rounded.Check else null,
                            modifier = if (server == (model.server ?: model.servers.firstOrNull())) Modifier.focusRequester(first) else Modifier) { model.choose(server); close() }
                    }
                } }
                item {
                    val tracks = model.audioTracks
                    PanelRow("Audio", if (tracks.size <= 1) (if (tracks.isEmpty()) "This server has one audio track. Try another server for a different language."
                        else "Only ${PlayerModel.displayName(tracks[0])} on this server. Try another server for a different language.") else null) {
                        if (tracks.size > 1) items(tracks, key = { it.index }) { track ->
                            Pill(PlayerModel.displayName(track), selected = track.on) { model.selectAudio(track); close() }
                        }
                    }
                }
                item {
                    val note = when {
                        model.usingExternalSubtitles -> model.external?.release
                        model.useExternal && model.externalLoading -> "Finding subtitles…"
                        model.useExternal && model.subtitleLanguage != "off" && model.external == null -> "None found for this episode; the server's are below."
                        else -> null
                    }
                    PanelRow("Subtitles", note) {
                        items(PlaybackPrefs.subtitleChoices, key = { it.first }) { (code, label) ->
                            val selected = if (code == "off") !model.useExternal && model.textTracks.none { it.on } else model.useExternal && model.subtitleLanguage == code
                            Pill(label, selected = selected) { model.chooseSubtitleLanguage(code); close() }
                        }
                        if (model.usingExternalSubtitles) {
                            item { Pill("Earlier", icon = Icons.Rounded.FastRewind) { model.nudgeSubtitles(-0.5) } }
                            item { Pill("Later", icon = Icons.Rounded.FastForward) { model.nudgeSubtitles(0.5) } }
                            if (model.subtitleOffset != 0.0) item { Text("%+.1fs".format(model.subtitleOffset), style = Type.callout, color = Palette.muted, modifier = Modifier.padding(top = 8.dp)) }
                            if ((model.external?.versions ?: 0) > 1) item { Pill("Another version") { model.nextSubtitleVersion() } }
                        }
                    }
                }
                if (model.textTracks.isNotEmpty()) item { PanelRow("Server's subtitles") {
                    items(model.textTracks.take(30), key = { it.index }) { track ->
                        Pill(PlayerModel.displayName(track), selected = !model.useExternal && track.on) { model.selectSubtitles(track); close() }
                    }
                } }
                item { PanelRow("Picture", "Switch if subtitles or the server's buttons go missing.") {
                    item { Pill("Fill screen", selected = model.fillScreen) { model.setFill(true); close() } }
                    item { Pill("Server's layout", selected = !model.fillScreen) { model.setFill(false); close() } }
                } }
                item { PanelRow("Quality", "Best quality checks several servers for a sharper stream for a moment after it starts.") {
                    items(QualityPreference.entries.toList(), key = { it.raw }) { option ->
                        Pill(option.label, selected = QualityPreference.current == option) { Prefs.set("quality", option.raw); close() }
                    }
                } }
                item { PanelRow("Sleep timer") {
                    items(SleepOption.entries.filter { it != SleepOption.EPISODE || model.isEpisode }, key = { it.name }) { option ->
                        Pill(option.label, selected = model.sleep == option) { model.chooseSleep(option); close() }
                    }
                } }
                if (model.isEpisode && episodes.isNotEmpty()) item {
                    Column {
                        Text("Season ${model.request.season ?: 1}", style = Type.headline, color = Palette.muted, modifier = Modifier.padding(start = Dimens.edge))
                        PivotScroll(offset = Dimens.edge) {
                            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                items(episodes, key = { it.id }) { episode ->
                                    FocusCard(onClick = { model.play(episode.seasonNumber, episode.episodeNumber); close() }, modifier = Modifier.width(160.dp).height(112.dp)) {
                                        Column {
                                            Art(Tmdb.image(episode.stillPath, Tmdb.WIDE), "Episode ${episode.episodeNumber}", Modifier.fillMaxWidth().height(84.dp))
                                            Text("${episode.episodeNumber}. ${episode.name ?: ""}", style = Type.caption.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis,
                                                modifier = Modifier.fillMaxWidth().background(if (episode.episodeNumber == model.request.episode) Palette.gold.copy(alpha = 0.35f) else Palette.surface).padding(6.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PanelRow(heading: String, note: String? = null, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    Column {
        Row(Modifier.padding(start = Dimens.edge, end = Dimens.edge), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(heading, style = Type.headline, color = Palette.muted)
            note?.let { Text(it, style = Type.caption, color = Palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        PivotScroll(offset = Dimens.edge) {
            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), content = content)
        }
    }
}
