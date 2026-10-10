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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SportsBaseball
import androidx.compose.material.icons.rounded.SportsBasketball
import androidx.compose.material.icons.rounded.SportsCricket
import androidx.compose.material.icons.rounded.SportsFootball
import androidx.compose.material.icons.rounded.SportsGolf
import androidx.compose.material.icons.rounded.SportsHockey
import androidx.compose.material.icons.rounded.SportsMma
import androidx.compose.material.icons.rounded.SportsMotorsports
import androidx.compose.material.icons.rounded.SportsRugby
import androidx.compose.material.icons.rounded.SportsSoccer
import androidx.compose.material.icons.rounded.SportsTennis
import androidx.compose.material.icons.rounded.SportsVolleyball
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.binge.tv.data.League
import com.binge.tv.data.MediaKind
import com.binge.tv.data.Scoreboard
import com.binge.tv.data.SportGame
import com.binge.tv.data.SportsFeed
import com.binge.tv.data.Title
import com.binge.tv.player.PlayRequest
import com.binge.tv.player.StreamServer
import com.binge.tv.player.Warmup
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

fun sportIcon(category: String): ImageVector = when (category) {
    "American Football" -> Icons.Rounded.SportsFootball
    "Basketball" -> Icons.Rounded.SportsBasketball
    "Soccer" -> Icons.Rounded.SportsSoccer
    "Baseball" -> Icons.Rounded.SportsBaseball
    "Hockey" -> Icons.Rounded.SportsHockey
    "Combat Sports" -> Icons.Rounded.SportsMma
    "Tennis" -> Icons.Rounded.SportsTennis
    "Golf" -> Icons.Rounded.SportsGolf
    "Racing" -> Icons.Rounded.SportsMotorsports
    "Rugby", "Australian Football" -> Icons.Rounded.SportsRugby
    "Cricket" -> Icons.Rounded.SportsCricket
    "Volleyball" -> Icons.Rounded.SportsVolleyball
    else -> Icons.Rounded.EmojiEvents
}

fun liveRequest(game: SportGame, servers: List<StreamServer>) =
    PlayRequest(Title(MediaKind.MOVIE, 0, game.title), liveStreams = servers, subtitle = "LIVE · ${game.league}", game = game)

fun whenLabel(ms: Long): String {
    val cal = Calendar.getInstance(); val today = cal.get(Calendar.DAY_OF_YEAR); val year = cal.get(Calendar.YEAR)
    cal.timeInMillis = ms
    val time = SimpleDateFormat("h:mm a", Locale.US).format(ms)
    return when {
        cal.get(Calendar.YEAR) == year && cal.get(Calendar.DAY_OF_YEAR) == today -> "Today $time"
        cal.get(Calendar.YEAR) == year && cal.get(Calendar.DAY_OF_YEAR) == today + 1 -> "Tomorrow $time"
        else -> SimpleDateFormat("EEE h:mm a", Locale.US).format(ms)
    }
}

private object SportsCache { var games: List<SportGame> = emptyList(); var boards: List<Pair<League, List<Scoreboard.Event>>> = emptyList() }

