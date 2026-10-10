package com.binge.tv.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.binge.tv.data.AppModel
import com.binge.tv.data.Catalog
import com.binge.tv.data.ContinueItem
import com.binge.tv.data.LoadedRow
import com.binge.tv.data.MediaKind
import com.binge.tv.data.Personal
import com.binge.tv.data.Rows
import com.binge.tv.data.Title
import com.binge.tv.data.Tmdb
import com.binge.tv.player.PlayRequest
import com.binge.tv.player.Warmup
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

val ContinueItem.playRequest: PlayRequest
    get() = PlayRequest(title, if (title.kind == MediaKind.TV) season ?: 1 else null, if (title.kind == MediaKind.TV) episode ?: 1 else null, position)

// Reports whether a tab's page is scrolled to its top (for the tab bar).
@Composable
fun ReportTop(state: LazyListState) {
    LaunchedEffect(state) {
        snapshotFlow { state.firstVisibleItemIndex == 0 && state.firstVisibleItemScrollOffset < 60 }.collect { TabChrome.atTop = it }
    }
}

// Remembered across tab switches within a session, so Home comes back instantly.
private object HomeCache {
    var continueItems: List<ContinueItem> = emptyList()
    var myList: List<Title> = emptyList()
    var personal = Personal.Rows()
    var shared: List<Title> = emptyList()
    var rows: List<LoadedRow> = emptyList()
    var spotlight: Title? = null
    var profileId: String? = null
}

@Composable
fun HomeScreen() {
    val profileId = AppModel.profile?.id
    if (HomeCache.profileId != profileId) { HomeCache.profileId = profileId; HomeCache.rows = emptyList(); HomeCache.continueItems = emptyList(); HomeCache.spotlight = null }
    var continueItems by remember { mutableStateOf(HomeCache.continueItems) }
    var myList by remember { mutableStateOf(HomeCache.myList) }
    var personal by remember { mutableStateOf(HomeCache.personal) }
    var shared by remember { mutableStateOf(HomeCache.shared) }
    var rows by remember { mutableStateOf(HomeCache.rows) }
    var spotlight by remember { mutableStateOf(HomeCache.spotlight) }
    var loading by remember { mutableStateOf(rows.isEmpty()) }
    var menuFor by remember { mutableStateOf<ContinueItem?>(null) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    ReportTop(listState)
    val name = AppModel.profile?.name ?: "you"

    suspend fun load() {
        loading = rows.isEmpty()
        val kids = AppModel.isKids
        kotlinx.coroutines.coroutineScope {
            val general = async { Catalog.loadAll(Rows.home(kids), kids) }
            val cw = async { runCatching { AppModel.continueWatching() }.getOrDefault(emptyList()) }
            val list = async { runCatching { AppModel.myList() }.getOrDefault(emptyList()) }
            val loved = async { AppModel.lovedTitles() }
            val rated = async { AppModel.ratedIds() }
            continueItems = cw.await(); HomeCache.continueItems = continueItems
            continueItems.firstOrNull()?.let { Warmup.prepare(it.playRequest) }
            myList = list.await(); HomeCache.myList = myList
            rows = general.await(); HomeCache.rows = rows
            loading = false
            val exclude = rated.await() + continueItems.map { it.id } + myList.map { it.id }
            personal = Personal.build(continueItems, loved.await(), exclude, kids, AppModel.profile?.name); HomeCache.personal = personal
            // A different spotlight most visits: one of your picks or something trending.
            if (spotlight == null) {
                val pool = personal.topPicks?.items.orEmpty().take(10).filter { it.backdrop != null } +
                    rows.take(2).flatMap { it.items.take(6) }.filter { it.backdrop != null }
                spotlight = pool.randomOrNull(); HomeCache.spotlight = spotlight
            }
            Ambient.titles = (continueItems.map { it.title } + personal.topPicks?.items.orEmpty() + myList + rows.firstOrNull()?.items.orEmpty())
                .filter { it.backdrop != null }.distinctBy { it.id }.take(20)
            Ambient.resume = continueItems.firstOrNull()
            shared = AppModel.sharedWithMe(); HomeCache.shared = shared
        }
    }

    LaunchedEffect(profileId) { load() }
    // Back from the player: Continue Watching moved on.
    LaunchedEffect(Nav.returns) { if (Nav.returns > 0) runCatching { AppModel.continueWatching() }.getOrNull()?.let { continueItems = it; HomeCache.continueItems = it } }

    val feed = buildList {
        personal.newEpisodes?.let { add(it) }
        if (shared.isNotEmpty()) add(LoadedRow("sent-to-you", "Sent to you", shared))
        personal.topPicks?.let { add(it) }
        if (myList.isNotEmpty()) add(LoadedRow("my-list", "My List", myList))
        val because = personal.because.toMutableList()
        rows.forEachIndexed { index, row -> add(row); if (index % 2 == 0 && because.isNotEmpty()) add(because.removeAt(0)) }
        addAll(because)
    }
    val hero = spotlight ?: personal.topPicks?.items?.firstOrNull { it.backdrop != null } ?: rows.firstOrNull()?.items?.firstOrNull { it.backdrop != null }

    PivotScroll(fraction = 0.22f) {
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize().focusRestorer(), contentPadding = PaddingValues(bottom = 40.dp)) {
            item(key = "hero") { if (hero != null) Hero(hero, listState) else HeroSkeleton() }
            if (continueItems.isNotEmpty()) item(key = "continue") {
                ContinueRow("Continue Watching for $name", continueItems, onLongClick = { menuFor = it })
            }
            items(feed, key = { it.id }) { row -> TitleRow(row, Nav::open) }
            if (loading && rows.isEmpty()) items(3) { RowSkeleton() }
            else if (!loading && rows.isEmpty() && continueItems.isEmpty()) item {
                ProblemView("Couldn't load your rows. Check the TV's internet connection.") { scope.launch { load() } }
            }
        }
    }

    menuFor?.let { item ->
        ActionSheet(item.title.name, onDismiss = { menuFor = null }) {
            Pill("Resume", icon = Icons.Rounded.PlayArrow) { menuFor = null; Nav.play(item.playRequest) }
            Pill("Details & episodes", icon = Icons.Rounded.Info) { menuFor = null; Nav.open(item.title) }
            Pill("Remove from row", icon = Icons.Rounded.Close) {
                menuFor = null
                continueItems = continueItems.filter { it.id != item.id }; HomeCache.continueItems = continueItems
                scope.launch { AppModel.removeFromContinue(item.title) }
            }
        }
    }
}

