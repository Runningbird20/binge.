package com.binge.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.binge.tv.data.Tmdb
import com.binge.tv.data.TmdbSeason
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

// Episode ratings at a glance (Apple TV's EpisodeHeatmap, the website's
// EpisodeHeatmap): a row per season, a cell per episode coloured by its TMDB
// rating, the episode you're on outlined. Long seasons wrap onto more lines.
object Heatmap {
    suspend fun load(tmdbId: Int, seasons: List<Int>): List<Pair<Int, List<TmdbSeason.Episode>>> = coroutineScope {
        seasons.take(40).map { number ->
            async { number to (runCatching { Tmdb.get<TmdbSeason>("tv/$tmdbId/season/$number") }.getOrNull()?.episodes.orEmpty()) }
        }.awaitAll().filter { it.second.isNotEmpty() }.sortedBy { it.first }
    }

    fun color(rating: Double): Color = when {
        rating <= 0 -> Color.White.copy(alpha = 0.12f)
        rating >= 8.6 -> Color(0xFF1B6E3A)
        rating >= 8.0 -> Color(0xFF2E9E4F)
        rating >= 7.0 -> Color(0xFFC9D74A)
        rating >= 6.0 -> Color(0xFFF5C451)
        rating >= 5.0 -> Color(0xFFE8772E)
        else -> Color(0xFFC0392B)
    }
}

@Composable
fun EpisodeHeatmap(seasons: List<Pair<Int, List<TmdbSeason.Episode>>>, current: Pair<Int, Int>?) {
    val perLine = 24
    Column(Modifier.padding(horizontal = Dimens.edge, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Episode ratings", style = Type.section)
            listOf(9.0 to "Awesome", 8.0 to "Great", 7.0 to "Good", 6.0 to "Regular", 5.0 to "Bad").forEach { (value, label) ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Box(Modifier.size(10.dp).background(Heatmap.color(value), RoundedCornerShape(2.dp)))
                    Text(label, style = Type.caption, color = Palette.muted)
                }
            }
        }
        // One focusable card, so the remote can scroll down to it and past it.
        FocusCard(onClick = {}, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for ((season, episodes) in seasons) {
                    episodes.chunked(perLine).forEachIndexed { line, chunk ->
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (line == 0) "S$season" else "", style = Type.caption.copy(fontWeight = FontWeight.Bold), color = Palette.muted, modifier = Modifier.width(30.dp))
                            for (episode in chunk) {
                                val rating = episode.voteAverage ?: 0.0
                                val isCurrent = current == season to episode.episodeNumber
                                Box(Modifier.width(30.dp).height(22.dp).background(Heatmap.color(rating), RoundedCornerShape(4.dp))
                                    .then(if (isCurrent) Modifier.border(2.dp, Color.White, RoundedCornerShape(4.dp)) else Modifier),
                                    contentAlignment = Alignment.Center) {
                                    Text(if (rating > 0) "%.1f".format(rating) else "–", style = Type.caption.copy(fontSize = 9.sp, fontWeight = FontWeight.Bold),
                                        color = if (rating >= 6 && rating < 8) Color.Black else Color.White)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