// Mirrors the website's / Apple TV's Sports page: spotlight game, category
// chips, a row per league, 24/7 channels and ESPN scores. Games play right
// here: a game's feeds are raced like movie servers.
@Composable
fun SportsScreen() {
    var games by remember { mutableStateOf(SportsCache.games) }
    var boards by remember { mutableStateOf(SportsCache.boards) }
    var loaded by remember { mutableStateOf(games.isNotEmpty()) }
    var category by remember { mutableStateOf("All") }
    var starting by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var multi by remember { mutableStateOf<List<SportGame>>(emptyList()) }
    var menuFor by remember { mutableStateOf<SportGame?>(null) }
    val scope = rememberCoroutineScope()
    var warm by remember { mutableStateOf<Job?>(null) }
    val listState = rememberLazyListState()
    ReportTop(listState)

    val playable = games.filter { it.streams.isNotEmpty() }
    val categories = listOf("All") + playable.map { it.category }.toSet().filter { it != "Other" }.sorted()
    val filtered = if (category == "All") playable else playable.filter { it.category == category }
    val liveGames = filtered.filter { it.isLive && !it.is247 }
    val soon = System.currentTimeMillis() + 24 * 3_600_000L
    val leagueRows = filtered.filter { !it.is247 && (it.isLive || (it.startsAt ?: Long.MAX_VALUE) < soon) }.groupBy { it.league }
        .map { (league, items) -> league to items.sortedWith(compareBy({ if (it.isLive) 0 else 1 }, { it.startsAt ?: Long.MAX_VALUE })) }
        .sortedWith(compareBy({ -it.second.count { g -> g.isLive } }, { it.second.firstOrNull()?.startsAt ?: Long.MAX_VALUE }))
    val channels = filtered.filter { it.is247 }

    fun tokens(event: Scoreboard.Event): Set<String>? {
        val names = event.competitors.mapNotNull { it.team.displayName ?: it.team.shortDisplayName }
        return if (names.size == 2) SportsFeed.tokens(names[0] to names[1], "") else null
    }
    fun eventFor(game: SportGame): Scoreboard.Event? { val wanted = game.teamTokens ?: return null; return boards.flatMap { it.second }.firstOrNull { tokens(it) == wanted } }
    fun gameFor(event: Scoreboard.Event): SportGame? { val wanted = tokens(event) ?: return null; return playable.firstOrNull { it.teamTokens == wanted } }
    // Spotlight: a game that's really on (ESPN doesn't call it final), with good art.
    val onNow = liveGames.filter { eventFor(it)?.isFinal != true }
    val featured = onNow.firstOrNull { eventFor(it)?.isLive == true && (it.logos != null || it.poster != null) }
        ?: onNow.firstOrNull { it.poster != null || it.logos != null } ?: onNow.firstOrNull() ?: liveGames.firstOrNull()

    fun play(game: SportGame) {
        if (starting != null) return
        warm?.cancel()
        starting = game.id; message = null
        scope.launch {
            val servers = SportsFeed.servers(game)
            starting = null
            if (servers.isEmpty()) message = "Couldn't find a stream for ${game.title} right now." else Nav.play(liveRequest(game, servers))
        }
    }
    // Resting on a live game for a moment starts it in the background, so Play is near-instant.
    fun prewarm(game: SportGame) {
        if (!game.isLive) return
        warm?.cancel()
        warm = scope.launch {
            delay(900)
            val servers = SportsFeed.servers(game)
            if (servers.isNotEmpty()) Warmup.prepare(liveRequest(game, servers))
        }
    }
    fun toggleMulti(game: SportGame) {
        multi = if (game in multi) multi - game else if (multi.size >= 4) { message = "Multiview holds up to 4 games."; multi } else multi + game
        if (multi.size == 1 && game in multi) message = "Added. Add one more game to watch them together."
    }
    fun activate(game: SportGame) = if (game.isLive) play(game) else { message = "${game.title} starts ${game.startsAt?.let(::whenLabel) ?: "soon"}." }

    LaunchedEffect(Unit) {
        while (true) {
            val feed = async { SportsFeed.load() }
            val scores = League.all.map { league -> async { league to Scoreboard.load(league) } }
            games = feed.await(); boards = scores.awaitAll().filter { it.second.isNotEmpty() }
            SportsCache.games = games; SportsCache.boards = boards
            loaded = true
            featured?.let { prewarm(it) }
            com.binge.tv.DebugLaunch.live?.lowercase()?.let { wanted ->
                games.firstOrNull { it.streams.isNotEmpty() && it.isLive && it.title.lowercase().contains(wanted) }?.let { com.binge.tv.DebugLaunch.live = null; play(it) }
            }
            com.binge.tv.DebugLaunch.multi?.lowercase()?.let { wanted ->
                val live = games.filter { it.streams.isNotEmpty() && it.isLive && !it.is247 }
                val picks = wanted.split(",").mapNotNull { word -> live.firstOrNull { it.title.lowercase().contains(word.trim()) } }.distinct()
                if (picks.size >= 2) { com.binge.tv.DebugLaunch.multi = null; Nav.push(Screen.Multiview(picks)) }
            }
            delay(30_000)
        }
    }

    PivotScroll(fraction = 0.22f) {
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize().focusRestorer(), contentPadding = PaddingValues(bottom = 40.dp)) {
            item(key = "spotlight") {
                if (featured != null) Spotlight(featured, eventFor(featured), starting == featured.id, featured in multi, { play(featured) }, { toggleMulti(featured) })
                else if (!loaded) Box(Modifier.fillMaxWidth().height(320.dp).background(Palette.surface))
                else Spacer(Modifier.height(70.dp))
            }
            message?.let { item(key = "message") { Text(it, style = Type.callout.copy(fontWeight = FontWeight.SemiBold), color = Palette.gold, modifier = Modifier.padding(horizontal = Dimens.edge, vertical = 6.dp)) } }
            if (multi.isNotEmpty()) item(key = "multi") {
                Row(Modifier.padding(horizontal = Dimens.edge, vertical = 6.dp).fillMaxWidth().background(Palette.surface, RoundedCornerShape(12.dp)).padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Rounded.GridView, null, modifier = Modifier.size(18.dp))
                    Text(multi.joinToString("  ·  ") { it.title }, style = Type.callout.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Pill("Watch ${multi.size} at once", selected = true, icon = Icons.Rounded.PlayArrow, enabled = multi.size >= 2) { Nav.push(Screen.Multiview(multi)) }
                    Pill("Clear") { multi = emptyList() }
                }
            }
            if (categories.size > 2) item(key = "chips") {
                PivotScroll(offset = Dimens.edge) {
                    LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(categories, key = { it }) { name -> Pill(name, selected = category == name, icon = if (name == "All") null else sportIcon(name)) { category = name } }
                    }
                }
            }
            if (liveGames.isNotEmpty()) item(key = "live") { GameRow("Live Now · ${liveGames.size}", null, liveGames, starting, multi, ::activate, ::prewarm, { menuFor = it }, ::eventFor) }
            items(leagueRows, key = { "league:${it.first}" }) { (league, items) ->
                val liveCount = items.count { it.isLive }
                GameRow(league, if (liveCount > 0) "$liveCount live now" else items.firstOrNull()?.startsAt?.let { "Next: ${whenLabel(it)}" }, items, starting, multi, ::activate, ::prewarm, { menuFor = it }, ::eventFor)
            }
            if (channels.isNotEmpty()) item(key = "channels") { GameRow("24/7 Sports Channels", null, channels, starting, multi, ::activate, ::prewarm, { menuFor = it }, ::eventFor) }
            val scores = boards.flatMap { it.second }.sortedBy { it.sortRank }
            if (category == "All" && scores.isNotEmpty()) item(key = "scores") {
                Column {
                    SectionTitle("Scores")
                    PivotScroll(offset = Dimens.edge) {
                        LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                            items(scores, key = { it.id }) { event ->
                                val game = gameFor(event)
                                ScoreCard(event, game != null) {
                                    if (game != null) play(game) else message = if (event.isFinal) "That game has ended." else "No streams for ${event.shortName ?: "this game"} yet. They usually appear shortly before start."
                                }
                            }
                        }
                    }
                }
            }
            if (loaded && playable.isEmpty() && boards.isNotEmpty()) item {
                Text("Couldn't load the game streams just now. Scores are below; streams usually come back within a minute.", style = Type.callout, color = Palette.muted,
                    modifier = Modifier.padding(horizontal = Dimens.edge, vertical = 6.dp))
            }
            if (loaded && playable.isEmpty() && boards.isEmpty()) item { Text("No games right now. Check back closer to game time.", style = Type.headline, color = Palette.muted, modifier = Modifier.padding(Dimens.edge)) }
        }
    }

    menuFor?.let { game ->
        ActionSheet(game.title, onDismiss = { menuFor = null }) {
            if (game.isLive) Pill("Watch", icon = Icons.Rounded.PlayArrow) { menuFor = null; play(game) }
            Pill(if (game in multi) "Remove from Multiview" else "Add to Multiview", icon = Icons.Rounded.GridView) { menuFor = null; toggleMulti(game) }
        }
    }
}

