package com.binge.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.Surface
import androidx.tv.material3.SurfaceDefaults
import androidx.tv.material3.Tab
import androidx.tv.material3.TabDefaults
import androidx.tv.material3.TabRow
import androidx.tv.material3.TabRowDefaults
import androidx.tv.material3.Text
import com.binge.tv.data.AccountProfile
import com.binge.tv.data.AppModel
import com.binge.tv.data.Config
import com.binge.tv.data.Phase
import com.binge.tv.data.SportGame
import com.binge.tv.data.Title
import com.binge.tv.player.PlayRequest
import kotlinx.coroutines.launch

sealed class Screen {
    data class Detail(val title: Title) : Screen()
    data class Player(val request: PlayRequest) : Screen()
    data class Multiview(val games: List<SportGame>) : Screen()
    object History : Screen()
    object Calendar : Screen()
    object Settings : Screen()
    object Wrapped : Screen()
}

// A simple stack over the tabs: title pages, the player, Me's pages.
object Nav {
    val stack = mutableStateListOf<Screen>()
    // Bumped when something on top closes, so the tab under it can refresh (Continue Watching).
    var returns by mutableIntStateOf(0)
    fun push(screen: Screen) { stack.add(screen) }
    fun pop() { if (stack.isNotEmpty()) { stack.removeAt(stack.lastIndex); returns++ } }
    fun open(title: Title) = push(Screen.Detail(title))
    fun play(request: PlayRequest) = push(Screen.Player(request))
}

// Tabs report whether they're scrolled to the top: the tab bar shows there
// (and whenever it has focus), and gets out of the way further down.
object TabChrome { var atTop by mutableStateOf(true) }

@Composable
fun BingeApp() {
    LaunchedEffect(Unit) { AppModel.start() }
    Box(Modifier.fillMaxSize().background(Palette.background)) {
        when (AppModel.phase) {
            Phase.LOADING -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Wordmark(40.sp) }
            Phase.SIGNED_OUT -> SignInScreen()
            Phase.CHOOSING_PROFILE -> ProfilePicker()
            Phase.READY -> Shell()
        }
        AmbientHost()
    }
}

@Composable
fun Wordmark(size: androidx.compose.ui.unit.TextUnit = 24.sp) {
    Text("binge.", style = Type.hero.copy(fontSize = size, fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic,
        fontFamily = androidx.compose.ui.text.font.FontFamily.Serif), color = Color.White)
}

