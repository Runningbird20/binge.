package com.binge.tv.ui

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.ClosedCaption
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.People
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
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.ListItem
import androidx.tv.material3.ListItemDefaults
import androidx.tv.material3.Text
import com.binge.tv.BuildConfig
import com.binge.tv.data.AppModel
import com.binge.tv.data.Catalog
import com.binge.tv.data.Config
import com.binge.tv.data.ContinueItem
import com.binge.tv.data.ContinueRow
import com.binge.tv.data.IsoDate
import com.binge.tv.data.MediaKind
import com.binge.tv.data.PlaybackPrefs
import com.binge.tv.data.Prefs
import com.binge.tv.data.QualityPreference
import com.binge.tv.data.Supabase
import com.binge.tv.data.Title
import com.binge.tv.data.Tmdb
import com.binge.tv.data.TmdbDetails
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun MeScreen() {
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { TabChrome.atTop = true }
    Row(Modifier.fillMaxSize().padding(start = Dimens.edge, end = Dimens.edge, top = 80.dp), horizontalArrangement = Arrangement.spacedBy(46.dp)) {
        Column(Modifier.width(250.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            AppModel.profile?.let { ProfileAvatar(it, 90.dp) }
            AppModel.session?.email?.let { Text("Signed in as $it", style = Type.callout, color = Palette.muted) }
            if (AppModel.profiles.size > 1) Pill("Switch profile", icon = Icons.Rounded.People) { AppModel.switchProfile() }
            if (AppModel.isSignedIn) Pill("Sign out", icon = Icons.AutoMirrored.Rounded.Logout) { scope.launch { AppModel.signOut() } }
            Spacer(Modifier.weight(1f))
            Text("binge. for Fire TV ${BuildConfig.VERSION_NAME}", style = Type.caption, color = Palette.muted, modifier = Modifier.padding(bottom = 24.dp))
        }
        // A plain list, like Android TV settings: no tile grid.
        LazyColumn(Modifier.weight(1f).focusRestorer(), verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(bottom = 30.dp)) {
            item { MeRow("History", "Everything you've started", Icons.Rounded.History) { Nav.push(Screen.History) } }
            item { MeRow("Calendar", "Upcoming episodes and releases", Icons.Rounded.CalendarMonth) { Nav.push(Screen.Calendar) } }
            item { MeRow("Wrapped", "Your year on binge.", Icons.Rounded.AutoAwesome) { Nav.push(Screen.Wrapped) } }
            item { MeRow("Playback & accessibility", "Quality, audio, subtitles, larger text", Icons.Rounded.ClosedCaption) { Nav.push(Screen.Settings) } }
            item { Text("Books, manga and account settings are on ${Config.siteHost}.", style = Type.caption, color = Palette.muted, modifier = Modifier.padding(top = 10.dp, start = 4.dp)) }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun MeRow(title: String, detail: String, icon: ImageVector, onClick: () -> Unit) {
    ListItem(
        selected = false, onClick = onClick,
        headlineContent = { Text(title, style = Type.headline) },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(detail, style = Type.callout, color = androidx.tv.material3.LocalContentColor.current.copy(alpha = 0.62f))
                Icon(Icons.Rounded.ChevronRight, null, modifier = Modifier.size(18.dp))
            }
        },
        leadingContent = { Icon(icon, null, modifier = Modifier.size(20.dp)) },
        colors = ListItemDefaults.colors(containerColor = Color.White.copy(alpha = 0.05f), focusedContainerColor = Color.White, focusedContentColor = Color.Black),
        shape = ListItemDefaults.shape(RoundedCornerShape(10.dp)),
    )
}

@Composable
private fun PageHeader(title: String, subtitle: String) {
    Column(Modifier.padding(start = Dimens.edge, end = Dimens.edge, top = 28.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = Type.page)
        Text(subtitle, style = Type.callout, color = Palette.muted)
    }
}

// MARK: History

@Composable
fun HistoryScreen() {
    var items by remember { mutableStateOf<List<Pair<ContinueItem, Long?>>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<ContinueItem?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        val rows: List<ContinueRow> = runCatching {
            Supabase.selectAs<List<ContinueRow>>("continue_watching", listOf("select" to ContinueRow.COLUMNS, "media_type" to "in.(movie,tv_show)",
                "order" to "updated_at.desc", "limit" to "120") + AppModel.ownerFilter)
        }.getOrDefault(emptyList())
        val m = async { runCatching { Catalog.titles(MediaKind.MOVIE, rows.filter { it.mediaType == "movie" }.map { it.mediaId }) }.getOrDefault(emptyMap()) }
        val t = async { runCatching { Catalog.titles(MediaKind.TV, rows.filter { it.mediaType == "tv_show" }.map { it.mediaId }) }.getOrDefault(emptyMap()) }
        val movies = m.await(); val shows = t.await()
        val seen = HashSet<String>()
        val base = rows.mapNotNull { row ->
            val title = (if (row.mediaType == "movie") movies[row.mediaId] else shows[row.mediaId]) ?: return@mapNotNull null
            if (!seen.add(title.id)) null else ContinueItem(title, row.currentSeason, row.currentEpisode, row.positionSeconds, row.durationSeconds) to row.updatedMillis
        }
        // Wide art for the cards (cached TMDB lookups).
        items = base.map { (item, at) ->
            async {
                val id = item.title.tmdbId ?: return@async item to at
                val backdrop = runCatching { Tmdb.get<TmdbDetails>("${item.title.kind.tmdbPath}/$id") }.getOrNull()?.backdropPath
                item.copy(title = item.title.copy(backdrop = Tmdb.image(backdrop, Tmdb.WIDE) ?: item.title.backdrop)) to at
            }
        }.awaitAll()
        loaded = true
    }
    LazyVerticalGrid(GridCells.Fixed(4), Modifier.fillMaxSize().focusRestorer(), contentPadding = PaddingValues(start = Dimens.edge, end = Dimens.edge, bottom = 40.dp),
        horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.padding(start = 0.dp)) { Column { PageHeader("History", "Everything you've started, newest first. Hold OK to remove something.") } } }
        if (!loaded) item(span = { GridItemSpan(maxLineSpan) }) { RowSkeleton(wide = true) }
        if (loaded && items.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
            Text("Nothing here yet. Anything you start playing on the TV, phone or web shows up here.", style = Type.body, color = Palette.muted)
        }
        items(items, key = { it.first.id }) { (item, at) ->
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                ContinueCard(item, onClick = { Nav.play(item.playRequest) }, onLongClick = { menuFor = item })
                at?.let { Text(relative(it), style = Type.caption, color = Palette.muted) }
            }
        }
    }
    menuFor?.let { item ->
        ActionSheet(item.title.name, onDismiss = { menuFor = null }) {
            Pill("Details", icon = Icons.Rounded.Info) { menuFor = null; Nav.open(item.title) }
            Pill("Remove from history", icon = Icons.Rounded.Delete) {
                menuFor = null
                items = items.filter { it.first.id != item.id }
                // Same as the site: removes the progress and the watched episodes.
                scope.launch {
                    AppModel.removeFromContinue(item.title)
                    if (item.title.kind == MediaKind.TV) runCatching {
                        Supabase.delete("episode_progress", listOf("media_id" to "eq.${item.title.dbId}") + AppModel.ownerFilter)
                    }
                }
            }
        }
    }
}