@Composable
private fun GameRow(heading: String, subtitle: String?, games: List<SportGame>, starting: String?, multi: List<SportGame>,
                    activate: (SportGame) -> Unit, prewarm: (SportGame) -> Unit, menu: (SportGame) -> Unit, eventFor: (SportGame) -> Scoreboard.Event?) {
    Column {
        SectionTitle(heading, subtitle)
        PivotScroll(offset = Dimens.edge) {
            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                items(games, key = { it.id }) { game -> GameCard(game, eventFor(game), starting == game.id, game in multi, { activate(game) }, { menu(game) }, { prewarm(game) }) }
            }
        }
    }
}

@Composable
fun SportArt(game: SportGame, modifier: Modifier = Modifier, large: Boolean = false) {
    val colors = game.colors.orEmpty().mapNotNull { c -> c.removePrefix("#").takeIf { it.length == 6 }?.toLongOrNull(16)?.let { Color(0xFF000000 or it) } }
    val split = if (colors.size >= 2) colors[0] to colors[1] else Color(0xFF26304A) to Color(0xFF121620)
    val logos = game.logos
    Box(modifier) {
        if (logos?.first != null && logos.second != null) {
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(0f to split.first, 0.49f to split.first, 0.51f to split.second, 1f to split.second)))
            Row(Modifier.align(if (large) Alignment.CenterEnd else Alignment.Center).padding(end = if (large) 90.dp else 0.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(if (large) 26.dp else 12.dp)) {
                AsyncImage(logos.second, null, Modifier.size(if (large) 100.dp else 46.dp))
                Text("vs", style = Type.headline.copy(fontWeight = FontWeight.ExtraBold), color = Color.White.copy(alpha = 0.85f))
                AsyncImage(logos.first, null, Modifier.size(if (large) 100.dp else 46.dp))
            }
        } else if (game.poster != null) {
            if (large) AsyncImage(game.poster, null, Modifier.fillMaxSize().blur(20.dp), contentScale = ContentScale.Crop, alpha = 0.6f)
            AsyncImage(game.poster, null, if (large) Modifier.align(Alignment.CenterEnd).padding(end = Dimens.edge).widthIn(max = 450.dp).height(240.dp) else Modifier.fillMaxSize(),
                contentScale = if (large) ContentScale.Fit else ContentScale.Crop)
        } else {
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(split.first, split.second))), contentAlignment = Alignment.Center) {
                Icon(sportIcon(game.category), null, tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.size(if (large) 70.dp else 36.dp))
            }
        }
    }
}

