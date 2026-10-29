package com.binge.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Backspace
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.binge.tv.data.AccountProfile
import com.binge.tv.data.AppModel
import com.binge.tv.data.ProfileLocks
import kotlinx.coroutines.launch

private val ErrorOrange = Color(0xFFE87C03)
private val digitKeys = mapOf(
    Key.Zero to 0, Key.One to 1, Key.Two to 2, Key.Three to 3, Key.Four to 4,
    Key.Five to 5, Key.Six to 6, Key.Seven to 7, Key.Eight to 8, Key.Nine to 9,
    Key.NumPad0 to 0, Key.NumPad1 to 1, Key.NumPad2 to 2, Key.NumPad3 to 3, Key.NumPad4 to 4,
    Key.NumPad5 to 5, Key.NumPad6 to 6, Key.NumPad7 to 7, Key.NumPad8 to 8, Key.NumPad9 to 9,
)

// "Profile Lock is currently on." The same screen as the website's, with an
// on-screen keypad (and the remote's number keys, where it has them). The
// PIN is checked on the server as soon as the fourth digit is in; Back
// returns to the profiles.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PinEntryScreen(profile: AccountProfile) {
    val scope = rememberCoroutineScope()
    var digits by remember(profile.id) { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val firstKey = remember { FocusRequester() }

    fun type(digit: Int) {
        if (checking || digits.length >= ProfileLocks.PIN_LENGTH) return
        error = null
        digits += digit
        if (digits.length < ProfileLocks.PIN_LENGTH) return
        checking = true
        val pin = digits
        scope.launch {
            when (val result = AppModel.unlock(pin)) {
                AppModel.UnlockResult.Unlocked -> Unit
                AppModel.UnlockResult.WrongPin -> { error = "Incorrect PIN. After five wrong tries, wait five minutes."; digits = "" }
                is AppModel.UnlockResult.Failed -> { error = result.message; digits = "" }
            }
            checking = false
        }
    }
    fun deleteLast() { if (!checking) { digits = digits.dropLast(1); error = null } }

    BackHandler { AppModel.pinProfile = null }

    Column(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(0f to Color(0xFF1A2030), 0.6f to Palette.background))
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                digitKeys[event.key]?.let { type(it); return@onPreviewKeyEvent true }
                if (event.key == Key.Backspace || event.key == Key.Delete) { deleteLast(); true } else false
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Profile Lock is currently on.", style = Type.body, color = Palette.muted)
        Spacer(Modifier.height(8.dp))
        Text("Enter your pin to access this profile.", style = Type.hero, textAlign = TextAlign.Center)
        Spacer(Modifier.height(22.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.semantics { contentDescription = "${digits.length} of ${ProfileLocks.PIN_LENGTH} digits entered" },
        ) {
            repeat(ProfileLocks.PIN_LENGTH) { index -> PinBox(filled = index < digits.length, current = index == digits.length && !checking, failed = error != null) }
        }
        Text(error ?: " ", style = Type.callout, color = ErrorOrange, modifier = Modifier.padding(top = 10.dp))
        Spacer(Modifier.height(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(listOf(1, 2, 3), listOf(4, 5, 6), listOf(7, 8, 9)).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { digit -> KeypadKey(Modifier.then(if (digit == 1) Modifier.focusRequester(firstKey) else Modifier), "$digit") { type(digit) } }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Spacer(Modifier.size(width = 72.dp, height = 40.dp))
                KeypadKey(Modifier, "0") { type(0) }
                KeypadKey(Modifier, null, onClick = ::deleteLast)
            }
        }
        Spacer(Modifier.height(16.dp))
        Pill("Back to profiles") { AppModel.pinProfile = null }
    }
    LaunchedEffect(profile.id) { runCatching { firstKey.requestFocus() } }
}

@Composable
private fun PinBox(filled: Boolean, current: Boolean, failed: Boolean) {
    val shape = RoundedCornerShape(8.dp)
    val borderColor = when {
        current -> Color.White
        failed -> ErrorOrange
        else -> Color.White.copy(alpha = 0.32f)
    }
    Box(
        Modifier
            .size(width = 52.dp, height = 66.dp)
            .background(Brush.verticalGradient(listOf(Color(0xFF151A26), Color(0xFF0D1018))), shape)
            .border(if (current) 2.dp else 1.dp, borderColor, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (filled) Box(Modifier.size(11.dp).background(Color.White, CircleShape))
    }
}

// A digit, or the delete key when label is null.
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun KeypadKey(modifier: Modifier, label: String?, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.size(width = 72.dp, height = 40.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(8.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.raised,
            focusedContainerColor = Color.White,
            contentColor = Color.White,
            focusedContentColor = Palette.background,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (label != null) Text(label, style = Type.section.copy(fontSize = 20.sp))
            else Icon(Icons.AutoMirrored.Rounded.Backspace, contentDescription = "Delete")
        }
    }
}
