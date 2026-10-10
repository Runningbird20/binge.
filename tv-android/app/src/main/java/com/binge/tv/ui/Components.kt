package com.binge.tv.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil.compose.SubcomposeAsyncImage
import com.binge.tv.data.LoadedRow
import com.binge.tv.data.Title
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

// Picture with a graceful fallback (name on a charcoal card) while loading or without art.
@Composable
fun Art(url: String?, name: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    SubcomposeAsyncImage(
        model = url, contentDescription = null, contentScale = contentScale, modifier = modifier,
        loading = { Fallback(name) }, error = { Fallback(name) },
    )
}

@Composable
private fun Fallback(name: String) {
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Palette.raised, Palette.surface))), contentAlignment = Alignment.Center) {
        Text(name, style = Type.callout, color = Palette.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(8.dp))
    }
}

@Composable
fun Badge(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = 0.5.sp), color = Color.Black,
        modifier = modifier.background(Palette.gold, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp))
}

@Composable
fun SectionTitle(text: String, subtitle: String? = null) {
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(horizontal = Dimens.edge)) {
        Text(text, style = Type.section, color = Color.White.copy(alpha = 0.92f))
        if (subtitle != null) Text(subtitle, style = Type.callout, color = Palette.muted)
    }
}

// The focus look for every card: a lift and a white edge (tvOS-style
// "raised" card), never gold, which is reserved for state.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun FocusCard(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    onFocus: (() -> Unit)? = null,
    shape: RoundedCornerShape = RoundedCornerShape(8.dp),
    content: @Composable BoxScope.() -> Unit,
) {
    Card(
        onClick = onClick, onLongClick = onLongClick,
        modifier = modifier.onFocusChanged { if (it.isFocused) onFocus?.invoke() },
        shape = CardDefaults.shape(shape),
        colors = CardDefaults.colors(containerColor = Palette.surface),
        scale = CardDefaults.scale(focusedScale = 1.08f),
        border = CardDefaults.border(focusedBorder = Border(androidx.compose.foundation.BorderStroke(2.dp, Color.White), shape = shape)),
        glow = CardDefaults.glow(),
    ) { Box(Modifier.fillMaxSize(), content = content) }
}

@Composable
fun PosterCard(title: Title, onOpen: (Title) -> Unit, modifier: Modifier = Modifier, onFocus: (() -> Unit)? = null, width: Dp = Dimens.posterW) {
    FocusCard(onClick = { onOpen(title) }, onFocus = onFocus, modifier = modifier.width(width).height(width * 1.5f)) {
        Art(title.poster, title.name, Modifier.fillMaxSize())
        val badge = title.badge ?: if (title.comingSoon) "Coming soon" else null
        if (badge != null) Badge(badge, Modifier.align(Alignment.TopStart).padding(6.dp))
    }
}

@Composable
fun TitleRow(row: LoadedRow, onOpen: (Title) -> Unit, modifier: Modifier = Modifier, onFocus: ((Title) -> Unit)? = null) {
    Column(modifier) {
        SectionTitle(row.title)
        PivotScroll(offset = Dimens.edge) {
            LazyRow(
                contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap),
            ) {
                items(row.items, key = { it.id }) { title ->
                    PosterCard(title, onOpen, onFocus = onFocus?.let { { it(title) } })
                }
            }
        }
    }
}

@Composable
fun RowSkeleton(wide: Boolean = false) {
    Column(Modifier.padding(horizontal = Dimens.edge, vertical = 10.dp)) {
        Box(Modifier.width(130.dp).height(16.dp).clip(RoundedCornerShape(4.dp)).background(Palette.raised))
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
            repeat(if (wide) 4 else 7) {
                Box(Modifier.width(if (wide) Dimens.wideW else Dimens.posterW).height(if (wide) Dimens.wideH else Dimens.posterH)
                    .clip(RoundedCornerShape(8.dp)).background(Palette.surface))
            }
        }
    }
}

@Composable
fun ProblemView(message: String, retry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Icon(androidx.compose.material.icons.Icons.Rounded.WifiOff, contentDescription = null, tint = Palette.gold, modifier = Modifier.size(34.dp))
        Text(message, style = Type.headline, textAlign = TextAlign.Center, modifier = Modifier.width(460.dp))
        Pill("Try again", onClick = retry)
    }
}

// Focus-aware pill (chips, settings, season pickers): white when focused,
// gold tint when selected, so a label is never gold-on-gold.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun Pill(
    label: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick, onLongClick = onLongClick, enabled = enabled, modifier = modifier,
        shape = ButtonDefaults.shape(CircleShape),
        scale = ButtonDefaults.scale(focusedScale = 1.06f),
        colors = ButtonDefaults.colors(
            containerColor = if (selected) Palette.gold.copy(alpha = 0.18f) else Color.White.copy(alpha = 0.08f),
            contentColor = if (selected) Palette.gold else Color.White,
            focusedContainerColor = Color.White, focusedContentColor = Color.Black,
            disabledContainerColor = Color.White.copy(alpha = 0.04f), disabledContentColor = Color.White.copy(alpha = 0.35f),
        ),
        border = ButtonDefaults.border(border = if (selected) Border(androidx.compose.foundation.BorderStroke(1.dp, Palette.gold.copy(alpha = 0.6f)), shape = CircleShape) else Border.None),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 8.dp),
    ) {
        if (icon != null) { Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)) }
        Text(label, style = Type.callout.copy(fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold), maxLines = 1)
    }
}

