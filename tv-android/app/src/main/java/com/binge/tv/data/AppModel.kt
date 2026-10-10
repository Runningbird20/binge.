package com.binge.tv.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

enum class Phase { LOADING, SIGNED_OUT, CHOOSING_PROFILE, READY }

// Account, profile and the per-profile tables: the same rows and profile_id
// scoping as the website and the Apple TV app.
object AppModel {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var phase by mutableStateOf(Phase.LOADING)
    var session by mutableStateOf<AuthSession?>(null)
        private set
    var profiles by mutableStateOf<List<AccountProfile>>(emptyList())
        private set
    var profile by mutableStateOf<AccountProfile?>(null)
        private set
    var listIds by mutableStateOf<Map<String, Long>>(emptyMap())
        private set
    var profileLoadError by mutableStateOf<String?>(null)
    var deepLink by mutableStateOf<String?>(null)

    val isKids get() = profile?.isKids ?: false
    val isSignedIn get() = session != null
    private val lastProfileKey get() = "lastProfile.${session?.userId ?: ""}"
    val lastProfileId get() = Prefs.string(lastProfileKey)

    // Debug-only: browse without an account (DebugLaunch.demo).
    var isDemo = false
        private set

    suspend fun start() {
        if (com.binge.tv.DebugLaunch.demo) { isDemo = true; phase = Phase.READY; return }
        session = Supabase.session
        if (session == null) phase = Phase.SIGNED_OUT else loadProfiles()
    }

    suspend fun signIn(email: String, password: String) {
        session = Supabase.signIn(email.trim(), password)
        loadProfiles()
    }

    suspend fun signOut() {
        Supabase.signOut()
        session = null; profiles = emptyList(); profile = null; listIds = emptyMap()
        phase = Phase.SIGNED_OUT
    }

    // Netflix-style: with more than one profile, ask who's watching on launch.
    suspend fun loadProfiles() {
        val session = session ?: run { phase = Phase.SIGNED_OUT; return }
        profileLoadError = null
        try {
            profiles = Supabase.selectAs("account_profiles", listOf(
                "select" to AccountProfile.COLUMNS, "account_id" to "eq.${session.userId}", "order" to "is_default.desc,created_at.asc",
            ))
            if (profiles.size > 1) phase = Phase.CHOOSING_PROFILE else choose(profiles.firstOrNull())
        } catch (e: Exception) {
            if (handle(e)) return
            profileLoadError = e.message
            phase = Phase.CHOOSING_PROFILE
        }
    }

    fun choose(next: AccountProfile?) {
        profile = next
        applyPrefs()
        next?.let { Prefs.set(lastProfileKey, it.id) }
        phase = Phase.READY
        scope.launch { refreshList() }
    }

    fun switchProfile() { phase = Phase.CHOOSING_PROFILE }

    suspend fun reloadProfile() {
        val id = profile?.id ?: return
        val rows: List<AccountProfile> = runCatching {
            Supabase.selectAs<List<AccountProfile>>("account_profiles", listOf("select" to AccountProfile.COLUMNS, "id" to "eq.$id"))
        }.getOrNull() ?: return
        val fresh = rows.firstOrNull() ?: return
        profile = fresh
        profiles = profiles.map { if (it.id == id) fresh else it }
        applyPrefs()
    }

    // True when the error ended the session (the UI then shows sign-in).
    fun handle(error: Throwable): Boolean {
        if (error is SignedOutException) { session = null; phase = Phase.SIGNED_OUT; return true }
        return false
    }

    // Rows saved before profiles existed have no profile_id; they belong to
    // the account's main profile, so that profile sees them too.
    val ownerFilter: List<Pair<String, String>>
        get() {
            val items = mutableListOf("user_id" to "eq.${session?.userId ?: ""}")
            profile?.let { p ->
                if (p.isDefault || profiles.size <= 1) items += "or" to "(profile_id.eq.${p.id},profile_id.is.null)"
                else items += "profile_id" to "eq.${p.id}"
            }
            return items
        }

    private val exactProfile get() = profile?.let { "eq.${it.id}" } ?: "is.null"

    suspend fun refreshList() {
        if (!isSignedIn) return
        try {
            val rows: List<WatchlistRow> = Supabase.selectAs("watchlist", listOf(
                "select" to "id,media_type,media_id", "media_type" to "in.(movie,tv_show)",
            ) + ownerFilter)
            listIds = rows.associate { "${it.mediaType}:${it.mediaId}" to it.id }
        } catch (e: Exception) { handle(e) }
    }

    fun isInList(title: Title) = listIds[title.id] != null

