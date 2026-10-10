package com.binge.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.binge.tv.data.AppModel
import com.binge.tv.data.Catalog
import com.binge.tv.data.ContinueRow
import com.binge.tv.data.Franchises
import com.binge.tv.data.LoadedRow
import com.binge.tv.data.MediaKind
import com.binge.tv.data.OutsideRatings
import com.binge.tv.data.RowSpec
import com.binge.tv.data.Title
import com.binge.tv.data.Tmdb
import com.binge.tv.data.TmdbDetails
import com.binge.tv.data.TmdbSeason
import com.binge.tv.player.PlayRequest
import com.binge.tv.player.Warmup
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

@Composable
fun TitleScreen(title: Title, active: Boolean) {
    var details by remember { mutableStateOf<TmdbDetails?>(null) }
    var resume by remember { mutableStateOf<ContinueRow?>(null) }
    var season by remember { mutableStateOf<Int?>(null) }
    var episodes by remember { mutableStateOf<List<TmdbSeason.Episode>>(emptyList()) }
    var more by remember { mutableStateOf<List<Title>>(emptyList()) }
    var outside by remember { mutableStateOf<OutsideRatings?>(null) }
    var myStars by remember { mutableStateOf<Double?>(null) }
    var franchise by remember { mutableStateOf<Franchises.Order?>(null) }
    var previously by remember { mutableStateOf<List<TmdbSeason.Episode>>(emptyList()) }
    var rating by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var sentTo by remember { mutableStateOf<String?>(null) }
    var listBusy by remember { mutableStateOf(false) }
    var listError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val playFocus = remember { FocusRequester() }

    val seasons = details?.seasons.orEmpty().filter { (it.episodeCount ?: 0) > 0 }.let { all -> all.filter { it.seasonNumber > 0 }.ifEmpty { all } }
    val resumeProgress = resume?.let { r -> if (r.positionSeconds != null && r.durationSeconds != null && r.durationSeconds > 0 && r.positionSeconds > 30) (r.positionSeconds / r.durationSeconds).toFloat() else null }
    val playLabel = when {
        title.kind == MediaKind.TV && resume?.currentSeason != null && resume?.currentEpisode != null -> "Resume S${resume?.currentSeason}:E${resume?.currentEpisode}"
        resumeProgress != null -> "Resume"
        title.kind == MediaKind.TV -> "Play S1:E1"
        else -> "Play"
    }

    fun start(s: Int?, e: Int?) {
        val sameAsResume = title.kind == MediaKind.MOVIE || (s == resume?.currentSeason && e == resume?.currentEpisode)
        Nav.play(PlayRequest(title, s, e, if (sameAsResume) resume?.positionSeconds else null, seasons))
    }
    fun play() {
        if (title.kind == MediaKind.TV) start(resume?.currentSeason ?: seasons.firstOrNull()?.seasonNumber ?: 1, resume?.currentEpisode ?: 1) else start(null, null)
    }

    LaunchedEffect(title.id) {
        val resumeTask = async { AppModel.resumePoint(title) }
        title.tmdbId?.let { id ->
            details = runCatching { Tmdb.get<TmdbDetails>("${title.kind.tmdbPath}/$id", mapOf("append_to_response" to "credits,images", "include_image_language" to "en,null")) }.getOrNull()
        }
        resume = resumeTask.await()
        // The season list comes with the details just loaded (not the first composition's empty one).
        val loadedSeasons = details?.seasons.orEmpty().filter { (it.episodeCount ?: 0) > 0 }.let { all -> all.filter { it.seasonNumber > 0 }.ifEmpty { all } }
        if (title.kind == MediaKind.TV && season == null) season = resume?.currentSeason ?: loadedSeasons.firstOrNull()?.seasonNumber
        // Start loading what Play will play while you read the page.
        val s = if (title.kind == MediaKind.TV) resume?.currentSeason ?: loadedSeasons.firstOrNull()?.seasonNumber ?: 1 else null
        val e = if (title.kind == MediaKind.TV) resume?.currentEpisode ?: 1 else null
        Warmup.prepare(PlayRequest(title, s, e, resume?.positionSeconds, loadedSeasons))
        val outsideTask = async { OutsideRatings.load(title) }
        val starsTask = async { AppModel.myRating(title) }
        val franchiseTask = async { Franchises.find(title, AppModel.isKids) }
        val tmdbId = title.tmdbId
        if (title.kind == MediaKind.TV && tmdbId != null) previously = loadPreviously(tmdbId, resume)
        outside = outsideTask.await(); myStars = starsTask.await(); franchise = franchiseTask.await()
        if (tmdbId != null) more = Catalog.load(RowSpec("more", "More Like This", title.kind, "${title.kind.tmdbPath}/$tmdbId/recommendations"), AppModel.isKids)
            ?.items.orEmpty().filter { it.id != title.id }
    }
    LaunchedEffect(season) {
        val s = season ?: return@LaunchedEffect
        val id = title.tmdbId ?: return@LaunchedEffect
        episodes = runCatching { Tmdb.get<TmdbSeason>("tv/$id/season/$s") }.getOrNull()?.episodes.orEmpty()
    }
    LaunchedEffect(active) { if (active) { kotlinx.coroutines.delay(60); runCatching { playFocus.requestFocus() } } }
    LaunchedEffect(Nav.returns) { if (active) resume = AppModel.resumePoint(title) }

    Box(Modifier.fillMaxSize()) {
        // Full-screen backdrop behind the page.
        Art(Tmdb.image(details?.backdropPath, Tmdb.FULL_SCREEN) ?: Tmdb.resized(title.backdrop, Tmdb.FULL_SCREEN), "", Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Palette.background, Palette.background.copy(alpha = 0.75f), Color.Transparent))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Palette.background)))

        PivotScroll(fraction = 0.3f) {
            LazyColumn(Modifier.fillMaxSize().focusRestorer(), contentPadding = PaddingValues(bottom = 50.dp)) {
                item(key = "header") {
                    Column(Modifier.fillMaxWidth().heightIn(min = 400.dp).padding(start = Dimens.edge, end = Dimens.edge, top = 40.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom)) {
                        val logo = Tmdb.image(details?.logoPath, Tmdb.WIDE)
                        if (logo != null) AsyncImage(model = logo, contentDescription = title.name, contentScale = ContentScale.Fit,
                            alignment = Alignment.CenterStart, modifier = Modifier.widthIn(max = 310.dp).heightIn(max = 100.dp))
                        else Text(title.name, style = Type.hero.copy(fontSize = androidx.compose.ui.unit.TextUnit(36f, androidx.compose.ui.unit.TextUnitType.Sp)), maxLines = 2)
                        Text(metaLine(title, details), style = Type.callout.copy(fontWeight = FontWeight.SemiBold), color = Palette.muted)
                        if (outside != null || myStars != null) Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            outside?.let { OutsideRatingsRow(it) }
                            myStars?.let { Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Rounded.Star, null, tint = Palette.gold, modifier = Modifier.size(14.dp))
                                Text(" You rated it ${Math.round(it)} of 5", style = Type.callout.copy(fontWeight = FontWeight.Bold), color = Palette.gold)
                            } }
                        }
                        details?.tagline?.takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.headline.copy(fontStyle = FontStyle.Italic), color = Color.White.copy(alpha = 0.85f)) }
                        (details?.overview ?: title.overview)?.takeIf { it.isNotEmpty() }?.let {
                            Text(it, style = Type.body, color = Color.White.copy(alpha = 0.88f), maxLines = 5, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 520.dp))
                        }
                        details?.credits?.cast?.take(5)?.map { it.name }?.takeIf { it.isNotEmpty() }?.let {
                            Text("Starring ${it.joinToString(", ")}", style = Type.callout, color = Palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 520.dp))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
                            ActionButton(playLabel, Icons.Rounded.PlayArrow, Modifier.focusRequester(playFocus), enabled = title.tmdbId != null, primary = true) { play() }
                            val inList = AppModel.isInList(title)
                            ActionButton(if (inList) "In My List" else "My List", if (inList) Icons.Rounded.Check else Icons.Rounded.Add, enabled = !listBusy && AppModel.isSignedIn) {
                                listBusy = true; listError = null
                                scope.launch {
                                    try { AppModel.toggleList(title) } catch (e: Exception) { if (!AppModel.handle(e)) listError = e.message }
                                    listBusy = false
                                }
                            }
                            ActionButton(if (myStars == null) "Rate" else "Rated", if (myStars == null) Icons.Rounded.StarBorder else Icons.Rounded.Star, enabled = AppModel.isSignedIn) { rating = true }
                            if (AppModel.isSignedIn && AppModel.profiles.size > 1)
                                ActionButton(sentTo?.let { "Sent to $it" } ?: "Send to…", if (sentTo == null) Icons.Rounded.Send else Icons.Rounded.Check) { sending = true }
                            resumeProgress?.let { ProgressBar(it, Modifier.width(110.dp)) }
                        }
                        listError?.let { Text(it, style = Type.caption, color = Palette.error) }
                    }
                }
                if (previously.isNotEmpty()) item(key = "previously") {
                    EpisodeStrip("Previously on…", "It's been a while: the last few episodes before yours.", previously, title.backdrop, null) { start(it.seasonNumber, it.episodeNumber) }
                }
                if (title.kind == MediaKind.TV && seasons.isNotEmpty()) {
                    item(key = "seasons") {
                        PivotScroll(offset = Dimens.edge) {
                            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                items(seasons, key = { it.seasonNumber }) { s ->
                                    Pill(s.name ?: "Season ${s.seasonNumber}", selected = season == s.seasonNumber) { season = s.seasonNumber }
                                }
                            }
                        }
                    }
                    item(key = "episodes") {
                        EpisodeStrip(null, null, episodes, title.backdrop, resume?.let { r -> r.currentSeason?.let { s -> r.currentEpisode?.let { s to it } } }) { start(it.seasonNumber, it.episodeNumber) }
                    }
                }
                franchise?.let { order -> item(key = "franchise") { FranchiseSection(order) } }
                if (more.isNotEmpty()) item(key = "more") { TitleRow(LoadedRow("more", "More Like This", more), Nav::open) }
            }
        }
    }

    if (rating) ActionSheet("Rate ${title.name}", onDismiss = { rating = false }) {
        Text("Applies to every rating category, like the website's quick rating.", style = Type.caption, color = Palette.muted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (1..5).forEach { stars ->
                Pill("$stars★", selected = myStars?.let { Math.round(it).toInt() == stars } ?: false) {
                    rating = false
                    scope.launch { runCatching { AppModel.rate(title, stars) }.onSuccess { myStars = stars.toDouble() } }
                }
            }
        }
    }
    if (sending) ActionSheet("Send ${title.name} to", onDismiss = { sending = false }) {
        AppModel.profiles.filter { it.id != AppModel.profile?.id }.forEach { profile ->
            Pill(profile.name) {
                sending = false
                scope.launch { if (runCatching { AppModel.send(title, profile) }.isSuccess) sentTo = profile.name }
            }
        }
    }
}