@Composable
fun StatusPill(game: SportGame) {
    Row(Modifier.background(if (game.isLive) Palette.live else Color.Black.copy(alpha = 0.7f), CircleShape).padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (game.isLive) Box(Modifier.size(5.dp).background(Color.White, CircleShape))
        Text(if (game.is247) "24/7" else if (game.isLive) "LIVE" else game.startsAt?.let(::whenLabel) ?: "Soon", style = Type.caption.copy(fontWeight = FontWeight.ExtraBold))
    }
}

@Composable
private fun ScoreChip(event: Scoreboard.Event) {
    Text(listOfNotNull("${event.away?.team?.abbreviation ?: ""} ${event.away?.score ?: ""}", "–", "${event.home?.score ?: ""} ${event.home?.team?.abbreviation ?: ""}", event.status.type.shortDetail).joinToString(" "),
        style = Type.caption.copy(fontWeight = FontWeight.Bold), maxLines = 1,
        modifier = Modifier.background(Color.Black.copy(alpha = 0.75f), CircleShape).padding(horizontal = 7.dp, vertical = 3.dp))
}

@Composable
private fun GameCard(game: SportGame, event: Scoreboard.Event?, busy: Boolean, inMulti: Boolean, onClick: () -> Unit, onLongClick: () -> Unit, onFocus: () -> Unit) {
    FocusCard(onClick = onClick, onLongClick = onLongClick, onFocus = onFocus, modifier = Modifier.width(232.dp).height(178.dp)) {
        Column {
            Box(Modifier.fillMaxWidth().height(130.dp)) {
                SportArt(game, Modifier.fillMaxSize())
                Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusPill(game)
                    Spacer(Modifier.weight(1f))
                    if (inMulti) Icon(Icons.Rounded.GridView, null, tint = Palette.gold, modifier = Modifier.background(Color.Black.copy(alpha = 0.6f), CircleShape).padding(4.dp).size(14.dp))
                }
                Row(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (event != null && event.status.type.state != "pre") ScoreChip(event)
                    Spacer(Modifier.weight(1f))
                    if (busy) Spinner(16.dp)
                }
            }
            Column(Modifier.fillMaxWidth().background(Palette.surface).padding(horizontal = 9.dp, vertical = 6.dp)) {
                Text(game.title, style = Type.callout.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${game.league}  ·  ${game.streams.size} server${if (game.streams.size == 1) "" else "s"}", style = Type.caption, color = Palette.muted, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Spotlight(game: SportGame, event: Scoreboard.Event?, busy: Boolean, inMulti: Boolean, watch: () -> Unit, toggleMulti: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(320.dp)) {
        SportArt(game, Modifier.fillMaxSize(), large = true)
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Palette.background.copy(alpha = 0.95f), Palette.background.copy(alpha = 0.35f), Color.Transparent))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to Color.Transparent, 1f to Palette.background)))
        Column(Modifier.align(Alignment.BottomStart).padding(start = Dimens.edge, bottom = 14.dp).widthIn(max = 450.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { StatusPill(game); if (event != null && event.status.type.state != "pre") ScoreChip(event) }
            Text(game.title, style = Type.hero.copy(fontSize = androidx.compose.ui.unit.TextUnit(30f, androidx.compose.ui.unit.TextUnitType.Sp)), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("${game.league}  ·  ${game.streams.size} server${if (game.streams.size == 1) "" else "s"}", style = Type.callout.copy(fontWeight = FontWeight.SemiBold), color = Palette.muted)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 4.dp)) {
                ActionButton(if (busy) "Starting…" else "Watch live", Icons.Rounded.PlayArrow, primary = true, onClick = watch)
                ActionButton(if (inMulti) "In Multiview" else "Add to Multiview", if (inMulti) Icons.Rounded.Check else Icons.Rounded.GridView, onClick = toggleMulti)
            }
        }
    }
}

