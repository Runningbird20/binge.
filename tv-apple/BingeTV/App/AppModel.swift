import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    enum Phase { case loading, signedOut, choosingProfile, ready }

    @Published var phase: Phase = .loading
    @Published private(set) var session: AuthSession?
    @Published private(set) var profiles: [AccountProfile] = []
    @Published private(set) var profile: AccountProfile?
    @Published private(set) var listIds: [String: Int] = [:] // Title.id → watchlist row id
    @Published var profileLoadError: String?
    // From Top Shelf (binge:// links); Home opens it once a profile is set.
    @Published var deepLink: DeepLink?
    // Debug-only: browse without an account (-BingeDemo launch argument).
    @Published private(set) var isDemo = false

    var isKids: Bool { profile?.isKids ?? false }
    var isSignedIn: Bool { session != nil }

    private var lastProfileKey: String { "binge.lastProfile.\(session?.userId ?? "")" }
    var lastProfileId: String? { UserDefaults.standard.string(forKey: lastProfileKey) }

    func start() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-BingeDemo") {
            isDemo = true
            phase = .ready
            return
        }
        #endif
        session = await Supabase.shared.session
        if session == nil {
            phase = .signedOut
        } else {
            await loadProfiles()
        }
    }

    func signIn(email: String, password: String) async throws {
        session = try await Supabase.shared.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        await loadProfiles()
    }

    func signOut() async {
        await Supabase.shared.signOut()
        session = nil
        profiles = []
        profile = nil
        listIds = [:]
        phase = .signedOut
    }

    // Netflix-style: with more than one profile, ask who's watching on launch.
    func loadProfiles() async {
        guard let session else { phase = .signedOut; return }
        profileLoadError = nil
        do {
            profiles = try await Supabase.shared.select("account_profiles", [
                URLQueryItem(name: "select", value: AccountProfile.columns),
                URLQueryItem(name: "account_id", value: "eq.\(session.userId)"),
                URLQueryItem(name: "order", value: "is_default.desc,created_at.asc"),
            ])
            if profiles.count > 1 {
                phase = .choosingProfile
            } else {
                choose(profiles.first)
            }
        } catch {
            if handle(error) { return }
            profileLoadError = error.localizedDescription
            phase = .choosingProfile
        }
    }

    func choose(_ next: AccountProfile?) {
        profile = next
        applyPrefs()
        if let next { UserDefaults.standard.set(next.id, forKey: lastProfileKey) }
        phase = .ready
        Task { await refreshList() }
    }

    var ownerQuery: [URLQueryItem] { ownerFilter }

    func reloadProfile() async {
        guard let id = profile?.id,
              let rows: [AccountProfile] = try? await Supabase.shared.select("account_profiles", [
                URLQueryItem(name: "select", value: AccountProfile.columns),
                URLQueryItem(name: "id", value: "eq.\(id)"),
              ]), let fresh = rows.first else { return }
        profile = fresh
        if let index = profiles.firstIndex(where: { $0.id == id }) { profiles[index] = fresh }
        applyPrefs()
    }

    func switchProfile() {
        phase = .choosingProfile
    }

    // Returns true when the error ended the session (the UI then shows sign-in).
    @discardableResult
    func handle(_ error: Error) -> Bool {
        if case BingeError.signedOut = error {
            session = nil
            phase = .signedOut
            return true
        }
        return false
    }

    // MARK: Per-profile data (same tables and profile_id scoping as the site)

    // Rows saved before profiles existed have no profile_id; they belong to
    // the account's main profile, so that profile sees them too.
    private var ownerFilter: [URLQueryItem] {
        var items = [URLQueryItem(name: "user_id", value: "eq.\(session?.userId ?? "")")]
        if let profile {
            if profile.isDefault || profiles.count <= 1 {
                items.append(URLQueryItem(name: "or", value: "(profile_id.eq.\(profile.id),profile_id.is.null)"))
            } else {
                items.append(URLQueryItem(name: "profile_id", value: "eq.\(profile.id)"))
            }
        }
        return items
    }

    func refreshList() async {
        guard isSignedIn else { return }
        do {
            let rows: [WatchlistRow] = try await Supabase.shared.select("watchlist", [
                URLQueryItem(name: "select", value: "id,media_type,media_id"),
                URLQueryItem(name: "media_type", value: "in.(movie,tv_show)"),
            ] + ownerFilter)
            listIds = Dictionary(rows.map { ("\($0.mediaType):\($0.mediaId)", $0.id) }, uniquingKeysWith: { first, _ in first })
        } catch {
            handle(error)
        }
    }

    func isInList(_ title: Title) -> Bool { listIds[title.id] != nil }

    func toggleList(_ title: Title) async throws {
        guard let session else { throw BingeError.signedOut }
        if let rowId = listIds[title.id] {
            try await Supabase.shared.delete("watchlist", [URLQueryItem(name: "id", value: "eq.\(rowId)")])
            listIds[title.id] = nil
        } else {
            try await Supabase.shared.insert("watchlist", [
                "user_id": session.userId,
                "profile_id": profile?.id ?? NSNull(),
                "media_type": title.kind.rawValue,
                "media_id": title.dbId,
                "status": "plan_to_watch",
            ])
            await refreshList()
        }
    }

    func myList() async throws -> [Title] {
        guard isSignedIn else { return [] }
        let rows: [WatchlistRow] = try await Supabase.shared.select("watchlist", [
            URLQueryItem(name: "select", value: "id,media_type,media_id"),
            URLQueryItem(name: "media_type", value: "in.(movie,tv_show)"),
            URLQueryItem(name: "order", value: "added_at.desc"),
            URLQueryItem(name: "limit", value: "40"),
        ] + ownerFilter)
        async let movies = Catalog.titles(.movie, ids: rows.filter { $0.mediaType == "movie" }.map(\.mediaId))
        async let shows = Catalog.titles(.tvShow, ids: rows.filter { $0.mediaType == "tv_show" }.map(\.mediaId))
        let (movieMap, showMap) = try await (movies, shows)
        var seen = Set<String>()
        return rows.compactMap { row in
            let title = row.mediaType == "movie" ? movieMap[row.mediaId] : showMap[row.mediaId]
            guard let title, !isKids || KidsFilter.allows(title.ageRating), seen.insert(title.id).inserted else { return nil }
            return title
        }
    }

    func continueWatching() async throws -> [ContinueItem] {
        guard isSignedIn else { return [] }
        let rows: [ContinueRow] = try await Supabase.shared.select("continue_watching", [
            URLQueryItem(name: "select", value: ContinueRow.columns),
            URLQueryItem(name: "media_type", value: "in.(movie,tv_show)"),
            URLQueryItem(name: "order", value: "updated_at.desc"),
            URLQueryItem(name: "limit", value: "60"),
        ] + ownerFilter)
        async let movies = Catalog.titles(.movie, ids: rows.filter { $0.mediaType == "movie" }.map(\.mediaId))
        async let shows = Catalog.titles(.tvShow, ids: rows.filter { $0.mediaType == "tv_show" }.map(\.mediaId))
        let (movieMap, showMap) = try await (movies, shows)
        var seen = Set<String>()
        let items: [ContinueItem] = rows.compactMap { row in
            let title = row.mediaType == "movie" ? movieMap[row.mediaId] : showMap[row.mediaId]
            guard let title, !isKids || KidsFilter.allows(title.ageRating), seen.insert(title.id).inserted else { return nil }
            return ContinueItem(title: title, season: row.currentSeason, episode: row.currentEpisode,
                                position: row.positionSeconds, duration: row.durationSeconds)
        }
        return await withBackdrops(items)
    }

    // Catalog rows only carry posters; Continue Watching cards are wide, so
    // fetch each title's backdrop from TMDB (cached). The same call says
    // whether a newer episode aired in the last two weeks.
    private func withBackdrops(_ items: [ContinueItem]) async -> [ContinueItem] {
        await withTaskGroup(of: (Int, TMDBDetails?).self) { group in
            for (index, item) in items.enumerated() {
                guard let tmdbId = item.title.tmdbId else { continue }
                group.addTask {
                    (index, try? await TMDB.shared.get("\(item.title.kind.tmdbPath)/\(tmdbId)") as TMDBDetails)
                }
            }
            var result = items
            for await (index, details) in group {
                guard let details else { continue }
                if let backdrop = TMDB.image(details.backdropPath, "w780") { result[index].title.backdrop = backdrop }
                if let aired = details.lastEpisodeToAir, let date = aired.airDate,
                   ReleaseWindow.isRecent(date, days: 14),
                   (aired.seasonNumber, aired.episodeNumber) > (result[index].season ?? 0, result[index].episode ?? 0) {
                    result[index].newEpisode = "S\(aired.seasonNumber):E\(aired.episodeNumber)"
                }
            }
            return result
        }
    }

    // Highly rated titles (average of the rating criteria ≥ 4★), newest first.
    func lovedTitles() async -> [Title] {
        guard isSignedIn else { return [] }
        struct Rating: Decodable {
            let mediaId: Int
            let acting, writing, originality, pacing, cinematography: Double?
            let premise, resonance: Double?
            var average: Double {
                let parts = [acting, writing, originality, pacing, cinematography, premise, resonance].compactMap { $0 }
                return parts.isEmpty ? 0 : parts.reduce(0, +) / Double(parts.count)
            }
        }
        async let movieRows: [Rating]? = try? Supabase.shared.select("movie_ratings", [
            URLQueryItem(name: "select", value: "media_id,acting,writing,originality,pacing,cinematography"),
            URLQueryItem(name: "order", value: "created_at.desc"), URLQueryItem(name: "limit", value: "40"),
        ] + ownerFilter)
        async let showRows: [Rating]? = try? Supabase.shared.select("tv_show_ratings", [
            URLQueryItem(name: "select", value: "media_id,premise,originality,acting,cinematography,writing,pacing,resonance"),
            URLQueryItem(name: "order", value: "created_at.desc"), URLQueryItem(name: "limit", value: "40"),
        ] + ownerFilter)
        let (m, t) = await (movieRows ?? [], showRows ?? [])
        let lovedMovies = m.filter { $0.average >= 4 }.map(\.mediaId)
        let lovedShows = t.filter { $0.average >= 4 }.map(\.mediaId)
        let movieMap = (try? await Catalog.titles(.movie, ids: lovedMovies)) ?? [:]
        let showMap = (try? await Catalog.titles(.tvShow, ids: lovedShows)) ?? [:]
        let titles = lovedShows.compactMap { showMap[$0] } + lovedMovies.compactMap { movieMap[$0] }
        return titles.filter { !isKids || KidsFilter.allows($0.ageRating) }
    }

    // Every rated title (for excluding from picks).
    func ratedIds() async -> Set<String> {
        guard isSignedIn else { return [] }
        struct Row: Decodable { let mediaId: Int }
        async let m: [Row]? = try? Supabase.shared.select("movie_ratings", [URLQueryItem(name: "select", value: "media_id")] + ownerFilter)
        async let t: [Row]? = try? Supabase.shared.select("tv_show_ratings", [URLQueryItem(name: "select", value: "media_id")] + ownerFilter)
        let (movies, shows) = await (m ?? [], t ?? [])
        return Set(movies.map { "movie:\($0.mediaId)" } + shows.map { "tv_show:\($0.mediaId)" })
    }

    // Same continue_watching row the website writes, so the phone, laptop
    // and TV all resume from the same spot.
    func saveProgress(title: Title, season: Int?, episode: Int?, position: Double, duration: Double) async {
        guard let session, !isDemo else { return }
        var row: [String: Any] = [
            "updated_at": ISO8601DateFormatter().string(from: Date()),
            "position_seconds": Int(position),
            "duration_seconds": Int(duration),
        ]
        if title.kind == .tvShow {
            row["current_season"] = season ?? 1
            row["current_episode"] = episode ?? 1
        }
        let match = [
            URLQueryItem(name: "user_id", value: "eq.\(session.userId)"),
            URLQueryItem(name: "media_type", value: "eq.\(title.kind.rawValue)"),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
            URLQueryItem(name: "profile_id", value: profile.map { "eq.\($0.id)" } ?? "is.null"),
        ]
        do {
            let existing: [ContinueRow] = try await Supabase.shared.select("continue_watching", [
                URLQueryItem(name: "select", value: ContinueRow.columns), URLQueryItem(name: "limit", value: "1"),
            ] + match)
            if let current = existing.first {
                try await Supabase.shared.update("continue_watching", [URLQueryItem(name: "id", value: "eq.\(current.id)")], row)
            } else {
                row["user_id"] = session.userId
                row["profile_id"] = profile?.id ?? NSNull()
                row["media_type"] = title.kind.rawValue
                row["media_id"] = title.dbId
                try await Supabase.shared.insert("continue_watching", row)
            }
        } catch {
            handle(error)
        }
    }

    func removeFromContinue(_ title: Title) async {
        guard let session else { return }
        try? await Supabase.shared.delete("continue_watching", [
            URLQueryItem(name: "user_id", value: "eq.\(session.userId)"),
            URLQueryItem(name: "media_type", value: "eq.\(title.kind.rawValue)"),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
        ] + ownerFilter.filter { $0.name != "user_id" })
    }

    func resumePoint(for title: Title) async -> ContinueRow? {
        guard isSignedIn else { return nil }
        let rows: [ContinueRow]? = try? await Supabase.shared.select("continue_watching", [
            URLQueryItem(name: "select", value: ContinueRow.columns),
            URLQueryItem(name: "media_type", value: "eq.\(title.kind.rawValue)"),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
            URLQueryItem(name: "order", value: "updated_at.desc"),
            URLQueryItem(name: "limit", value: "1"),
        ] + ownerFilter)
        return rows?.first
    }
}
