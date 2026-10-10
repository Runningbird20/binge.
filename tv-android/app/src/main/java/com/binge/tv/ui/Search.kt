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
    val text = query.trim()

    suspend fun ask(q: String) {
        aiLoading = true; aiError = null
        try {
            val (summary, titles) = AskBinge.ask(q, AppModel.isKids)
            if (q == query.trim()) { ai = titles; aiSummary = summary; if (titles.isEmpty()) aiError = "Nothing on binge. fits that yet. Try saying it another way." }
        } catch (e: Exception) { aiError = e.message ?: "Ask binge. isn't answering right now." }
        aiLoading = false
    }

    LaunchedEffect(text) {
        if (text.isEmpty()) { results = emptyList(); ai = emptyList(); return@LaunchedEffect }
        searching = true
        delay(350)
        results = runCatching { Catalog.search(text, AppModel.isKids) }.getOrDefault(emptyList())
        searching = false
        ai = emptyList(); aiSummary = null; aiError = null
        if (AskBinge.isConversational(text)) ask(text)
    }
    LaunchedEffect(Unit) {
        if (trending.isNotEmpty()) return@LaunchedEffect
        val kids = AppModel.isKids
        val m = async { Catalog.load(RowSpec("s-m", "", MediaKind.MOVIE, "trending/movie/week"), kids)?.items.orEmpty() }
        val s = async { Catalog.load(RowSpec("s-t", "", MediaKind.TV, "trending/tv/week"), kids)?.items.orEmpty() }
        val a = m.await(); val b = s.await()
        // Interleaved so the grid isn't all movies first.
        trending = (0 until maxOf(a.size, b.size)).flatMap { i -> listOfNotNull(b.getOrNull(i), a.getOrNull(i)) }
        SearchCache.trending = trending
    }

    val showing = if (text.isEmpty()) trending else results
    PivotScroll(fraction = 0.3f) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(7), state = gridState, modifier = Modifier.fillMaxSize().focusRestorer(),
            contentPadding = PaddingValues(start = Dimens.edge, end = Dimens.edge, top = 70.dp, bottom = 40.dp),
            horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap), verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    TvTextField(query, { query = it }, "Movies, series, actors, or a mood", Modifier.width(560.dp),
                        KeyboardOptions(imeAction = ImeAction.Search), KeyboardActions(onSearch = { }), leading = Icons.Rounded.Search)
                    if (text.isEmpty()) Text("Press the microphone on the remote to say a title, an actor, or what you're in the mood for — like “a funny movie under two hours”.",
                        style = Type.callout, color = Palette.muted)
                }
            }
            if (text.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                when {
                    aiLoading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) { Spinner(18.dp); Text("Asking binge.…", style = Type.headline) }
                    ai.isNotEmpty() -> Column {
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(Icons.Rounded.AutoAwesome, null)
                            Text("Ask binge.", style = Type.section.copy(fontWeight = FontWeight.Bold))
                            aiSummary?.let { Text(it, style = Type.callout, color = Palette.muted, maxLines = 1) }
                        }
                        LazyRow(contentPadding = PaddingValues(vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                            items(ai, key = { it.first.id }) { (title, why) ->
                                Column(Modifier.width(Dimens.posterW), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                    PosterCard(title, Nav::open)
                                    why?.let { Text(it, style = Type.caption, color = Palette.muted, maxLines = 3) }
                                }
                            }
                        }
                    }
                    else -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Pill("Ask binge. for “$text”", selected = true, icon = Icons.Rounded.AutoAwesome) { scope.launch { ask(text) } }
                        Text(aiError ?: "Describe a mood: “a cozy mystery under 2 hours”", style = Type.callout, color = if (aiError != null) Palette.error else Palette.muted)
                    }
                }
            }
            if (text.isNotEmpty() && !searching && results.isEmpty() && ai.isEmpty() && !aiLoading) item(span = { GridItemSpan(maxLineSpan) }) {
                Text("Nothing on binge. matches “$text”.", style = Type.headline, color = Palette.muted, modifier = Modifier.padding(top = 30.dp))
            }
            if (text.isEmpty() && trending.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Text("Trending searches", style = Type.section) }
            items(showing, key = { it.id }) { PosterCard(it, Nav::open) }
        }
    }
}