private fun metaLine(title: Title, details: TmdbDetails?): String = buildList {
    title.year?.let { add("$it") }
    details?.voteAverage?.takeIf { it > 0 }?.let { add("TMDB %.1f".format(it)) }
    details?.runtime?.takeIf { it > 0 }?.let { add(if (it >= 60) "${it / 60}h ${it % 60}m" else "${it}m") }
    details?.numberOfSeasons?.takeIf { it > 0 }?.let { add(if (it == 1) "1 season" else "$it seasons") }
    title.ageRating?.let { add(it) }
    details?.genres?.take(3)?.map { it.name }?.takeIf { it.isNotEmpty() }?.let { add(it.joinToString(", ")) }
    if (title.comingSoon) add("Coming soon")
}.joinToString("  ·  ")

// "Previously on…": back after 14+ days, the 3 episodes before the one you're on.
private suspend fun loadPreviously(tmdbId: Int, resume: ContinueRow?): List<TmdbSeason.Episode> {
    val r = resume ?: return emptyList()
    val updated = r.updatedMillis ?: return emptyList()
    val s = r.currentSeason ?: return emptyList()
    val e = r.currentEpisode ?: return emptyList()
    if (System.currentTimeMillis() - updated < 14 * 86_400_000L || e + s <= 2) return emptyList()
    var collected = runCatching { Tmdb.get<TmdbSeason>("tv/$tmdbId/season/$s") }.getOrNull()?.episodes.orEmpty().filter { it.episodeNumber < e }
    if (collected.size < 3 && s > 1) collected = runCatching { Tmdb.get<TmdbSeason>("tv/$tmdbId/season/${s - 1}") }.getOrNull()?.episodes.orEmpty() + collected
    return collected.takeLast(3)
}

