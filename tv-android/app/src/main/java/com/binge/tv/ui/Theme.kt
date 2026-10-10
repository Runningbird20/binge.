package com.binge.tv.ui

import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

// The site's palette: near-black background, charcoal surfaces, gold accent
// (gold only marks actions, selection or state).
object Palette {
    val background = Color(0xFF0B0D12)
    val surface = Color(0xFF12151D)
    val raised = Color(0xFF1A1F2B)
    val gold = Color(0xFFF5C451)
    val muted = Color.White.copy(alpha = 0.62f)
    val live = Color(0xFFE5383B)
    val error = Color(0xFFFFB4A8)
}

// A 1080p TV is 960×540 dp. The Apple TV app's 1920-point layout, halved.
object Dimens {
    val edge = 40.dp // horizontal safe margin (TV overscan)
    val rowGap = 20.dp
    val posterW = 116.dp
    val posterH = 174.dp
    val wideW = 216.dp
    val wideH = 122.dp
}

object Type {
    val hero = TextStyle(fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 38.sp)
    val page = TextStyle(fontSize = 27.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 32.sp)
    val section = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    val headline = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontSize = 14.sp, lineHeight = 20.sp)
    val callout = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val caption = TextStyle(fontSize = 11.sp, lineHeight = 15.sp)
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun BingeTheme(largeText: Boolean, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    MaterialTheme(colorScheme = darkColorScheme(
        primary = Color.White, onPrimary = Color.Black, background = Palette.background, surface = Palette.surface,
        onSurface = Color.White, onBackground = Color.White, secondary = Palette.gold,
    )) {
        CompositionLocalProvider(
            LocalDensity provides androidx.compose.ui.unit.Density(density.density, if (largeText) 1.3f else 1f),
            androidx.tv.material3.LocalContentColor provides Color.White,
            content = content,
        )
    }
}

// TV scrolling. Rows (fraction 0): the focused card keeps a fixed spot at the
// row's left margin instead of hugging the screen edge. Pages (fraction > 0):
// a focused item that's already fully on screen doesn't move the page;
// anything else lands a fixed fraction of the way down, so rows always
// settle in the same place.
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PivotScroll(fraction: Float = 0f, offset: Dp = 0.dp, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val spec = remember(fraction, offset) {
        object : BringIntoViewSpec {
            @Suppress("OVERRIDE_DEPRECATION")
            // Steady and short: a constant-speed move (no ease-in/out glide), done
            // before the next press lands, so a row never keeps drifting after
            // focus has moved on.
            override val scrollAnimationSpec = tween<Float>(durationMillis = 120, easing = androidx.compose.animation.core.LinearEasing)
            override fun calculateScrollDistance(offset0: Float, size: Float, containerSize: Float): Float {
                val target = containerSize * fraction + with(density) { offset.toPx() }
                if (fraction > 0f) {
                    val margin = with(density) { 24.dp.toPx() }
                    if (offset0 >= margin && offset0 + size <= containerSize - margin) return 0f
                }
                return offset0 - target
            }
        }
    }
    CompositionLocalProvider(LocalBringIntoViewSpec provides spec, content = content)
}
