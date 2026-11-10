package com.binge.tv.data

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable

// A title's cast & crew (the Cast row) and a person's work (PersonScreen):
// the website's utils/people.js and the Apple TV's People.swift, same rules.
data class CreditPerson(val id: Int, val name: String, val role: String, val photo: String?)

data class PersonPage(val name: String, val photo: String?, val department: String?, val lifeLine: String?, val biography: String, val rows: List<LoadedRow>)

@Serializable
data class TitleCredits(val cast: List<Cast> = emptyList(), val crew: List<Crew> = emptyList()) {
    @Serializable data class Cast(val id: Int? = null, val name: String, val character: String? = null, val profilePath: String? = null, val order: Int? = null)
    @Serializable data class Crew(val id: Int? = null, val name: String, val job: String? = null, val profilePath: String? = null)
}

@Serializable
data class TitlePeopleDetails(val credits: TitleCredits? = null, val createdBy: List<Creator>? = null) {
    @Serializable data class Creator(val id: Int? = null, val name: String, val profilePath: String? = null)
}

@Serializable
private data class PersonDetails(
    val id: Int,
    val name: String,
    val biography: String? = null,
    val birthday: String? = null,
    val deathday: String? = null,
    val placeOfBirth: String? = null,
    val profilePath: String? = null,
    val knownForDepartment: String? = null,
    val combinedCredits: Credits? = null,
) {
    @Serializable data class Credit(
        val id: Int, val mediaType: String? = null, val title: String? = null, val name: String? = null,
        val character: String? = null, val job: String? = null, val episodeCount: Int? = null, val voteCount: Int? = null,
        val genreIds: List<Int>? = null, val posterPath: String? = null, val backdropPath: String? = null,
        val releaseDate: String? = null, val firstAirDate: String? = null, val originalLanguage: String? = null,
    ) {
        val item get() = TmdbItem(id = id, title = title, name = name, posterPath = posterPath, backdropPath = backdropPath,
            releaseDate = releaseDate, firstAirDate = firstAirDate, mediaType = mediaType, genreIds = genreIds, originalLanguage = originalLanguage)
    }
    @Serializable data class Credits(val cast: List<Credit> = emptyList(), val crew: List<Credit> = emptyList())
}

object People {
    // Directors (movies) or creators (series) first, then the top-billed cast.
    suspend fun forTitle(title: Title): List<CreditPerson> {
        val tmdbId = title.tmdbId ?: return emptyList()
        // The title page's own request (credits,images): cached, so no extra call.
        val details = runCatching {
            Tmdb.get<TitlePeopleDetails>("${title.kind.tmdbPath}/$tmdbId", mapOf("append_to_response" to "credits,images", "include_image_language" to "en,null"))
        }.getOrNull() ?: return emptyList()
        val crew = if (title.kind == MediaKind.TV) details.createdBy.orEmpty().mapNotNull { p -> p.id?.let { CreditPerson(it, p.name, "Creator", Tmdb.image(p.profilePath, "w185")) } }
            else details.credits?.crew.orEmpty().filter { it.job == "Director" }.mapNotNull { p -> p.id?.let { CreditPerson(it, p.name, "Director", Tmdb.image(p.profilePath, "w185")) } }
        val cast = details.credits?.cast.orEmpty().sortedBy { it.order ?: 999 }.take(20).mapNotNull { p ->
            p.id?.let { CreditPerson(it, p.name, p.character.orEmpty().split(" / ").first().trim(), Tmdb.image(p.profilePath, "w185")) }
        }
        val seen = HashSet<Int>()
        return (crew + cast).filter { it.name.isNotEmpty() && seen.add(it.id) }
    }

    private val nonRoles = Regex("\\b(self|himself|herself|themselves|host|narrator|presenter|guest)\\b", RegexOption.IGNORE_CASE)
    private val unscripted = setOf(10767, 10763, 10764)

    private fun keep(list: List<PersonDetails.Credit>): List<PersonDetails.Credit> {
        val seen = HashSet<String>()
        return list.filter { it.mediaType == "movie" || it.mediaType == "tv" }.sortedByDescending { it.voteCount ?: 0 }.filter { seen.add("${it.mediaType}:${it.id}") }
    }

    suspend fun load(id: Int, maturity: Maturity): PersonPage? = coroutineScope {
        val data = runCatching { Tmdb.get<PersonDetails>("person/$id", mapOf("append_to_response" to "combined_credits")) }.getOrNull() ?: return@coroutineScope null
        val acting = keep(data.combinedCredits?.cast.orEmpty().filter { c ->
            !nonRoles.containsMatchIn(c.character.orEmpty()) && c.genreIds.orEmpty().none { it in unscripted } && (c.mediaType != "tv" || (c.episodeCount ?: 0) >= 3)
        })
        val directing = keep(data.combinedCredits?.crew.orEmpty().filter { (it.job == "Director" && it.mediaType == "movie") || it.job == "Creator" })
        suspend fun onBinge(credits: List<PersonDetails.Credit>): Triple<List<Title>, List<Title>, List<Title>> = coroutineScope {
            val items = credits.map { it.item }
            val movies = async { runCatching { Catalog.match(items.filter { it.mediaType == "movie" }, MediaKind.MOVIE, maturity) }.getOrDefault(emptyList()) }
            val shows = async { runCatching { Catalog.match(items.filter { it.mediaType == "tv" }, MediaKind.TV, maturity) }.getOrDefault(emptyList()) }
            val m = movies.await(); val s = shows.await()
            val rank = items.withIndex().associate { "${if (it.value.mediaType == "tv") "tv_show" else "movie"}:${it.value.id}" to it.index }
            Triple(m, s, (m + s).sortedBy { rank["${it.kind.raw}:${it.tmdbId}"] ?: Int.MAX_VALUE })
        }
        val acted = async { onBinge(acting.take(80)) }
        val directed = async { onBinge(directing.take(40)) }
        val (am, ash, _) = acted.await(); val (dm, ds, dall) = directed.await()
        val made = when { dm.isNotEmpty() && ds.isNotEmpty() -> "Directed and created by ${data.name}"; ds.isNotEmpty() -> "Created by ${data.name}"; else -> "Directed by ${data.name}" }
        val crewRow = LoadedRow("directed", made, dall)
        val actingRows = listOf(LoadedRow("movies", "Movies with ${data.name}", am), LoadedRow("series", "Series with ${data.name}", ash))
        val directs = data.knownForDepartment == "Directing" || data.knownForDepartment == "Writing"
        val rows = (if (directs) listOf(crewRow) + actingRows else actingRows + crewRow).filter { it.items.isNotEmpty() }
        PersonPage(data.name, Tmdb.image(data.profilePath, "h632"), department(data.knownForDepartment),
            lifeLine(data.birthday, data.deathday, data.placeOfBirth), data.biography.orEmpty(), rows)
    }

    fun department(value: String?) = when (value) {
        "Acting" -> "Actor"; "Directing" -> "Director"; "Writing" -> "Writer"; "Production" -> "Producer"
        null, "" -> null
        else -> value
    }

    fun lifeLine(born: String?, died: String?, place: String?): String? {
        val year = { text: String -> text.take(4) }
        if (born != null && died != null) return "${year(born)} – ${year(died)}" + (place?.let { " · Born in $it" } ?: "")
        if (born != null) return "Born ${born.take(10)}" + (place?.let { " in $it" } ?: "")
        return place?.let { "Born in $it" }
    }
}