@Composable
private fun ScoreCard(event: Scoreboard.Event, watchable: Boolean, onClick: () -> Unit) {
    FocusCard(onClick = onClick, modifier = Modifier.width(220.dp).height(124.dp)) {
        Column(Modifier.fillMaxSize().background(Palette.surface).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (event.isLive) Box(Modifier.size(7.dp).background(Palette.live, CircleShape))
                Text(event.status.type.shortDetail ?: "", style = Type.caption.copy(fontWeight = FontWeight.SemiBold), color = if (event.isLive) Palette.live else Palette.muted, maxLines = 1, modifier = Modifier.weight(1f))
                if (watchable) Icon(Icons.Rounded.PlayArrow, "Watch", tint = Palette.gold, modifier = Modifier.size(16.dp))
            }
            val showScore = event.status.type.state != "pre"
            listOfNotNull(event.away, event.home).forEach { team ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.then(if (event.isFinal && team.winner == false) Modifier.background(Color.Transparent) else Modifier)) {
                    team.team.logo?.let { AsyncImage(it, null, Modifier.size(22.dp)) }
                    Text(team.name, style = Type.headline.copy(fontSize = androidx.compose.ui.unit.TextUnit(14f, androidx.compose.ui.unit.TextUnitType.Sp)),
                        color = if (event.isFinal && team.winner == false) Color.White.copy(alpha = 0.55f) else Color.White, maxLines = 1, modifier = Modifier.weight(1f))
                    if (showScore) Text(team.score ?: "", style = Type.section.copy(fontWeight = FontWeight.ExtraBold))
                }
            }
        }
    }
}