// The big action buttons on title pages and the spotlight (Play, My List…).
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ActionButton(label: String, icon: ImageVector?, modifier: Modifier = Modifier, enabled: Boolean = true, primary: Boolean = false, centered: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier,
        shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
        scale = ButtonDefaults.scale(focusedScale = 1.06f),
        colors = ButtonDefaults.colors(
            // Unfocused buttons are translucent; the focused one is solid white,
            // so where the remote is never needs a second look.
            containerColor = Color.White.copy(alpha = if (primary) 0.24f else 0.14f),
            contentColor = Color.White,
            focusedContainerColor = Color.White, focusedContentColor = Color.Black,
        ),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 9.dp),
    ) {
        if (centered) Spacer(Modifier.weight(1f))
        if (icon != null) { Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(label, style = Type.headline.copy(fontSize = 14.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (centered) Spacer(Modifier.weight(1f))
    }
}

@Composable
fun ProgressBar(progress: Float, modifier: Modifier = Modifier) {
    Box(modifier.height(3.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.25f))) {
        Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(3.dp).background(Palette.gold))
    }
}

@Composable
fun QrCode(text: String, size: Dp = 200.dp) {
    val bitmap = remember(text) {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 512, 512)
        Bitmap.createBitmap(512, 512, Bitmap.Config.RGB_565).apply {
            for (x in 0 until 512) for (y in 0 until 512) setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }.asImageBitmap()
    }
    Box(Modifier.background(Color.White, RoundedCornerShape(14.dp)).padding(12.dp)) {
        Image(bitmap, contentDescription = "QR code for $text", modifier = Modifier.size(size))
    }
}

fun clock(seconds: Double): String {
    if (!seconds.isFinite() || seconds <= 0) return "0:00"
    val total = seconds.toInt()
    val h = total / 3600; val m = (total % 3600) / 60; val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

@Composable
fun RowScope.Grow() = Spacer(Modifier.weight(1f))

// Text input for the remote: focusing it doesn't pop the keyboard over the
// page; OK opens it (Fire TV's keyboard includes voice).
@Composable
fun TvTextField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboard: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default,
    actions: androidx.compose.foundation.text.KeyboardActions = androidx.compose.foundation.text.KeyboardActions.Default,
    visual: androidx.compose.ui.text.input.VisualTransformation = androidx.compose.ui.text.input.VisualTransformation.None,
    leading: ImageVector? = null,
) {
    var focused by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    // Read-only (no keyboard) until OK is pressed on it; Back or moving away ends typing.
    var typing by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    val keyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    androidx.compose.runtime.LaunchedEffect(typing) { if (typing) { kotlinx.coroutines.delay(60); keyboardController?.show() } }
    androidx.compose.foundation.text.BasicTextField(
        value = value, onValueChange = onChange, singleLine = true, readOnly = !typing,
        textStyle = Type.headline.copy(color = Color.White, fontWeight = FontWeight.Normal),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(if (typing) Color.White else Color.Transparent),
        keyboardOptions = keyboard, keyboardActions = actions, visualTransformation = visual,
        modifier = modifier.fillMaxWidth()
            .onFocusChanged { focused = it.isFocused; if (!it.isFocused) typing = false }
            .onPreviewKeyEvent { event ->
                // ▲ / ▼ always move between controls (a one-line box has no lines to move through).
                val code = event.key.nativeKeyCode
                if (code == android.view.KeyEvent.KEYCODE_DPAD_UP || code == android.view.KeyEvent.KEYCODE_DPAD_DOWN) {
                    if (event.type == androidx.compose.ui.input.key.KeyEventType.KeyDown)
                        focusManager.moveFocus(if (code == android.view.KeyEvent.KEYCODE_DPAD_UP) androidx.compose.ui.focus.FocusDirection.Up else androidx.compose.ui.focus.FocusDirection.Down)
                    return@onPreviewKeyEvent true
                }
                val ok = event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER || event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_ENTER
                if (!ok || typing) return@onPreviewKeyEvent false
                if (event.type == androidx.compose.ui.input.key.KeyEventType.KeyUp) typing = true
                true
            },
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth()
                    .background(if (focused) Color.White.copy(alpha = 0.16f) else Color.White.copy(alpha = 0.07f), RoundedCornerShape(10.dp))
                    .then(if (focused) Modifier.border(2.dp, Color.White, RoundedCornerShape(10.dp)) else Modifier)
                    .padding(horizontal = 14.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (leading != null) { Icon(leading, null, tint = Palette.muted, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(10.dp)) }
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(placeholder, style = Type.headline.copy(fontWeight = FontWeight.Normal), color = Palette.muted)
                    inner()
                }
            }
        },
    )
}