@Composable
fun BrowseScreen(kind: MediaKind) {
    var rows by remember(kind) { mutableStateOf(BrowseCache.rows[kind].orEmpty()) }
    var loading by remember(kind) { mutableStateOf(rows.isEmpty()) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    ReportTop(listState)
    suspend fun load() {
        loading = true
        rows = Catalog.loadAll(Rows.browse(kind, AppModel.isKids), AppModel.isKids)
        BrowseCache.rows[kind] = rows
        loading = false
    }
    LaunchedEffect(kind, AppModel.profile?.id) { if (rows.isEmpty()) load() }
    PivotScroll(fraction = 0.22f) {
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize().focusRestorer(), contentPadding = PaddingValues(bottom = 40.dp)) {
            item(key = "hero") { rows.firstOrNull()?.items?.firstOrNull { it.backdrop != null }?.let { Hero(it, listState) } ?: HeroSkeleton() }
            items(rows, key = { it.id }) { TitleRow(it, Nav::open) }
            if (loading && rows.isEmpty()) items(3) { RowSkeleton() }
            else if (!loading && rows.isEmpty()) item {
                ProblemView("Couldn't load ${if (kind == MediaKind.MOVIE) "movies" else "series"} right now.") { scope.launch { load() } }
            }
        }
    }
}

private object BrowseCache { val rows = HashMap<MediaKind, List<LoadedRow>>() }

