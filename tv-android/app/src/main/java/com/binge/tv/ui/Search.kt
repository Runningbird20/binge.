package com.binge.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Close
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
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.binge.tv.data.AppModel
import com.binge.tv.data.AskBinge
import com.binge.tv.data.Catalog
import com.binge.tv.data.MediaKind
import com.binge.tv.data.RowSpec
import com.binge.tv.data.Title
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private object SearchCache { var trending: List<Title> = emptyList() }

@Composable
fun SearchScreen() {
    var query by remember { mutableStateOf("") }
    // This profile's last searches on this TV: pick one to search again.
    var recent by remember { mutableStateOf(com.binge.tv.data.RecentSearches.list(AppModel.profile?.id)) }
    var results by remember { mutableStateOf<List<Title>>(emptyList()) }
    var trending by remember { mutableStateOf(SearchCache.trending) }
    var searching by remember { mutableStateOf(false) }
    var ai by remember { mutableStateOf<List<Pair<Title, String?>>>(emptyList()) }
    var aiSummary by remember { mutableStateOf<String?>(null) }
    var aiLoading by remember { mutableStateOf(false) }
    var aiError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val gridState = rememberLazyGridState()
    LaunchedEffect(gridState) { snapshotFlow { gridState.firstVisibleItemIndex == 0 }.collect { TabChrome.atTop = it } }
    LaunchedEffect(gridState) { snapshotFlow { TabChrome.scrollToTop }.collect { if (it > 0) gridState.animateScrollToItem(0) } }
    val text = query.trim()

    suspend fun ask(q: String) {
        aiLoading = true; aiError = null
        try {
            val (summary, titles) = AskBinge.ask(q, AppModel.maturity)
            if (q == query.trim()) { ai = titles; aiSummary = summary; if (titles.isEmpty() && results.isEmpty()) aiError = "Nothing on binge. fits that yet. Try saying it another way." }
        } catch (e: kotlinx.coroutines.CancellationException) { throw e
        } catch (e: Exception) {
            // Only messages written for people reach the screen.
            aiError = (e as? com.binge.tv.data.BingeException)?.message ?: "Ask binge. isn't answering right now."
        }
        aiLoading = false
    }

    // Every search goes through Ask binge. (exact titles first, and requests
    // like "new Malayalam movies"); plain title matches show while it thinks.
    // Games too (as on the website): live ones and today's, matched by team, title or league.
    var games by remember { mutableStateOf<List<com.binge.tv.data.SportGame>>(emptyList()) }
    var startingGame by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(text) {
        if (text.length < 3) { games = emptyList(); return@LaunchedEffect }
        delay(350)
        val words = text.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val soon = System.currentTimeMillis() + 12 * 3_600_000L
        games = runCatching { com.binge.tv.data.SportsFeed.recent() }.getOrDefault(emptyList())
            .filter { !it.alwaysLive && (it.isLive || (it.startsAt ?: Long.MAX_VALUE) < soon) }
            .filter { game -> val hay = "${game.title} ${game.league} ${game.category}".lowercase(); words.all { it in hay } }
            .take(12)
    }
    fun playGame(game: com.binge.tv.data.SportGame) {
        if (startingGame != null) return
        startingGame = game.id
        scope.launch {
            val servers = runCatching { com.binge.tv.data.SportsFeed.servers(game) }.getOrDefault(emptyList())
            startingGame = null
            if (servers.isNotEmpty()) Nav.play(liveRequest(game, servers))
        }
    }

    LaunchedEffect(text) {
        if (text.isEmpty()) { results = emptyList(); ai = emptyList(); return@LaunchedEffect }
        searching = true
        ai = emptyList(); aiSummary = null; aiError = null
        delay(350)
        results = runCatching { Catalog.search(text, AppModel.maturity) }.getOrDefault(emptyList())
        searching = false
        if (text.length >= 2) { delay(250); ask(text) }
        // Kept as a recent search once it's settled and found something.
        delay(2500)
        if (results.isNotEmpty() || ai.isNotEmpty()) {
            com.binge.tv.data.RecentSearches.add(text, AppModel.profile?.id)
            recent = com.binge.tv.data.RecentSearches.list(AppModel.profile?.id)
        }
    }
    LaunchedEffect(Unit) {
        if (trending.isNotEmpty()) return@LaunchedEffect
        val maturity = AppModel.maturity
        val m = async { Catalog.load(RowSpec("s-m", "", MediaKind.MOVIE, "trending/movie/week"), maturity)?.items.orEmpty() }
        val s = async { Catalog.load(RowSpec("s-t", "", MediaKind.TV, "trending/tv/week"), maturity)?.items.orEmpty() }
        val a = m.await(); val b = s.await()
        // Interleaved so the grid isn't all movies first.
        trending = (0 until maxOf(a.size, b.size)).flatMap { i -> listOfNotNull(b.getOrNull(i), a.getOrNull(i)) }
        SearchCache.trending = trending
    }

    val aiIds = ai.map { it.first.id }.toSet()
    val showing = if (text.isEmpty()) trending else results.filter { it.id !in aiIds }
    // When the keyboard closes, focus goes to the first result (or stays in
    // the box if there are none yet), never up to the tab bar.
    val firstId = ai.firstOrNull()?.first?.id ?: showing.firstOrNull()?.id
    val firstResult = remember { androidx.compose.ui.focus.FocusRequester() }
    val fieldFocus = remember { androidx.compose.ui.focus.FocusRequester() }
    var fieldFocused by remember { mutableStateOf(false) }
    val firstGame = remember { androidx.compose.ui.focus.FocusRequester() }
    fun afterTyping() {
        scope.launch {
            // A game you searched for (a team) comes first, above the titles.
            if (games.isNotEmpty()) {
                for (wait in listOf(250L, 400L, 600L, 900L)) {
                    kotlinx.coroutines.delay(wait)
                    runCatching { firstGame.requestFocus() }
                    kotlinx.coroutines.delay(60)
                    if (!fieldFocused) break
                }
                return@launch
            }
            if (firstId == null) { kotlinx.coroutines.delay(250); runCatching { fieldFocus.requestFocus() }; return@launch }
            // Fire TV hands focus back from its keyboard window a moment after
            // it closes (and puts it on the box): ask again until it moves.
            for (wait in listOf(250L, 400L, 600L, 900L)) {
                kotlinx.coroutines.delay(wait)
                runCatching { firstResult.requestFocus() }
                kotlinx.coroutines.delay(60)
                if (!fieldFocused) break
            }
            if (com.binge.tv.BuildConfig.DEBUG) android.util.Log.i("binge", "search afterTyping first=$firstId onResults=${!fieldFocused}")
        }
    }
    PivotScroll(fraction = 0.3f) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(7), state = gridState, modifier = Modifier.fillMaxSize().focusRestorer(),
            contentPadding = PaddingValues(start = Dimens.edge, end = Dimens.edge, top = 70.dp, bottom = 40.dp),
            horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap), verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    TvTextField(query, { query = it }, "Movies, series, actors, or a mood", Modifier.width(560.dp).focusRequester(fieldFocus).onFocusChanged { fieldFocused = it.isFocused },
                        KeyboardOptions(imeAction = ImeAction.Search), leading = Icons.Rounded.Search, onDone = ::afterTyping)
                    if (text.isEmpty()) Text("Press the microphone on the remote to say a title, an actor, or what you're in the mood for — like “a funny movie under two hours”.",
                        style = Type.callout, color = Palette.muted)
                }
            }
            if (games.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }, key = "games") {
                Column {
                    Text("Games", style = Type.section, color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.92f))
                    androidx.compose.foundation.lazy.LazyRow(contentPadding = PaddingValues(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                        items(games.size, key = { games[it].id }) { i ->
                            val game = games[i]
                            GameCard(game, null, startingGame == game.id, false, { playGame(game) }, {}, {},
                                modifier = if (i == 0) Modifier.focusRequester(firstGame) else Modifier)
                        }
                    }
                }
            }
            if (text.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                when {
                    aiLoading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) { Spinner(18.dp); Text("Finding the best matches…", style = Type.callout, color = Palette.muted) }
                    ai.isNotEmpty() -> Text(aiSummary ?: "Best matches", style = Type.section)
                    aiError != null && results.isEmpty() && games.isEmpty() -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(aiError ?: "", style = Type.callout, color = Palette.muted)
                        Pill("Try again") { scope.launch { ask(text) } }
                    }
                }
            }
            items(ai, key = { "ai:" + it.first.id }) { (title, why) ->
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    PosterCard(title, Nav::open, if (title.id == firstId) Modifier.focusRequester(firstResult) else Modifier)
                    why?.takeIf { it.isNotEmpty() && it != "Title match" }?.let { Text(it, style = Type.caption, color = Palette.muted, maxLines = 2) }
                }
            }
            if (ai.isNotEmpty() && showing.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Text("More titles", style = Type.section, modifier = Modifier.padding(top = 8.dp)) }
            if (text.isNotEmpty() && !searching && results.isEmpty() && ai.isEmpty() && games.isEmpty() && !aiLoading && aiError == null) item(span = { GridItemSpan(maxLineSpan) }) {
                Text("Nothing on binge. matches “$text”.", style = Type.headline, color = Palette.muted, modifier = Modifier.padding(top = 30.dp))
            }
            if (text.isEmpty() && recent.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }, key = "recent") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Recent searches", style = Type.section)
                    androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(recent.size, key = { recent[it] }) { i -> Pill(recent[i]) { query = recent[i] } }
                        item(key = "clear") { Pill("Clear", icon = Icons.Rounded.Close) { com.binge.tv.data.RecentSearches.clear(AppModel.profile?.id); recent = emptyList() } }
                    }
                }
            }
            if (text.isEmpty() && trending.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Text("Trending searches", style = Type.section) }
            items(showing, key = { it.id }) { PosterCard(it, Nav::open, if (it.id == firstId) Modifier.focusRequester(firstResult) else Modifier) }
        }
    }
}
