package com.binge.tv.ui

import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import coil.imageLoader
import coil.request.ImageRequest
import com.binge.tv.data.ContinueItem
import com.binge.tv.data.PlaybackPrefs
import com.binge.tv.data.Title
import com.binge.tv.data.Tmdb
import kotlinx.coroutines.delay

// Ambient mode: after a few minutes with no remote input (outside the
// player), or a long pause inside it, the screen becomes a slow slideshow
// of artwork from your shows, with the next thing to watch one click away.
object Ambient {
    var titles: List<Title> = emptyList()
    var resume: ContinueItem? = null
    var showing by mutableStateOf(false)
    private var lastActivity = System.currentTimeMillis()
    const val IDLE_MS = 4 * 60_000L

    fun touch() { lastActivity = System.currentTimeMillis() }

    fun check() {
        if (showing || !PlaybackPrefs.ambient || titles.isEmpty()) return
        if (Nav.stack.any { it is Screen.Player || it is Screen.Multiview }) return
        if (System.currentTimeMillis() - lastActivity > IDLE_MS) showing = true
    }
}

@Composable
fun AmbientHost() {
    LaunchedEffect(Unit) { while (true) { delay(15_000); Ambient.check() } }
    if (Ambient.showing) {
        val resume = Ambient.resume
        AmbientView(Ambient.titles, resumeLabel = resume?.let { "Resume ${it.title.name}${it.episodeLabel?.let { e -> " · $e" } ?: ""}" },
            resume = { Ambient.showing = false; Ambient.touch(); resume?.let { Nav.play(it.playRequest) } },
            dismiss = { Ambient.showing = false; Ambient.touch() })
    }
}

@Composable
fun AmbientView(titles: List<Title>, resumeLabel: String?, resume: () -> Unit, dismiss: () -> Unit) {
    var index by remember { mutableIntStateOf(0) }
    var zoomTarget by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val reduceMotion = remember { runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE) == 0f }.getOrDefault(false) }
    val zoom by animateFloatAsState(if (zoomTarget && !reduceMotion) 1.12f else 1f, tween(if (zoomTarget) 14_000 else 0, easing = LinearEasing), label = "zoom")
    val button = remember { FocusRequester() }
    BackHandler(onBack = dismiss)
    LaunchedEffect(Unit) {
        runCatching { button.requestFocus() }
        zoomTarget = true
        // A new picture every 14s, cross-faded; the next one is fetched during this one.
        while (titles.isNotEmpty()) {
            val next = Tmdb.resized(titles[(index + 1) % titles.size].backdrop, Tmdb.FULL_SCREEN)
            if (next != null) context.imageLoader.enqueue(ImageRequest.Builder(context).data(next).build())
            delay(14_000)
            zoomTarget = false
            index++
            delay(50)
            zoomTarget = true
        }
    }
    val current = titles.getOrNull(if (titles.isEmpty()) 0 else index % titles.size)
    Box(Modifier.fillMaxSize().background(Color.Black).onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
        when (event.key.nativeKeyCode) {
            android.view.KeyEvent.KEYCODE_DPAD_LEFT, android.view.KeyEvent.KEYCODE_DPAD_RIGHT,
            android.view.KeyEvent.KEYCODE_DPAD_UP, android.view.KeyEvent.KEYCODE_DPAD_DOWN -> { dismiss(); true }
            else -> false
        }
    }) {
        Crossfade(current, animationSpec = tween(1600), label = "ambient") { title ->
            if (title != null) Art(Tmdb.resized(title.backdrop ?: title.poster, Tmdb.FULL_SCREEN), "", Modifier.fillMaxSize().scale(zoom))
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.75f))))
        Column(Modifier.align(Alignment.BottomStart).padding(Dimens.edge), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            current?.let { Text(it.name, style = Type.page.copy(fontWeight = FontWeight.Bold)) }
            ActionButton(resumeLabel ?: "Back to binge.", if (resumeLabel == null) Icons.Rounded.Home else Icons.Rounded.PlayArrow, Modifier.focusRequester(button), primary = true, onClick = resume)
            Text("Press any arrow or Back to leave", style = Type.caption, color = Color.White.copy(alpha = 0.6f))
        }
    }
}
