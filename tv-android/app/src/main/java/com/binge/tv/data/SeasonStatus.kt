package com.binge.tv.data

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

// Same rules as the website's src/utils/seasonStatus.js: where you are in
// the season ("2 episodes left in Season 3", "Season finale next") or
// what's coming ("Next episode Friday", "Season 4 starts Oct 24").
object SeasonStatus {
    private fun startOfDay(ms: Long) = Calendar.getInstance().apply {
        timeInMillis = ms; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    fun friendlyDay(text: String?, now: Long = System.currentTimeMillis()): String? {
        val date = IsoDate.day(text) ?: return null
        val days = ((startOfDay(date) - startOfDay(now)) / 86_400_000.0).let { Math.round(it).toInt() }
        return when {
            days < 0 -> null
            days == 0 -> "today"
            days == 1 -> "tomorrow"
            days < 7 -> SimpleDateFormat("EEEE", Locale.US).format(date)
            else -> SimpleDateFormat("MMM d", Locale.US).format(date)
        }
    }

    fun note(details: TmdbDetails, season: Int, episode: Int, now: Long = System.currentTimeMillis()): String? {
        if (season <= 0 || episode <= 0) return null
        val seasons = details.seasons.orEmpty().filter { it.seasonNumber > 0 }
        val current = seasons.firstOrNull { it.seasonNumber == season }
        val next = details.nextEpisodeToAir
        val nextDay = friendlyDay(next?.airDate, now)
        var aired = current?.episodeCount ?: 0
        if (next != null && next.seasonNumber == season) aired = minOf(if (aired == 0) Int.MAX_VALUE else aired, next.episodeNumber - 1)
        val left = aired - episode
        if (left >= 2) return "$left episodes left in Season $season"
        if (left == 1) return if (next == null || next.seasonNumber > season) "Season finale next" else "1 episode left so far"
        if (next != null && next.seasonNumber == season && nextDay != null) return "Next episode $nextDay"
        if (next != null && next.seasonNumber > season && nextDay != null)
            return if (next.episodeNumber == 1) "Season ${next.seasonNumber} starts $nextDay" else "New episode $nextDay"
        seasons.firstOrNull { it.seasonNumber > season && (it.episodeCount ?: 0) > 0 && (IsoDate.day(it.airDate)?.let { d -> d <= now } ?: false) }
            ?.let { return "Season ${it.seasonNumber} is out" }
        if (details.status == "Ended" || details.status == "Canceled") return "Series finale"
        return null
    }
}
