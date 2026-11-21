package com.binge.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.tv.material3.Text
import com.binge.tv.data.AppModel
import com.binge.tv.data.CollectionSet
import com.binge.tv.data.Collections
import com.binge.tv.data.CollectionsFile
import com.binge.tv.data.Maturity

// The Collections tab: every ready-made set, a row per group (Malayalam,
// Franchises, Holidays…). Selecting one opens it as a grid that keeps loading
// as you scroll (data/Collections.kt; the website's /collections).
@Composable
fun CollectionsScreen() {
    var file by remember { mutableStateOf<CollectionsFile?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val listState = rememberLazyListState()
    ReportTop(listState)
    LaunchedEffect(attempt) {
        failed = false
        file = Collections.load()
        failed = file == null
        // Debug: --es collection <id> opens that set.
        val wanted = com.binge.tv.DebugLaunch.collection
        if (wanted != null) file?.collections?.firstOrNull { it.id == wanted }?.let { com.binge.tv.DebugLaunch.collection = null; Nav.push(Screen.Collection(it)) }
    }
    val restricted = AppModel.maturity != Maturity.ALL
    PivotScroll(fraction = 0.3f) {
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize().focusRestorer(), contentPadding = PaddingValues(top = 70.dp, bottom = 40.dp)) {
            item(key = "head") {
                Column(Modifier.padding(start = Dimens.edge, end = Dimens.edge, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Collections", style = Type.hero)
                    Text("Ready-made sets to scroll through. New releases join them on their own.", style = Type.callout, color = Palette.muted)
                }
            }
            val current = file
            when {
                current != null -> items(current.visible(restricted), key = { it.first.id }) { (group, sets) ->
                    Column {
                        SectionTitle(group.title)
                        PivotScroll(offset = Dimens.edge) {
                            LazyRow(contentPadding = PaddingValues(horizontal = Dimens.edge, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap)) {
                                items(sets, key = { it.id }) { CollectionCard(it) }
                            }
                        }
                    }
                }
                failed -> item { ProblemView("Couldn't load the collections right now.") { attempt++ } }
                else -> items(3) { RowSkeleton() }
            }
        }
    }
}

// A set's card: its first three posters fanned out, its name and line.
@Composable
private fun CollectionCard(set: CollectionSet) {
    val feed = remember(set.id, AppModel.maturity) { Collections.feed(set, AppModel.maturity) }
    LaunchedEffect(feed) { if (feed.items.isEmpty()) feed.loadMore() }
    FocusCard(onClick = { Nav.push(Screen.Collection(set)) }, modifier = Modifier.width(250.dp).height(214.dp), shape = RoundedCornerShape(12.dp)) {
        Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.fillMaxWidth().height(120.dp)) {
                val posters = feed.items.take(3)
                if (posters.isEmpty()) Box(Modifier.width(80.dp).height(120.dp).clip(RoundedCornerShape(6.dp)).background(Palette.raised))
                posters.forEachIndexed { index, title ->
                    Box(Modifier.offset(x = (index * 56).dp).zIndex((3 - index).toFloat()).scale(1f - index * 0.08f)
                        .width(80.dp).height(120.dp).clip(RoundedCornerShape(6.dp)).background(Palette.raised)) {
                        Art(title.poster, title.name, Modifier.fillMaxSize())
                    }
                }
            }
            Text(set.title, style = Type.callout.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(set.subtitle, style = Type.caption, color = Palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

// One set as a grid that keeps loading as the end comes near.
@Composable
fun CollectionScreen(set: CollectionSet) {
    val feed = remember(set.id, AppModel.maturity) { Collections.feed(set, AppModel.maturity) }
    val gridState = rememberLazyGridState()
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    LaunchedEffect(feed) { if (feed.items.isEmpty()) feed.loadMore() }
    // A page on top takes focus itself: the first poster, once there is one.
    val first = remember { androidx.compose.ui.focus.FocusRequester() }
    val hasItems = feed.items.isNotEmpty()
    LaunchedEffect(hasItems) { if (hasItems) { kotlinx.coroutines.delay(80); runCatching { first.requestFocus() } } }
    // The last row coming into view loads the next batch.
    LaunchedEffect(feed, gridState) {
        snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last ->
            if (!feed.done && !feed.loading && feed.items.isNotEmpty() && last >= feed.items.size - 7) feed.loadMore()
        }
    }
    LazyVerticalGrid(GridCells.Fixed(7), Modifier.fillMaxSize().focusRestorer(), state = gridState,
        contentPadding = PaddingValues(start = Dimens.edge, end = Dimens.edge, top = 36.dp, bottom = 40.dp),
        horizontalArrangement = Arrangement.spacedBy(Dimens.rowGap), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(Modifier.padding(bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(set.title, style = Type.hero, maxLines = 2)
                val count = if (feed.items.isEmpty()) "" else "  ·  ${feed.items.size}${if (feed.done) "" else "+"} on binge."
                Text(set.subtitle + count, style = Type.callout, color = Palette.muted)
            }
        }
        itemsIndexed(feed.items, key = { _, title -> title.id }) { index, title ->
            PosterCard(title, Nav::open, modifier = if (index == 0) Modifier.focusRequester(first) else Modifier)
        }
        when {
            feed.items.isEmpty() && feed.done -> item(span = { GridItemSpan(maxLineSpan) }) {
                Text("Nothing in this collection is on binge. for this profile yet. New titles join it as they come out.", style = Type.body, color = Palette.muted)
            }
            feed.failed -> item(span = { GridItemSpan(maxLineSpan) }) {
                ProblemView(if (feed.items.isEmpty()) "Couldn't load this collection right now." else "Couldn't load more of this collection.") {
                    scope.launch { feed.loadMore() }
                }
            }
            feed.items.isEmpty() || feed.loading -> item(span = { GridItemSpan(maxLineSpan) }) { RowSkeleton() }
        }
    }
}
