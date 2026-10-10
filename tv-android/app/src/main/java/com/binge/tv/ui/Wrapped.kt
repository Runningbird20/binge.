package com.binge.tv.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.binge.tv.R
import com.binge.tv.data.AppModel
import com.binge.tv.data.Catalog
import com.binge.tv.data.MediaKind
import com.binge.tv.data.Supabase
import com.binge.tv.data.Title
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.Calendar

// Wrapped is the one screen that dresses up: your year as a run of movie
// tickets (same design as the website and the Apple TV app): gold ADMIT ONE
// stub, perforation with notches, paper body with a marquee headline,
// printed line items and a barcode. ◀ ▶ move, OK goes on, tickets also
// advance by themselves; Back closes.
private val Marquee = FontFamily(Font(R.font.barlow_condensed_extrabold, FontWeight.ExtraBold), Font(R.font.barlow_condensed_semibold, FontWeight.SemiBold))
private val Mono = FontFamily(Font(R.font.ibm_plex_mono_regular, FontWeight.Normal), Font(R.font.ibm_plex_mono_semibold, FontWeight.SemiBold))
private val Ink = Color(0xFF1C1A17)
private val Paper = Color(0xFFF4EFE6)
private val Gold = Color(0xFFF5C451)
private val Oxblood = Color(0xFF5A1020)
private val Floor = Color(0xFF0F1218)

private data class Stats(val titles: Int = 0, val episodes: Int = 0, val movies: Int = 0, val minutes: Int = 0, val ratings: Int = 0,
                         val genres: List<String> = emptyList(), val topShow: Title? = null, val topShowEpisodes: Int = 0, val favorite: Pair<Title, Double>? = null)

private data class Ticket(val id: String, val screen: String, val title: String, val sub: String? = null,
                          val lines: List<Pair<String, String>> = emptyList(), val poster: String? = null, val final: Boolean = false)

@Composable
fun WrappedScreen() {
    val year = Calendar.getInstance().get(Calendar.YEAR)
    var stats by remember { mutableStateOf<Stats?>(null) }
    var page by remember { mutableIntStateOf(0) }
    var lastInput by remember { mutableLongStateOf(0L) }
    val reveal = remember { Animatable(0f) }
    val focus = remember { FocusRequester() }
    val name = AppModel.profile?.name ?: "Your"

    LaunchedEffect(Unit) { stats = loadStats(year); runCatching { focus.requestFocus() } }

    val tickets = stats?.let { s ->
        if (s.titles == 0) listOf(Ticket("empty", "Box office", "No tickets yet", "Watch or rate a few things this year and your tickets print here."))
        else buildList {
            val hours = s.minutes / 60
            add(Ticket("intro", "Opening night", "$name’s $year", "A year at the binge. cinema",
                listOf("Showing" to "Movies · Series · Sports", "Titles" to "${s.titles}", "Seat" to "Yours, every night")))
            add(Ticket("time", "Screen 1", "$hours hours", "That’s about ${"%.1f".format(hours / 24.0)} days in the dark.",
                listOf("Episodes" to "${s.episodes}", "Movies" to "${s.movies}", "Titles" to "${s.titles}")))
            s.topShow?.let { add(Ticket("show", "Now showing", it.name, "Your most-watched show", listOf("Episodes" to "${s.topShowEpisodes}", "Rewatch value" to "Off the charts"), it.poster)) }
            s.genres.firstOrNull()?.let { top -> add(Ticket("genres", "Double feature", top, "The genre you kept coming back to", s.genres.take(3).mapIndexed { i, g -> "No. ${i + 1}" to g })) }
            s.favorite?.let { (title, stars) -> add(Ticket("fav", "Critics’ pick", title.name, "Your best-rated title", listOf("Your rating" to "${Math.round(stars)} of 5"), title.poster)) }
            add(Ticket("end", "Closing night", if (s.ratings > 10) "The Critic" else "The Binger",
                if (s.ratings > 10) "${s.ratings} ratings, and every pick learned from them." else "You kept coming back for more.",
                listOf("Ratings" to "${s.ratings}", "Hours" to "$hours"), final = true))
        }
    }.orEmpty()

    // Each ticket "prints" in (revealed top to bottom), then advances by itself unless the remote was used.
    LaunchedEffect(page, tickets.size) {
        reveal.snapTo(0f)
        reveal.animateTo(1f, tween(850, easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)))
        delay(7000)
        if (System.currentTimeMillis() - lastInput > 10_000 && page < tickets.size - 1) page++
    }

    Box(
        Modifier.fillMaxSize().background(Floor).focusRequester(focus).focusable().onKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
            lastInput = System.currentTimeMillis()
            when (event.key.nativeKeyCode) {
                android.view.KeyEvent.KEYCODE_DPAD_LEFT -> { page = maxOf(0, page - 1); true }
                android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> { page = minOf(tickets.size - 1, page + 1); true }
                android.view.KeyEvent.KEYCODE_DPAD_CENTER, android.view.KeyEvent.KEYCODE_ENTER -> { if (page < tickets.size - 1) page++ else Nav.pop(); true }
                else -> false
            }
        },
        contentAlignment = Alignment.Center,
    ) {
        Row(Modifier.align(Alignment.TopCenter).padding(start = 60.dp, end = 60.dp, top = 30.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            tickets.indices.forEach { i -> Box(Modifier.weight(1f).height(3.dp).background(Paper.copy(alpha = if (i <= page) 1f else 0.22f), CircleShape)) }
        }
        val ticket = tickets.getOrNull(page)
        if (ticket != null) Box(Modifier.offset(y = ((1 - reveal.value) * -15).dp).shadow(20.dp, RoundedCornerShape(11.dp))
            .drawWithContent { clipRect(bottom = size.height * reveal.value) { this@drawWithContent.drawContent() } }) {
            TicketView(ticket, page, year)
        } else Box(Modifier.width(740.dp).height(320.dp).background(Color.White.copy(alpha = 0.06f), RoundedCornerShape(10.dp)))
        Text("◀ ▶  flip tickets  ·  Back  close", style = TextStyle(fontFamily = Mono, fontSize = 11.sp), color = Paper.copy(alpha = 0.45f),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 25.dp))
    }
}