    suspend fun toggleList(title: Title) {
        val session = session ?: throw SignedOutException()
        val rowId = listIds[title.id]
        if (rowId != null) {
            Supabase.delete("watchlist", listOf("id" to "eq.$rowId"))
            listIds = listIds - title.id
        } else {
            Supabase.insert("watchlist", mapOf(
                "user_id" to session.userId, "profile_id" to profile?.id, "media_type" to title.kind.raw,
                "media_id" to title.dbId, "status" to "plan_to_watch",
            ))
            refreshList()
        }
    }

    private suspend fun titlesFor(rows: List<Pair<String, Long>>): Pair<Map<Long, Title>, Map<Long, Title>> = coroutineScope {
        val movies = async { runCatching { Catalog.titles(MediaKind.MOVIE, rows.filter { it.first == "movie" }.map { it.second }) }.getOrDefault(emptyMap()) }
        val shows = async { runCatching { Catalog.titles(MediaKind.TV, rows.filter { it.first == "tv_show" }.map { it.second }) }.getOrDefault(emptyMap()) }
        movies.await() to shows.await()
    }

    suspend fun myList(): List<Title> {
        if (!isSignedIn) return emptyList()
        val rows: List<WatchlistRow> = Supabase.selectAs("watchlist", listOf(
            "select" to "id,media_type,media_id", "media_type" to "in.(movie,tv_show)", "order" to "added_at.desc", "limit" to "500",
        ) + ownerFilter)
        val (movies, shows) = titlesFor(rows.map { it.mediaType to it.mediaId })
        val seen = HashSet<String>()
        return rows.mapNotNull { row ->
            val title = (if (row.mediaType == "movie") movies[row.mediaId] else shows[row.mediaId]) ?: return@mapNotNull null
            title.takeIf { (!isKids || KidsFilter.allows(it.ageRating)) && seen.add(it.id) }
        }
    }

    suspend fun continueWatching(limit: Int = 60): List<ContinueItem> {
        if (!isSignedIn) return emptyList()
        val rows: List<ContinueRow> = Supabase.selectAs("continue_watching", listOf(
            "select" to ContinueRow.COLUMNS, "media_type" to "in.(movie,tv_show)", "order" to "updated_at.desc", "limit" to "$limit",
        ) + ownerFilter)
        val (movies, shows) = titlesFor(rows.map { it.mediaType to it.mediaId })
        val seen = HashSet<String>()
        val items = rows.mapNotNull { row ->
            val title = (if (row.mediaType == "movie") movies[row.mediaId] else shows[row.mediaId]) ?: return@mapNotNull null
            if (isKids && !KidsFilter.allows(title.ageRating) || !seen.add(title.id)) return@mapNotNull null
            ContinueItem(title, row.currentSeason, row.currentEpisode, row.positionSeconds, row.durationSeconds)
        }
        return withBackdrops(items)
    }

    // Catalog rows only carry posters; Continue Watching cards are wide, so
    // fetch each title's backdrop from TMDB (cached). The same call says
    // whether a newer episode aired in the last two weeks.
    private suspend fun withBackdrops(items: List<ContinueItem>): List<ContinueItem> = coroutineScope {
        items.map { item ->
            async {
                val tmdbId = item.title.tmdbId ?: return@async item
                val details = runCatching { Tmdb.get<TmdbDetails>("${item.title.kind.tmdbPath}/$tmdbId") }.getOrNull() ?: return@async item
                var next = item
                Tmdb.image(details.backdropPath, Tmdb.WIDE)?.let { next = next.copy(title = next.title.copy(backdrop = it)) }
                if (details.originalLanguage != null && next.title.originalLanguage == null)
                    next = next.copy(title = next.title.copy(originalLanguage = details.originalLanguage))
                val aired = details.lastEpisodeToAir
                if (aired != null && ReleaseWindow.isRecent(aired.airDate, 14.0) &&
                    (aired.seasonNumber to aired.episodeNumber).let { (s, e) -> s > (item.season ?: 0) || (s == (item.season ?: 0) && e > (item.episode ?: 0)) }) {
                    next = next.copy(newEpisode = "S${aired.seasonNumber}:E${aired.episodeNumber}")
                }
                if (item.title.kind == MediaKind.TV) next = next.copy(seasonNote = SeasonStatus.note(details, item.season ?: 1, item.episode ?: 1))
                next
            }
        }.awaitAll()
    }

    private fun average(row: JsonObject): Double {
        val parts = row.values.mapNotNull { runCatching { it.jsonPrimitive.doubleOrNull }.getOrNull() }
        return if (parts.isEmpty()) 0.0 else parts.average()
    }