@Composable
private fun EpisodeStrip(heading: String?, subtitle: String?, episodes: List<TmdbSeason.Episode>, fallback: String?, current: Pair<Int, Int>?, onPlay: (TmdbSeason.Episode) -> Unit) {
    Column {
        if (heading != null) SectionTitle(heading, subtitle)
        PivotScroll(offset = Dimens.edge) {
            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                items(episodes, key = { it.id }) { episode ->
                    Column(Modifier.width(200.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FocusCard(onClick = { onPlay(episode) }, modifier = Modifier.width(200.dp).height(112.dp)) {
                            Art(Tmdb.image(episode.stillPath, Tmdb.WIDE) ?: fallback, "Episode ${episode.episodeNumber}", Modifier.fillMaxSize())
                            if (current == episode.seasonNumber to episode.episodeNumber) Badge("Up next", Modifier.align(Alignment.BottomStart).padding(6.dp))
                        }
                        Text("${episode.episodeNumber}. ${episode.name ?: "Episode ${episode.episodeNumber}"}", style = Type.callout.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOfNotNull(episode.runtime?.let { "${it}m" }, episode.airDate).joinToString("  ·  "), style = Type.caption, color = Palette.muted)
                    }
                }
            }
        }
    }
}

@Composable
private fun OutsideRatingsRow(r: OutsideRatings) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        r.imdbRating?.let { Text("IMDb ${"%.1f".format(it)}", style = Type.callout.copy(fontWeight = FontWeight.Bold)) }
        r.rottenTomatoes?.let { Text("Rotten Tomatoes $it%", style = Type.callout.copy(fontWeight = FontWeight.Bold)) }
        r.metacritic?.let { Text("Metacritic $it", style = Type.callout.copy(fontWeight = FontWeight.Bold)) }
    }
}

@Composable
private fun FranchiseSection(order: Franchises.Order) {
    var story by remember { mutableStateOf(false) }
    Column {
        Row(Modifier.padding(horizontal = Dimens.edge), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${order.name} in order", style = Type.section)
            if (order.story != null) {
                Pill("Release order", selected = !story) { story = false }
                Pill("Story order", selected = story) { story = true }
            }
        }
        TitleRow(LoadedRow("franchise", "", if (story) order.story ?: order.release else order.release), Nav::open)
    }
}