@Composable
private fun TicketView(ticket: Ticket, number: Int, year: Int) {
    Box(Modifier.width(740.dp).height(320.dp)) {
        Row(Modifier.fillMaxSize().clip(RoundedCornerShape(11.dp))) {
            // stub
            Column(Modifier.width(165.dp).fillMaxSize().background(Gold).padding(20.dp)) {
                Text("binge.", style = TextStyle(fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic, fontWeight = FontWeight.Bold, fontSize = 23.sp), color = Ink)
                Text("ADMIT\nONE", style = TextStyle(fontFamily = Marquee, fontWeight = FontWeight.ExtraBold, fontSize = 38.sp, lineHeight = 33.sp), color = Ink, modifier = Modifier.padding(top = 9.dp))
                Spacer(Modifier.weight(1f))
                Text("${ticket.screen.uppercase()} · $year", style = TextStyle(fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 11.sp), color = Ink)
                Text("NO. ${year.toString().takeLast(2)}-${"%05d".format(412 + number * 37)}", style = TextStyle(fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 11.sp),
                    color = Ink.copy(alpha = 0.7f), modifier = Modifier.padding(top = 3.dp))
            }
            // body
            Box(Modifier.fillMaxSize().background(Paper)) {
                Column(Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        ticket.poster?.let { AsyncImage(it, null, Modifier.width(85.dp).height(127.dp).clip(RoundedCornerShape(4.dp)), contentScale = ContentScale.Crop) }
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(ticket.title.uppercase(), style = TextStyle(fontFamily = Marquee, fontWeight = FontWeight.ExtraBold, fontSize = if (ticket.title.length > 16) 44.sp else 60.sp,
                                lineHeight = if (ticket.title.length > 16) 44.sp else 58.sp), color = Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            ticket.sub?.let { Text(it, style = TextStyle(fontFamily = Marquee, fontWeight = FontWeight.SemiBold, fontSize = 20.sp), color = Oxblood) }
                        }
                    }
                    Column {
                        ticket.lines.forEach { (label, value) ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp).drawWithContent {
                                drawContent()
                                drawLine(Ink.copy(alpha = 0.22f), Offset(0f, size.height + 6.dp.toPx()), Offset(size.width, size.height + 6.dp.toPx()), 1.dp.toPx(),
                                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.5.dp.toPx())))
                            }) {
                                Text(label.uppercase(), style = TextStyle(fontFamily = Mono, fontSize = 14.sp), color = Ink.copy(alpha = 0.62f))
                                Spacer(Modifier.weight(1f))
                                Text(value, style = TextStyle(fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 14.sp), color = Ink)
                            }
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    Barcode("${ticket.id}-$year", Modifier.width(165.dp).height(32.dp))
                }
                // perforation
                Canvas(Modifier.width(2.dp).fillMaxSize().align(Alignment.CenterStart)) {
                    drawLine(Ink.copy(alpha = 0.35f), Offset(size.width / 2, 0f), Offset(size.width / 2, size.height), 1.5.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx())))
                }
                if (ticket.final) Text("ADMITTED", style = TextStyle(fontFamily = Marquee, fontWeight = FontWeight.ExtraBold, fontSize = 29.sp), color = Oxblood,
                    modifier = Modifier.align(Alignment.TopEnd).padding(25.dp).rotate(-11f).border(3.dp, Oxblood, RoundedCornerShape(5.dp)).padding(horizontal = 11.dp, vertical = 3.dp))
            }
        }
        // the notches where the ticket tears
        Box(Modifier.offset(x = 165.dp - 11.5.dp, y = (-11.5).dp).size(23.dp).background(Floor, CircleShape))
        Box(Modifier.offset(x = 165.dp - 11.5.dp, y = 320.dp - 11.5.dp).size(23.dp).background(Floor, CircleShape))
    }
}