private data class TabSpec(val id: String, val label: String)

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Shell() {
    val tabs = buildList {
        add(TabSpec("home", "Home")); add(TabSpec("movies", "Movies")); add(TabSpec("series", "Series"))
        if (!AppModel.isKids) add(TabSpec("sports", "Sports"))
        add(TabSpec("search", "Search")); add(TabSpec("me", AppModel.profile?.name ?: "Me"))
    }
    var selected by remember(AppModel.profile?.id) { mutableIntStateOf(tabs.indexOfFirst { it.id == com.binge.tv.DebugLaunch.tab }.coerceAtLeast(0)) }
    LaunchedEffect(Unit) { debugOpen() }
    var tabsFocused by remember { mutableStateOf(false) }
    var contentHasFocus by remember { mutableStateOf(false) }
    val contentFocus = remember { FocusRequester() }
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    // One per tab: going up to the tab bar always lands on the tab you're on.
    val tabRequesters = remember(tabs.size) { List(tabs.size) { FocusRequester() } }
    val top = Nav.stack.lastOrNull()

    BackHandler(enabled = top == null && !tabsFocused) {
        // Back from anywhere in a tab goes up to the tab bar first (tvOS / Android TV convention).
        runCatching { tabRequesters[selected].requestFocus() }
    }

    Box(Modifier.fillMaxSize()) {
        // The tabs stay composed under pages pushed on top, so focus and scroll come back as they were.
        // Keyed by tab: each tab gets fresh focus memory. (A memory pointing at the
        // previous tab's elements made ▼ from the tab bar fail after switching.)
        androidx.compose.runtime.key(selected) {
        Box(Modifier.fillMaxSize().focusRequester(contentFocus).focusRestorer().onFocusChanged { contentHasFocus = it.hasFocus }) {
            when (tabs.getOrNull(selected)?.id) {
                "home" -> HomeScreen()
                "movies" -> BrowseScreen(com.binge.tv.data.MediaKind.MOVIE)
                "series" -> BrowseScreen(com.binge.tv.data.MediaKind.TV)
                "sports" -> SportsScreen()
                "search" -> SearchScreen()
                "me" -> MeScreen()
            }
        }
        }
        val chrome by animateFloatAsState(if (tabsFocused || TabChrome.atTop) 1f else 0f, label = "tabs")
        Box(
            Modifier.fillMaxWidth().alpha(chrome)
                .background(Brush.verticalGradient(listOf(Palette.background.copy(alpha = 0.85f), Color.Transparent)))
                .padding(top = 14.dp, bottom = 18.dp),
            contentAlignment = Alignment.Center,
        ) {
            TabRow(
                selectedTabIndex = selected,
                modifier = Modifier.focusRestorer { tabRequesters.getOrElse(selected) { FocusRequester.Default } }.onFocusChanged { tabsFocused = it.hasFocus }
                    // ▼ from the tab bar into the page, back where focus last was there.
                    .onPreviewKeyEvent { event ->
                        if (event.type == androidx.compose.ui.input.key.KeyEventType.KeyDown && event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN) {
                            val moved = runCatching { contentFocus.requestFocus() }.isSuccess && contentHasFocus
                            if (!moved) focusManager.moveFocus(androidx.compose.ui.focus.FocusDirection.Down)
                            true
                        } else false
                    },
                separator = { Spacer(Modifier.width(6.dp)) },
                indicator = { positions, doesTabRowHaveFocus ->
                    TabRowDefaults.PillIndicator(currentTabPosition = positions[selected], doesTabRowHaveFocus = doesTabRowHaveFocus,
                        activeColor = Color.White, inactiveColor = Color.White.copy(alpha = 0.16f))
                },
            ) {
                tabs.forEachIndexed { index, tab ->
                    Tab(
                        modifier = Modifier.focusRequester(tabRequesters[index]),
                        selected = index == selected,
                        onFocus = { selected = index },
                        onClick = { runCatching { contentFocus.requestFocus() } },
                        colors = TabDefaults.pillIndicatorTabColors(
                            contentColor = Color.White.copy(alpha = 0.7f), selectedContentColor = Color.White,
                            focusedContentColor = Color.Black, focusedSelectedContentColor = Color.Black,
                        ),
                    ) {
                        Text(tab.label, style = Type.callout.copy(fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
                    }
                }
            }
        }

        // Generic Back for pages on top. Registered before the pages themselves:
        // the most recently registered handler wins, so a page's own Back (the
        // player's menu, a sheet) is handled first.
        if (top != null) BackHandler { Nav.pop() }
        // Pages on top of the tabs.
        Nav.stack.forEachIndexed { index, screen ->
            val active = index == Nav.stack.lastIndex
            Box(Modifier.fillMaxSize().background(if (screen is Screen.Player || screen is Screen.Multiview) Color.Black else Palette.background)) {
                if (active || screen !is Screen.Player) ScreenFor(screen, active)
            }
        }
    }
    // Focus lands on the page as soon as it has something to focus (it loads after the shell).
    LaunchedEffect(selected) {
        repeat(40) {
            if (contentHasFocus || tabsFocused || Nav.stack.isNotEmpty()) return@LaunchedEffect
            runCatching { contentFocus.requestFocus() }
            kotlinx.coroutines.delay(250)
        }
    }
    // Coming back from a page restores focus to where it was in the tab.
    LaunchedEffect(Nav.stack.size) { if (Nav.stack.isEmpty()) runCatching { contentFocus.requestFocus() } }
}


// DebugLaunch: open a title (kind:id) and optionally play an episode (s:e, 0 for a movie).
private suspend fun debugOpen() {
    com.binge.tv.DebugLaunch.embed?.let { url ->
        com.binge.tv.DebugLaunch.embed = null
        val server = com.binge.tv.player.StreamServer(url, "Test stream") { _, _, _, _ -> url }
        Nav.play(PlayRequest(Title(com.binge.tv.data.MediaKind.MOVIE, 0, "Stream test"), liveStreams = listOf(server), subtitle = "LIVE · test"))
        return
    }
    val open = com.binge.tv.DebugLaunch.open ?: return
    com.binge.tv.DebugLaunch.open = null
    val kind = com.binge.tv.data.MediaKind.of(open.substringBefore(':'))
    val id = open.substringAfter(':').toLongOrNull() ?: return
    var title = runCatching { com.binge.tv.data.Catalog.titles(kind, listOf(id))[id] }.getOrNull() ?: return
    title.tmdbId?.let { tmdb ->
        runCatching { com.binge.tv.data.Tmdb.get<com.binge.tv.data.TmdbDetails>("${kind.tmdbPath}/$tmdb") }.getOrNull()?.let { d ->
            title = title.copy(backdrop = com.binge.tv.data.Tmdb.image(d.backdropPath, com.binge.tv.data.Tmdb.WIDE), originalLanguage = title.originalLanguage ?: d.originalLanguage)
        }
    }
    val play = com.binge.tv.DebugLaunch.play
    if (play == null) { Nav.open(title); return }
    val s = play.substringBefore(':').toIntOrNull() ?: 0
    val e = play.substringAfter(':').toIntOrNull() ?: 0
    Nav.play(PlayRequest(title, if (s > 0) s else null, if (s > 0) e else null))
}

@Composable
private fun ScreenFor(screen: Screen, active: Boolean) {
    when (screen) {
        is Screen.Detail -> TitleScreen(screen.title, active)
        is Screen.Player -> PlayerScreen(screen.request)
        is Screen.Multiview -> MultiviewScreen(screen.games)
        Screen.History -> HistoryScreen()
        Screen.Calendar -> CalendarScreen()
        Screen.Settings -> SettingsScreen()
        Screen.Wrapped -> WrappedScreen()
    }
}

// MARK: Sign in

@Composable
private fun SignInScreen() {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(if (Config.isConfigured) null else "This build is missing its settings. Build it from the repo with .env present.") }
    val scope = rememberCoroutineScope()
    val emailFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    fun submit() {
        if (email.isBlank() || password.isEmpty() || busy) return
        busy = true; error = null
        scope.launch {
            try { AppModel.signIn(email, password) } catch (e: Exception) { error = e.message }
            busy = false
        }
    }
    Row(Modifier.fillMaxSize().padding(horizontal = 60.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(60.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Wordmark(48.sp)
            Text("Movies, series, books and live sports, picked for you.", style = Type.headline.copy(fontWeight = FontWeight.Normal), color = Palette.muted)
            Text("New here? Create an account at ${Config.siteHost} on your phone or computer, then sign in here.", style = Type.callout, color = Palette.muted)
        }
        Column(Modifier.width(360.dp).background(Palette.surface, RoundedCornerShape(18.dp)).padding(28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Sign in", style = Type.page.copy(fontSize = 22.sp))
            TvTextField(email, { email = it }, "Email", Modifier.focusRequester(emailFocus),
                KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                KeyboardActions(onNext = { passwordFocus.requestFocus() }))
            TvTextField(password, { password = it }, "Password", Modifier.focusRequester(passwordFocus),
                KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                KeyboardActions(onDone = { submit() }), visual = PasswordVisualTransformation())
            error?.let {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Rounded.ErrorOutline, null, tint = Palette.error, modifier = Modifier.size(16.dp))
                    Text(it, style = Type.callout, color = Palette.error)
                }
            }
            ActionButton(if (busy) "Signing in…" else "Sign in", null, Modifier.fillMaxWidth(), enabled = !busy && email.isNotBlank() && password.isNotEmpty(), primary = true, centered = true) { submit() }
        }
    }
    LaunchedEffect(Unit) { runCatching { emailFocus.requestFocus() } }
}

// MARK: Profiles

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ProfilePicker() {
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("Who's watching?", style = Type.hero)
        Spacer(Modifier.height(34.dp))
        val error = AppModel.profileLoadError
        if (error != null) ProblemView(error) { scope.launch { AppModel.loadProfiles() } }
        else Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            val initial = AppModel.profiles.indexOfFirst { it.id == AppModel.lastProfileId }.coerceAtLeast(0)
            AppModel.profiles.forEachIndexed { index, profile ->
                Surface(
                    onClick = { AppModel.choose(profile) },
                    modifier = if (index == initial) Modifier.focusRequester(first) else Modifier,
                    shape = androidx.tv.material3.ClickableSurfaceDefaults.shape(RoundedCornerShape(16.dp)),
                    colors = androidx.tv.material3.ClickableSurfaceDefaults.colors(containerColor = Color.Transparent, focusedContainerColor = Color.Transparent),
                    scale = androidx.tv.material3.ClickableSurfaceDefaults.scale(focusedScale = 1.1f),
                ) { ProfileAvatar(profile, 110.dp) }
            }
        }
        Spacer(Modifier.height(30.dp))
        Pill("Sign out") { scope.launch { AppModel.signOut() } }
    }
    LaunchedEffect(AppModel.profiles.size) { runCatching { first.requestFocus() } }
}

@Composable
fun ProfileAvatar(profile: AccountProfile, size: androidx.compose.ui.unit.Dp) {
    val color = profile.avatarColor?.removePrefix("#")?.toLongOrNull(16)?.let { Color(0xFF000000 or it) } ?: Color(0xFF3B4A7A)
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(6.dp)) {
        Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.16f)).background(color), contentAlignment = Alignment.Center) {
            Text(profile.name.take(1).uppercase(), style = Type.hero.copy(fontSize = (size.value * 0.42f).sp), color = Color.White)
            profile.avatarImageUrl?.let { coil.compose.AsyncImage(model = it, contentDescription = null, contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(profile.name, style = Type.headline)
            if (profile.isKids) Badge("Kids")
        }
    }
}