// The big spotlight at the top of Home / Movies / Series: edge to edge,
// first row peeking below it.
@Composable
fun Hero(title: Title, listState: LazyListState? = null) {
    val scope = rememberCoroutineScope()
    // Focus on the spotlight's buttons brings the whole spotlight back into view.
    Box(Modifier.fillMaxWidth().height(340.dp).onFocusChanged { if (it.hasFocus && listState != null) scope.launch { listState.animateScrollToItem(0) } }) {
        Art(Tmdb.resized(title.backdrop, Tmdb.FULL_SCREEN), title.name, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Palette.background.copy(alpha = 0.95f), Palette.background.copy(alpha = 0.25f), Color.Transparent))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to Color.Transparent, 1f to Palette.background)))
        Column(Modifier.align(Alignment.BottomStart).padding(start = Dimens.edge, bottom = 12.dp).widthIn(max = 430.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title.name, style = Type.hero, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (title.metaLine.isNotEmpty()) Text(title.metaLine, style = Type.callout, color = Palette.muted)
            title.overview?.takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.callout, color = Color.White.copy(alpha = 0.85f), maxLines = 3, overflow = TextOverflow.Ellipsis) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 4.dp)) {
                // Picks up where this profile left off (any device), else the start.
                if (title.tmdbId != null) ActionButton("Play", Icons.Rounded.PlayArrow, primary = true) {
                    scope.launch {
                        val resume = AppModel.resumePoint(title)
                        val tv = title.kind == MediaKind.TV
                        Nav.play(PlayRequest(title, if (tv) resume?.currentSeason ?: 1 else null, if (tv) resume?.currentEpisode ?: 1 else null, resume?.positionSeconds))
                    }
                }
                ActionButton("More info", Icons.Rounded.Info) { Nav.open(title) }
            }
        }
    }
}

@Composable
private fun HeroSkeleton() {
    Box(Modifier.fillMaxWidth().height(340.dp).background(Palette.surface))
}

@Composable
fun ContinueRow(heading: String, items: List<ContinueItem>, onLongClick: (ContinueItem) -> Unit) {
    val scope = rememberCoroutineScope()
    var warm by remember { mutableStateOf<Job?>(null) }
    Column {
        SectionTitle(heading)
        PivotScroll(offset = Dimens.edge) {
            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                items(items, key = { it.id }) { item ->
                    ContinueCard(item, onClick = { Nav.play(item.playRequest) }, onLongClick = { onLongClick(item) }, onFocus = {
                        // Resting on a card for a moment preloads it.
                        warm?.cancel()
                        warm = scope.launch { delay(700); Warmup.prepare(item.playRequest) }
                    })
                }
            }
        }
        Text("OK to resume · hold OK for details", style = Type.caption, color = Palette.muted, modifier = Modifier.padding(start = Dimens.edge))
    }
}

@Composable
fun ContinueCard(item: ContinueItem, onClick: () -> Unit, onLongClick: (() -> Unit)? = null, onFocus: (() -> Unit)? = null) {
    FocusCard(onClick = onClick, onLongClick = onLongClick, onFocus = onFocus, modifier = Modifier.width(Dimens.wideW).height(Dimens.wideH)) {
        Art(item.title.backdrop ?: item.title.poster, item.title.name, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.35f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.88f))))
        Column(Modifier.align(Alignment.BottomStart).padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(item.title.name, style = Type.headline.copy(fontSize = 13.sp()), maxLines = 1, overflow = TextOverflow.Ellipsis)
            item.episodeLabel?.let { label ->
                Text(listOfNotNull(label, item.seasonNote).joinToString(" · "), style = Type.caption, color = Palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            item.progress?.let { ProgressBar(it, Modifier.fillMaxWidth()) }
        }
        item.newEpisode?.let { Badge("New $it", Modifier.align(Alignment.TopEnd).padding(6.dp)) }
    }
}

private fun Int.sp() = androidx.compose.ui.unit.TextUnit(this.toFloat(), androidx.compose.ui.unit.TextUnitType.Sp)

// A small menu over the page (press-and-hold actions), Back closes it.
@Composable
fun ActionSheet(heading: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        val focus = androidx.compose.ui.platform.LocalFocusManager.current
        Column(
            Modifier.background(Palette.raised, androidx.compose.foundation.shape.RoundedCornerShape(16.dp)).padding(22.dp).widthIn(min = 260.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(heading, style = Type.section, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.size(2.dp))
            content()
        }
        // Focus starts on the first action.
        LaunchedEffect(Unit) { delay(80); focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Enter) }
    }
}