// Bars drawn from the ticket's own text, so every ticket's differs.
@Composable
private fun Barcode(seed: String, modifier: Modifier) {
    Canvas(modifier) {
        var state = seed.fold(2166136261u) { acc, c -> (acc xor c.code.toUInt()) * 16777619u }
        if (state == 0u) state = 1u
        val unit = size.width / 240f
        var x = 0f
        while (x < 236f) {
            state = state * 1664525u + 1013904223u
            val width = (1u + state % 3u).toFloat()
            drawRect(Ink, Offset(x * unit, 0f), Size(width * unit, size.height))
            x += width + (1u + (state shr 8) % 3u).toFloat()
        }
    }
}

private suspend fun loadStats(year: Int): Stats {
    val start = "$year-01-01T00:00:00Z"
    val owner = AppModel.ownerFilter
    suspend fun rows(table: String, select: String, extra: List<Pair<String, String>>) =
        runCatching { Supabase.selectAs<List<JsonObject>>(table, listOf("select" to select) + extra + owner) }.getOrDefault(emptyList())
    val progress = rows("episode_progress", "media_id", listOf("watched_at" to "gte.$start", "limit" to "5000"))
    val cw = rows("continue_watching", "media_type,media_id", listOf("updated_at" to "gte.$start", "media_type" to "in.(movie,tv_show)"))
    val mr = rows("movie_ratings", "media_id,acting,writing,originality,pacing,cinematography", listOf("created_at" to "gte.$start"))
    val sr = rows("tv_show_ratings", "media_id,premise,originality,acting,cinematography,writing,pacing,resonance", listOf("created_at" to "gte.$start"))
    fun id(o: JsonObject) = o["media_id"]?.jsonPrimitive?.content?.toLongOrNull()
    fun avg(o: JsonObject) = o.filterKeys { it != "media_id" }.values.mapNotNull { runCatching { it.jsonPrimitive.doubleOrNull }.getOrNull() }.let { if (it.isEmpty()) 0.0 else it.average() }
    val movieIds = (cw.filter { it["media_type"]?.jsonPrimitive?.content == "movie" }.mapNotNull(::id) + mr.mapNotNull(::id)).toSet()
    val showIds = (cw.filter { it["media_type"]?.jsonPrimitive?.content == "tv_show" }.mapNotNull(::id) + progress.mapNotNull(::id) + sr.mapNotNull(::id)).toSet()
    val movies = runCatching { Catalog.titles(MediaKind.MOVIE, movieIds.toList()) }.getOrDefault(emptyMap())
    val shows = runCatching { Catalog.titles(MediaKind.TV, showIds.toList()) }.getOrDefault(emptyMap())
    val top = progress.mapNotNull(::id).groupingBy { it }.eachCount().maxByOrNull { it.value }
    val rated = mr.mapNotNull { r -> id(r)?.let { movies[it] }?.let { it to avg(r) } } + sr.mapNotNull { r -> id(r)?.let { shows[it] }?.let { it to avg(r) } }
    val genres = (movies.values + shows.values).flatMap { t -> t.genre.orEmpty().split(",").map { it.trim() }.filter { it.isNotEmpty() } }
        .groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.map { it.key }
    return Stats(
        titles = movieIds.size + showIds.size, episodes = progress.size, movies = movieIds.size,
        minutes = progress.size * 45 + movieIds.size * 110, ratings = mr.size + sr.size, genres = genres,
        topShow = top?.let { shows[it.key] }, topShowEpisodes = top?.value ?: 0, favorite = rated.maxByOrNull { it.second },
    )
}