    // Highly rated titles (average of the rating criteria ≥ 4★), newest first.
    suspend fun lovedTitles(): List<Title> = coroutineScope {
        if (!isSignedIn) return@coroutineScope emptyList()
        val m = async { runCatching { Supabase.selectAs<List<JsonObject>>("movie_ratings", listOf(
            "select" to "media_id,acting,writing,originality,pacing,cinematography", "order" to "created_at.desc", "limit" to "40") + ownerFilter) }.getOrDefault(emptyList()) }
        val t = async { runCatching { Supabase.selectAs<List<JsonObject>>("tv_show_ratings", listOf(
            "select" to "media_id,premise,originality,acting,cinematography,writing,pacing,resonance", "order" to "created_at.desc", "limit" to "40") + ownerFilter) }.getOrDefault(emptyList()) }
        fun loved(rows: List<JsonObject>) = rows.filter { average(JsonObject(it - "media_id")) >= 4 }
            .mapNotNull { it["media_id"]?.jsonPrimitive?.content?.toLongOrNull() }
        val lovedMovies = loved(m.await()); val lovedShows = loved(t.await())
        val movies = runCatching { Catalog.titles(MediaKind.MOVIE, lovedMovies) }.getOrDefault(emptyMap())
        val shows = runCatching { Catalog.titles(MediaKind.TV, lovedShows) }.getOrDefault(emptyMap())
        (lovedShows.mapNotNull { shows[it] } + lovedMovies.mapNotNull { movies[it] }).filter { !isKids || KidsFilter.allows(it.ageRating) }
    }

    @Serializable private data class MediaIdRow(val mediaId: Long)

    suspend fun ratedIds(): Set<String> = coroutineScope {
        if (!isSignedIn) return@coroutineScope emptySet()
        val m = async { runCatching { Supabase.selectAs<List<MediaIdRow>>("movie_ratings", listOf("select" to "media_id") + ownerFilter) }.getOrDefault(emptyList()) }
        val t = async { runCatching { Supabase.selectAs<List<MediaIdRow>>("tv_show_ratings", listOf("select" to "media_id") + ownerFilter) }.getOrDefault(emptyList()) }
        (m.await().map { "movie:${it.mediaId}" } + t.await().map { "tv_show:${it.mediaId}" }).toSet()
    }

    // Same continue_watching row the website writes, so every device resumes from the same spot.
    suspend fun saveProgress(title: Title, season: Int?, episode: Int?, position: Double, duration: Double) {
        val session = session ?: return
        val row = mutableMapOf<String, Any?>("updated_at" to IsoDate.now(), "position_seconds" to position.toInt(), "duration_seconds" to duration.toInt())
        if (title.kind == MediaKind.TV) { row["current_season"] = season ?: 1; row["current_episode"] = episode ?: 1 }
        val match = listOf("user_id" to "eq.${session.userId}", "media_type" to "eq.${title.kind.raw}",
            "media_id" to "eq.${title.dbId}", "profile_id" to exactProfile)
        try {
            val existing: List<ContinueRow> = Supabase.selectAs("continue_watching", listOf("select" to ContinueRow.COLUMNS, "limit" to "1") + match)
            val current = existing.firstOrNull()
            if (current != null) Supabase.update("continue_watching", listOf("id" to "eq.${current.id}"), row)
            else Supabase.insert("continue_watching", row + mapOf("user_id" to session.userId, "profile_id" to profile?.id,
                "media_type" to title.kind.raw, "media_id" to title.dbId))
        } catch (e: Exception) { handle(e) }
    }

    suspend fun removeFromContinue(title: Title) {
        val session = session ?: return
        runCatching {
            Supabase.delete("continue_watching", listOf("user_id" to "eq.${session.userId}", "media_type" to "eq.${title.kind.raw}",
                "media_id" to "eq.${title.dbId}") + ownerFilter.filter { it.first != "user_id" })
        }
    }

    suspend fun resumePoint(title: Title): ContinueRow? {
        if (!isSignedIn) return null
        return runCatching {
            Supabase.selectAs<List<ContinueRow>>("continue_watching", listOf("select" to ContinueRow.COLUMNS,
                "media_type" to "eq.${title.kind.raw}", "media_id" to "eq.${title.dbId}", "order" to "updated_at.desc", "limit" to "1") + ownerFilter)
        }.getOrNull()?.firstOrNull()
    }

    // MARK: Household queue (profile_shares, same as the website)

    suspend fun send(title: Title, target: AccountProfile) {
        val session = session ?: throw SignedOutException()
        Supabase.upsert("profile_shares", "to_profile,media_type,media_id", mapOf(
            "user_id" to session.userId, "from_profile" to profile?.id, "to_profile" to target.id,
            "media_type" to title.kind.raw, "media_id" to title.dbId, "created_at" to IsoDate.now(), "seen_at" to null,
        ))
    }

    @Serializable private data class Share(val id: Long, val fromProfile: String? = null, val mediaType: String, val mediaId: Long, val seenAt: String? = null)