private fun relative(ms: Long): String {
    val minutes = (System.currentTimeMillis() - ms) / 60_000
    return when {
        minutes < 60 -> "${maxOf(1, minutes)} min ago"
        minutes < 24 * 60 -> "${minutes / 60} hr ago"
        minutes < 48 * 60 -> "Yesterday"
        minutes < 7 * 24 * 60 -> "${minutes / (24 * 60)} days ago"
        else -> SimpleDateFormat("MMM d", Locale.US).format(ms)
    }
}

// MARK: Calendar

@Composable
fun CalendarScreen() {
    var days by remember { mutableStateOf<List<Pair<Long, List<Pair<Title, String>>>>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val continuing = runCatching { AppModel.continueWatching() }.getOrDefault(emptyList()).map { it.title }
        val list = runCatching { AppModel.myList() }.getOrDefault(emptyList())
        val titles = (continuing + list).distinctBy { it.id }.filter { it.tmdbId != null }
        val today = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        val found = titles.map { title ->
            async {
                val details = runCatching { Tmdb.get<TmdbDetails>("${title.kind.tmdbPath}/${title.tmdbId}") }.getOrNull() ?: return@async null
                val next = details.nextEpisodeToAir
                if (title.kind == MediaKind.TV && next != null) IsoDate.day(next.airDate)?.let { return@async Triple(it, title, "S${next.seasonNumber}:E${next.episodeNumber}" + (next.name?.let { n -> " · $n" } ?: "")) }
                if (title.kind == MediaKind.MOVIE) IsoDate.day(details.releaseDate)?.takeIf { it >= today }?.let { return@async Triple(it, title, "In theaters / out") }
                null
            }
        }.awaitAll().filterNotNull().filter { it.first >= today }
        days = found.groupBy { it.first }.toSortedMap().entries.take(30).map { (day, entries) -> day to entries.map { it.second to it.third } }
        loaded = true
    }
    PivotScroll(fraction = 0.25f) {
        LazyColumn(Modifier.fillMaxSize().focusRestorer(), contentPadding = PaddingValues(bottom = 40.dp)) {
            item { PageHeader("Release calendar", "New episodes of what you watch and your list, and movies you're waiting for.") }
            if (!loaded) item { RowSkeleton() }
            if (loaded && days.isEmpty()) item { Text("Nothing scheduled yet. Add shows to My List to see their next episodes here.", style = Type.body, color = Palette.muted, modifier = Modifier.padding(Dimens.edge)) }
            items(days, key = { it.first }) { (day, entries) ->
                Column {
                    SectionTitle(dayLabel(day))
                    PivotScroll(offset = Dimens.edge) {
                        LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                            items(entries, key = { it.first.id }) { (title, label) ->
                                Column(Modifier.width(Dimens.posterW), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                    PosterCard(title, Nav::open)
                                    Text(label, style = Type.caption, color = Palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun dayLabel(ms: Long): String {
    val cal = Calendar.getInstance(); val today = cal.get(Calendar.DAY_OF_YEAR); val year = cal.get(Calendar.YEAR)
    cal.timeInMillis = ms
    if (cal.get(Calendar.YEAR) == year && cal.get(Calendar.DAY_OF_YEAR) == today) return "Today"
    if (cal.get(Calendar.YEAR) == year && cal.get(Calendar.DAY_OF_YEAR) == today + 1) return "Tomorrow"
    return SimpleDateFormat("EEEE, MMM d", Locale.US).format(ms)
}

// MARK: Playback & accessibility settings

@Composable
fun SettingsScreen() {
    val scope = rememberCoroutineScope()
    var audio by remember { mutableStateOf(PlaybackPrefs.audio) }
    var subtitle by remember { mutableStateOf(PlaybackPrefs.subtitle) }
    @Suppress("UNUSED_VARIABLE") val version = Prefs.version // recompose on change
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(60); runCatching { first.requestFocus() } }
    PivotScroll(fraction = 0.3f) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            item { PageHeader("Playback & accessibility", "Audio and subtitle languages are saved to your profile, so the website uses them too.") }
            item { SettingRow("Audio language", "Servers viewers reported in this language are tried first.", PlaybackPrefs.audioChoices.map { it.first to it.second }, audio, Modifier.focusRequester(first)) {
                audio = it; scope.launch { AppModel.savePrefs(audio = it) } } }
            item { SettingRow("Subtitles", "From OpenSubtitles, drawn the same on every server.", PlaybackPrefs.subtitleChoices, subtitle) {
                subtitle = it; scope.launch { AppModel.savePrefs(subtitle = it) } } }
            item { SettingRow("Quality", "Best quality looks for a sharper stream for a moment after a video starts.",
                QualityPreference.entries.map { it.raw to it.label }, QualityPreference.current.raw) { Prefs.set("quality", it) } }
            item { SettingRow("Subtitle size", "How big subtitles are drawn over the video.", PlaybackPrefs.captionSizes.map { "${it.first}" to it.second },
                "${PlaybackPrefs.captionSize}") { Prefs.set("captionSize", it.toInt()) } }
            item { SettingRow("Subtitle background", "A box behind the words makes them easier to read on bright scenes.", PlaybackPrefs.captionBackgrounds,
                PlaybackPrefs.captionBackground) { Prefs.set("captionBackground", it) } }
            item { OnOff("Skip intro button", "Shown during an episode's intro. Press ▼ while it shows to hide it for that episode.", PlaybackPrefs.skipIntroButton) { Prefs.set("skipIntroButton", it) } }
            item { SettingRow("Multiview layout", "With 2 or 3 games: equal tiles, or one big game with the others stacked beside it.",
                listOf("grid" to "Equal tiles", "main" to "One big, others beside"), PlaybackPrefs.multiviewLayout) { Prefs.set("multiviewLayout", it) } }
            item { OnOff("Audio description", "Picks a described audio track automatically when a server has one.", PlaybackPrefs.audioDescription) { Prefs.set("audioDescription", it) } }
            item { OnOff("Larger text", "Bigger text across the whole app.", PlaybackPrefs.largeText) { Prefs.set("largeText", it) } }
            item { OnOff("Ambient mode", "Artwork from your rows after a few idle minutes, or a long pause.", PlaybackPrefs.ambient) { Prefs.set("ambient", it) } }
        }
    }
}

@Composable
private fun SettingRow(title: String, note: String, choices: List<Pair<String, String>>, selected: String, modifier: Modifier = Modifier, onPick: (String) -> Unit) {
    Column(Modifier.padding(vertical = 6.dp)) {
        Row(Modifier.padding(horizontal = Dimens.edge), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = Type.section.copy(fontSize = androidx.compose.ui.unit.TextUnit(16f, androidx.compose.ui.unit.TextUnitType.Sp)))
            Text(note, style = Type.caption, color = Palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        PivotScroll(offset = Dimens.edge) {
            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(choices, key = { it.first }) { (value, label) ->
                    Pill(label, selected = value == selected, modifier = if (value == choices.first().first) modifier else Modifier) { onPick(value) }
                }
            }
        }
    }
}

@Composable
private fun OnOff(title: String, note: String, value: Boolean, onChange: (Boolean) -> Unit) =
    SettingRow(title, note, listOf("on" to "On", "off" to "Off"), if (value) "on" else "off") { onChange(it == "on") }
