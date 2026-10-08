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
        if let next { UserDefaults.standard.set(next.id, forKey: lastProfileKey) }
        phase = .ready
        Task { await refreshList() }
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

    private var ownerFilter: [URLQueryItem] {
        var items = [URLQueryItem(name: "user_id", value: "eq.\(session?.userId ?? "")")]
        if let profile { items.append(URLQueryItem(name: "profile_id", value: "eq.\(profile.id)")) }
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
        return rows.compactMap { row in
            let title = row.mediaType == "movie" ? movieMap[row.mediaId] : showMap[row.mediaId]
            guard let title, !isKids || KidsFilter.allows(title.ageRating) else { return nil }
            return title
        }
    }

    func continueWatching() async throws -> [ContinueItem] {
        guard isSignedIn else { return [] }
        let rows: [ContinueRow] = try await Supabase.shared.select("continue_watching", [
            URLQueryItem(name: "select", value: ContinueRow.columns),
            URLQueryItem(name: "media_type", value: "in.(movie,tv_show)"),
            URLQueryItem(name: "order", value: "updated_at.desc"),
            URLQueryItem(name: "limit", value: "20"),
        ] + ownerFilter)
        async let movies = Catalog.titles(.movie, ids: rows.filter { $0.mediaType == "movie" }.map(\.mediaId))
        async let shows = Catalog.titles(.tvShow, ids: rows.filter { $0.mediaType == "tv_show" }.map(\.mediaId))
        let (movieMap, showMap) = try await (movies, shows)
        let items: [ContinueItem] = rows.compactMap { row in
            let title = row.mediaType == "movie" ? movieMap[row.mediaId] : showMap[row.mediaId]
            guard let title, !isKids || KidsFilter.allows(title.ageRating) else { return nil }
            return ContinueItem(title: title, season: row.currentSeason, episode: row.currentEpisode,
                                position: row.positionSeconds, duration: row.durationSeconds)
        }
        return await withBackdrops(items)
    }

    // Catalog rows only carry posters; Continue Watching cards are wide, so
    // fetch each title's backdrop from TMDB (cached).
    private func withBackdrops(_ items: [ContinueItem]) async -> [ContinueItem] {
        await withTaskGroup(of: (Int, URL?).self) { group in
            for (index, item) in items.enumerated() {
                guard let tmdbId = item.title.tmdbId else { continue }
                group.addTask {
                    let details: TMDBDetails? = try? await TMDB.shared.get("\(item.title.kind.tmdbPath)/\(tmdbId)")
                    return (index, TMDB.image(details?.backdropPath, "w780"))
                }
            }
            var result = items
            for await (index, url) in group {
                guard let url else { continue }
                var title = result[index].title
                title.backdrop = url
                let old = result[index]
                result[index] = ContinueItem(title: title, season: old.season, episode: old.episode, position: old.position, duration: old.duration)
            }
            return result
        }
    }

    func resumePoint(for title: Title) async -> ContinueRow? {
        guard isSignedIn else { return nil }
        let rows: [ContinueRow]? = try? await Supabase.shared.select("continue_watching", [
            URLQueryItem(name: "select", value: ContinueRow.columns),
            URLQueryItem(name: "media_type", value: "eq.\(title.kind.rawValue)"),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
            URLQueryItem(name: "limit", value: "1"),
        ] + ownerFilter)
        return rows?.first
    }
}