    suspend fun sharedWithMe(): List<Title> {
        val me = profile?.id ?: return emptyList()
        if (!isSignedIn) return emptyList()
        val rows: List<Share> = runCatching {
            Supabase.selectAs<List<Share>>("profile_shares", listOf("select" to "id,from_profile,media_type,media_id,seen_at",
                "to_profile" to "eq.$me", "media_type" to "in.(movie,tv_show)", "order" to "created_at.desc", "limit" to "40"))
        }.getOrDefault(emptyList())
        if (rows.isEmpty()) return emptyList()
        val (movies, shows) = titlesFor(rows.map { it.mediaType to it.mediaId })
        val names = profiles.associate { it.id to it.name }
        val unseen = rows.filter { it.seenAt == null }.map { it.id }
        if (unseen.isNotEmpty()) scope.launch {
            runCatching { Supabase.update("profile_shares", listOf("id" to "in.(${unseen.joinToString(",")})"), mapOf("seen_at" to IsoDate.now())) }
        }
        return rows.mapNotNull { row ->
            val title = (if (row.mediaType == "movie") movies[row.mediaId] else shows[row.mediaId]) ?: return@mapNotNull null
            title.copy(badge = "From ${row.fromProfile?.let { names[it] } ?: "family"}")
        }
    }

    // MARK: Ratings (1–5 stars → every criterion, like the site's import)

    private val criteria = mapOf(
        MediaKind.MOVIE to listOf("acting", "writing", "originality", "pacing", "cinematography"),
        MediaKind.TV to listOf("premise", "originality", "acting", "cinematography", "writing", "pacing", "resonance"),
    )
    private fun ratingTable(kind: MediaKind) = if (kind == MediaKind.MOVIE) "movie_ratings" else "tv_show_ratings"

    suspend fun myRating(title: Title): Double? {
        if (!isSignedIn) return null
        val fields = criteria[title.kind]!!
        val row = runCatching {
            Supabase.selectAs<List<JsonObject>>(ratingTable(title.kind), listOf("select" to fields.joinToString(","),
                "media_id" to "eq.${title.dbId}", "limit" to "1") + ownerFilter)
        }.getOrNull()?.firstOrNull() ?: return null
        return average(row).takeIf { it > 0 }
    }

    @Serializable private data class IdRow(val id: Long)

    // Saves the same row the website writes; a rated title counts as watched, so it leaves My List.
    suspend fun rate(title: Title, stars: Int) {
        val session = session ?: throw SignedOutException()
        val row = criteria[title.kind]!!.associateWith { stars.toDouble() as Any? }.toMutableMap()
        val table = ratingTable(title.kind)
        val match = listOf("user_id" to "eq.${session.userId}", "media_id" to "eq.${title.dbId}", "profile_id" to exactProfile)
        val existing: List<IdRow> = Supabase.selectAs(table, listOf("select" to "id") + match)
        val id = existing.firstOrNull()?.id
        if (id != null) Supabase.update(table, listOf("id" to "eq.$id"), row)
        else Supabase.insert(table, row + mapOf("user_id" to session.userId, "profile_id" to profile?.id, "media_id" to title.dbId))
        listIds[title.id]?.let { listId ->
            runCatching { Supabase.delete("watchlist", listOf("id" to "eq.$listId")) }
            refreshList()
        }
    }

    // MARK: Playback preferences (account_profiles.audio_pref / subtitle_pref)

    fun applyPrefs() {
        PlaybackPrefs.audio = profile?.audioPref ?: "original"
        PlaybackPrefs.subtitle = profile?.subtitlePref ?: "en"
    }

    suspend fun savePrefs(audio: String? = null, subtitle: String? = null) {
        audio?.let { PlaybackPrefs.audio = it }
        subtitle?.let { PlaybackPrefs.subtitle = it }
        val id = profile?.id ?: return
        val row = buildMap<String, Any?> { audio?.let { put("audio_pref", it) }; subtitle?.let { put("subtitle_pref", it) } }
        runCatching { Supabase.update("account_profiles", listOf("id" to "eq.$id"), row) }
        reloadProfile()
    }

    @Serializable private data class SeasonRow(val season: Int)

    suspend fun markEpisodeWatched(title: Title, season: Int, episode: Int) {
        val session = session ?: return
        val match = listOf("user_id" to "eq.${session.userId}", "media_id" to "eq.${title.dbId}", "season" to "eq.$season",
            "episode" to "eq.$episode", "profile_id" to exactProfile)
        val existing = runCatching { Supabase.selectAs<List<SeasonRow>>("episode_progress", listOf("select" to "season") + match) }.getOrNull()
        if (existing?.isEmpty() != true) return
        runCatching {
            Supabase.insert("episode_progress", mapOf("user_id" to session.userId, "profile_id" to profile?.id, "media_id" to title.dbId,
                "season" to season, "episode" to episode, "watched_at" to IsoDate.now()))
        }
    }
}
