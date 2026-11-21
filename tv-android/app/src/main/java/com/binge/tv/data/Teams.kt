package com.binge.tv.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.Instant

// Followed teams (the website's followed_teams table) and game alerts, as on
// Apple TV (Data/Teams.swift). The website sends these as push notifications
// from a cron job; the TV checks ESPN itself every minute while the app is
// open and shows a banner over whatever is on screen, movies included.
@Serializable
data class FollowedTeam(val id: Long, val leaguePath: String, val teamId: String, val teamName: String, val teamAbbr: String? = null, val logo: String? = null)

data class GameAlert(val id: String, val headline: String, val detail: String)

object TeamCenter {
    var teams by mutableStateOf<List<FollowedTeam>>(emptyList()); private set
    var banner by mutableStateOf<GameAlert?>(null); private set
    private var loop: Job? = null

    fun start() {
        loop?.cancel()
        loop = AppModel.scope.launch {
            reload()
            while (true) { runCatching { check() }; delay(60_000) }
        }
    }

    fun stop() { loop?.cancel(); teams = emptyList(); banner = null }

    suspend fun reload() {
        if (!AppModel.isSignedIn) { teams = emptyList(); return }
        teams = runCatching {
            Supabase.selectAs<List<FollowedTeam>>("followed_teams", listOf("select" to "id,league_path,team_id,team_name,team_abbr,logo", "order" to "created_at.asc") + AppModel.ownerFilter)
        }.getOrDefault(teams)
    }

    // ESPN team ids are per league (NFL 5 is the Browns, NBA 5 the Cavaliers).
    fun followed(teamId: String?, leaguePath: String) = teamId?.let { id -> teams.firstOrNull { it.teamId == id && it.leaguePath == leaguePath } }
    fun isFollowing(team: Scoreboard.Competitor.Team, leaguePath: String) = followed(team.id, leaguePath) != null

    suspend fun toggle(team: Scoreboard.Competitor.Team, leaguePath: String) {
        val session = AppModel.session ?: return
        val teamId = team.id ?: return
        val existing = followed(teamId, leaguePath)
        runCatching {
            if (existing != null) Supabase.delete("followed_teams", listOf("id" to "eq.${existing.id}"))
            else Supabase.insert("followed_teams", mapOf(
                "user_id" to session.userId, "profile_id" to AppModel.profile?.id, "league_path" to leaguePath, "team_id" to teamId,
                "team_name" to (team.displayName ?: team.shortDisplayName ?: teamId), "team_abbr" to team.abbreviation, "logo" to team.logo, "alerts" to true,
            ))
        }
        reload()
    }

    fun dismissBanner() { banner = null }

    private val sent: MutableSet<String> get() = Prefs.string("alertsSent")?.split('|')?.filter { it.isNotEmpty() }?.toMutableSet() ?: mutableSetOf()

    private suspend fun check() {
        val paths = teams.map { it.leaguePath }.toSet()
        for (path in paths) {
            val league = League.all.firstOrNull { it.path == path } ?: League(path, path, path)
            val events = Scoreboard.load(league)
            for (event in events) {
                if (event.competitors.none { followed(it.team.id, path) != null }) continue
                val alert = alert(event, path.substringBefore('/')) ?: continue
                val seen = sent
                if (alert.id in seen) continue
                seen.add(alert.id)
                Prefs.set("alertsSent", seen.toList().takeLast(200).joinToString("|"))
                show(alert)
            }
        }
    }

    private fun show(alert: GameAlert) {
        banner = alert
        AppModel.scope.launch { delay(15_000); if (banner == alert) banner = null }
    }

    // Same rules as Apple TV's TeamCenter.alert and the site's gameAlerts().
    fun alert(event: Scoreboard.Event, sport: String, now: Long = System.currentTimeMillis()): GameAlert? {
        val away = event.away ?: return null
        val home = event.home ?: return null
        val matchup = "${away.name} vs ${home.name}"
        val state = event.status.type.state
        if (state == "pre") {
            val start = event.date?.let { runCatching { Instant.parse(if (it.length == 17) it.replace("Z", ":00Z") else it).toEpochMilli() }.getOrNull() } ?: return null
            val until = start - now
            return if (until < 30 * 60_000 && until > -5 * 60_000) GameAlert("${event.id}:start", "Starting soon: $matchup", event.status.type.shortDetail ?: "") else null
        }
        if (state != "in") return null
        val period = event.status.period ?: return null
        val a = away.score?.toIntOrNull() ?: 0
        val h = home.score?.toIntOrNull() ?: 0
        val score = if (ScoreVisibility.hidden) event.status.type.shortDetail ?: "" else "${away.team.abbreviation ?: away.name} $a – $h ${home.team.abbreviation ?: home.name}"
        val (regulation, close) = when (sport) {
            "basketball" -> 4 to 6
            "football" -> 4 to 8
            "hockey" -> 3 to 1
            "baseball" -> 9 to 2
            "soccer" -> 2 to 1
            else -> return null
        }
        if (period > regulation) return GameAlert("${event.id}:ot", "Overtime! $matchup", score)
        // ESPN's clock counts down each period, except soccer's (time played).
        val clock = event.status.clock
        val late = when (sport) {
            "baseball" -> period >= 8
            "soccer" -> period == regulation && (clock ?: 0.0) >= 75 * 60
            else -> period == regulation && (clock ?: 9999.0) <= 300
        }
        if (late && Math.abs(a - h) <= close) {
            return GameAlert("${event.id}:close", "Close game: $matchup", if (ScoreVisibility.hidden) score else "$score · ${event.status.type.shortDetail ?: ""}")
        }
        return null
    }
}
