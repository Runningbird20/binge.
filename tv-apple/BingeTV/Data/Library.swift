import Foundation

// MARK: - Watched titles (never recommended)

// The titles this profile has watched: rated, marked Watched/Watching, in
// Continue Watching, or any episode watched. Same rule and tables as the
// website's utils/watchedTitles.js. They're left out of every browse row,
// the spotlights, More Like This and Surprise me; search, franchises,
// person pages and the profile's own rows still show them.
@MainActor
final class WatchedTitles {
    static let shared = WatchedTitles()
    private(set) var keys: Set<String> = []
    private var profile: String?
    private var fetchedAt = Date.distantPast
    private var inflight: Task<Set<String>, Never>?

    // One copy per profile, reused for a minute.
    func load(_ app: AppModel, force: Bool = false) async -> Set<String> {
        let who = "\(app.session?.userId ?? ""):\(app.profile?.id ?? "")"
        guard app.isSignedIn else { return [] }
        if !force, profile == who, Date().timeIntervalSince(fetchedAt) < 60 { return keys }
        if !force, profile == who, let inflight { return await inflight.value }
        let owner = app.ownerQuery
        let task = Task { await Self.fetch(owner: owner) }
        inflight = task
        let found = await task.value
        if inflight == task { inflight = nil }
        profile = who
        keys = found
        fetchedAt = Date()
        return found
    }

    // Something was watched, rated or marked: the next load asks again.
    func invalidate() { fetchedAt = .distantPast }

    nonisolated static func fetch(owner: [URLQueryItem]) async -> Set<String> {
        struct Row: Decodable { let mediaId: Int; let mediaType: String? }
        func all(_ table: String, _ columns: String, _ extra: [URLQueryItem] = []) async -> [Row] {
            var rows: [Row] = []
            for page in 0..<10 {
                let batch: [Row]? = try? await Supabase.shared.select(table, [
                    URLQueryItem(name: "select", value: columns),
                    URLQueryItem(name: "order", value: "id"),
                    URLQueryItem(name: "limit", value: "1000"),
                    URLQueryItem(name: "offset", value: String(page * 1000)),
                ] + extra + owner)
                rows += batch ?? []
                if (batch?.count ?? 0) < 1000 { break }
            }
            return rows
        }
        async let movies = all("movie_ratings", "media_id")
        async let shows = all("tv_show_ratings", "media_id")
        async let list = all("watchlist", "media_id,media_type", [
            URLQueryItem(name: "media_type", value: "in.(movie,tv_show)"),
            URLQueryItem(name: "status", value: "in.(watched,watching)"),
        ])
        async let started = all("continue_watching", "media_id,media_type", [URLQueryItem(name: "media_type", value: "in.(movie,tv_show)")])
        async let episodes = all("episode_progress", "media_id")
        var keys = Set<String>()
        for row in await movies { keys.insert("movie:\(row.mediaId)") }
        for row in await shows { keys.insert("tv_show:\(row.mediaId)") }
        for row in await list + started { if let type = row.mediaType { keys.insert("\(type):\(row.mediaId)") } }
        for row in await episodes { keys.insert("tv_show:\(row.mediaId)") }
        return keys
    }

    static func without(_ titles: [Title], _ keys: Set<String>) -> [Title] {
        keys.isEmpty ? titles : titles.filter { !keys.contains($0.id) }
    }

    static func without(_ rows: [LoadedRow], _ keys: Set<String>) -> [LoadedRow] {
        rows.compactMap { row in
            let items = without(row.items, keys)
            return items.isEmpty ? nil : LoadedRow(id: row.id, title: row.title, items: items)
        }
    }
}

// MARK: - Episodes watched by hand

struct EpisodeKey: Hashable, Codable {
    let season: Int
    let episode: Int
}

extension AppModel {
    // Every episode of a show this profile has watched or marked.
    func watchedEpisodes(_ title: Title) async -> Set<EpisodeKey> {
        guard isSignedIn else { return [] }
        struct Row: Decodable { let season: Int; let episode: Int }
        let rows: [Row]? = try? await Supabase.shared.select("episode_progress", [
            URLQueryItem(name: "select", value: "season,episode"),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
            URLQueryItem(name: "limit", value: "5000"),
        ] + ownerQuery)
        return Set((rows ?? []).map { EpisodeKey(season: $0.season, episode: $0.episode) })
    }

    // Marked by hand: watched_at stays empty (watched elsewhere, time
    // unknown), so History and Wrapped only count what played here. Rows
    // that exist already are left alone, real watch times included.
    func markEpisodes(_ title: Title, _ episodes: [EpisodeKey], watchedAt: [EpisodeKey: String] = [:]) async throws {
        guard let session else { throw BingeError.signedOut }
        guard !episodes.isEmpty else { return }
        let rows: [[String: Any]] = episodes.map {
            ["user_id": session.userId, "profile_id": profile?.id ?? NSNull(), "media_id": title.dbId,
             "season": $0.season, "episode": $0.episode, "watched_at": watchedAt[$0] ?? NSNull()]
        }
        for start in stride(from: 0, to: rows.count, by: 500) {
            try await Supabase.shared.insertIgnoringDuplicates("episode_progress", onConflict: "user_id,media_id,season,episode,profile_id",
                                                               Array(rows[start..<min(start + 500, rows.count)]))
        }
        WatchedTitles.shared.invalidate()
    }

    // When each of these was watched (none for ones marked by hand), so an
    // undo puts the real times back.
    func episodeTimes(_ title: Title, _ episodes: [EpisodeKey]) async -> [EpisodeKey: String] {
        guard isSignedIn, !episodes.isEmpty else { return [:] }
        struct Row: Decodable { let season: Int; let episode: Int; let watchedAt: String? }
        let wanted = Set(episodes)
        let rows: [Row]? = try? await Supabase.shared.select("episode_progress", [
            URLQueryItem(name: "select", value: "season,episode,watched_at"),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
            URLQueryItem(name: "season", value: "in.(\(Set(episodes.map(\.season)).map(String.init).joined(separator: ",")))"),
            URLQueryItem(name: "limit", value: "5000"),
        ] + ownerQuery)
        var times: [EpisodeKey: String] = [:]
        for row in rows ?? [] where wanted.contains(EpisodeKey(season: row.season, episode: row.episode)) {
            if let at = row.watchedAt { times[EpisodeKey(season: row.season, episode: row.episode)] = at }
        }
        return times
    }

    func unmarkEpisodes(_ title: Title, _ episodes: [EpisodeKey]) async throws {
        guard isSignedIn else { throw BingeError.signedOut }
        for (season, list) in Dictionary(grouping: episodes, by: \.season) {
            try await Supabase.shared.delete("episode_progress", [
                URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
                URLQueryItem(name: "season", value: "eq.\(season)"),
                URLQueryItem(name: "episode", value: "in.(\(list.map { String($0.episode) }.joined(separator: ",")))"),
            ] + ownerQuery)
        }
        WatchedTitles.shared.invalidate()
    }

    // Where Continue Watching points for a show (nil when it has no row).
    func setResumeEpisode(_ title: Title, to next: EpisodeKey?, restoring old: ContinueRow? = nil) async {
        if let old {
            await saveResume(title, season: old.currentSeason ?? 1, episode: old.currentEpisode ?? 1,
                             position: old.positionSeconds ?? 0, duration: old.durationSeconds ?? 0)
        } else if let next {
            await saveResume(title, season: next.season, episode: next.episode, position: 0, duration: 0)
        }
    }

    private func saveResume(_ title: Title, season: Int, episode: Int, position: Double, duration: Double) async {
        guard let row = await resumePoint(for: title) else { return }
        try? await Supabase.shared.update("continue_watching", [URLQueryItem(name: "id", value: "eq.\(row.id)")], [
            "current_season": season, "current_episode": episode,
            "position_seconds": Int(position), "duration_seconds": Int(duration),
            "updated_at": ISO8601DateFormatter().string(from: Date()),
        ])
    }

    // Shows in Continue Watching whose newest aired episode is watched, with
    // nothing saved partway where the row points: finished, so they leave
    // the row (New Episodes still gets them, so a new one brings them back).
    func finishedShows(_ items: [ContinueItem], lastAired: [String: EpisodeKey]) async -> Set<String> {
        let candidates = items.filter { $0.title.kind == .tvShow && lastAired[$0.id] != nil && ($0.position ?? 0) <= 0 }
        guard isSignedIn, !candidates.isEmpty else { return [] }
        struct Row: Decodable { let mediaId: Int; let season: Int; let episode: Int }
        let rows: [Row]? = try? await Supabase.shared.select("episode_progress", [
            URLQueryItem(name: "select", value: "media_id,season,episode"),
            URLQueryItem(name: "media_id", value: "in.(\(candidates.map { String($0.title.dbId) }.joined(separator: ",")))"),
            URLQueryItem(name: "limit", value: "10000"),
        ] + ownerQuery)
        let watched = Set((rows ?? []).map { "\($0.mediaId):\($0.season):\($0.episode)" })
        return Set(candidates.compactMap { item in
            guard let last = lastAired[item.id] else { return nil }
            return watched.contains("\(item.title.dbId):\(last.season):\(last.episode)") ? item.id : nil
        })
    }
}

// MARK: - Marking episodes: which ones

enum EpisodeMarking {
    // "Watched up to here": every aired episode before this one (earlier
    // seasons too) and this one. Specials (season 0) aren't included.
    static func upTo(_ target: EpisodeKey, seasons: [TMDBDetails.Season], lastAired: EpisodeKey?) -> [EpisodeKey] {
        var out: [EpisodeKey] = []
        for season in seasons where season.seasonNumber > 0 && season.seasonNumber <= target.season {
            let count = season.seasonNumber == target.season ? target.episode : (season.episodeCount ?? 0)
            guard count > 0 else { continue }
            for episode in 1...count {
                let key = EpisodeKey(season: season.seasonNumber, episode: episode)
                if let lastAired, (key.season, key.episode) > (lastAired.season, lastAired.episode), key != target { continue }
                out.append(key)
            }
        }
        return out
    }

    // A whole season's aired episodes.
    static func season(_ number: Int, episodes: [TMDBSeason.Episode], lastAired: EpisodeKey?) -> [EpisodeKey] {
        episodes.filter { $0.seasonNumber == number }.map { EpisodeKey(season: $0.seasonNumber, episode: $0.episodeNumber) }
            .filter { key in lastAired.map { (key.season, key.episode) <= ($0.season, $0.episode) } ?? true }
    }

    // The episode after the furthest one marked, if it has aired.
    static func next(after marked: [EpisodeKey], seasons: [TMDBDetails.Season], lastAired: EpisodeKey?) -> EpisodeKey? {
        guard let last = marked.max(by: { ($0.season, $0.episode) < ($1.season, $1.episode) }) else { return nil }
        let regular = seasons.filter { $0.seasonNumber > 0 }
        let next: EpisodeKey?
        if let count = regular.first(where: { $0.seasonNumber == last.season })?.episodeCount, last.episode < count {
            next = EpisodeKey(season: last.season, episode: last.episode + 1)
        } else if regular.contains(where: { $0.seasonNumber == last.season + 1 && ($0.episodeCount ?? 0) > 0 }) {
            next = EpisodeKey(season: last.season + 1, episode: 1)
        } else {
            next = nil
        }
        guard let next else { return nil }
        if let lastAired, (next.season, next.episode) > (lastAired.season, lastAired.episode) { return nil }
        return next
    }
}

// MARK: - Home, saved for the next launch

// Home as it last was, on disk for 7 days per profile (like the Fire TV's
// HomeSnapshot): shown at once on launch while the fresh rows load.
struct HomeSnapshot: Codable {
    static let maxAge: TimeInterval = 7 * 86_400

    var continueItems: [ContinueItem]
    var myList: [Title]
    var personal: Personal.Rows
    var shared: [Title]
    var rows: [LoadedRow]
    var savedAt = Date()

    private static func file(_ profile: String) -> URL {
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "home", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appending(path: "\(profile.filter { $0.isLetter || $0.isNumber || $0 == "-" }).json")
    }

    static func read(_ profile: String, now: Date = Date()) -> HomeSnapshot? {
        guard let data = try? Data(contentsOf: file(profile)),
              let snapshot = try? JSONDecoder().decode(HomeSnapshot.self, from: data),
              now.timeIntervalSince(snapshot.savedAt) < maxAge else { return nil }
        return snapshot
    }

    func save(_ profile: String) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: Self.file(profile), options: .atomic)
    }
}

// MARK: - Reminders (watch_reminders, same table as the website)

struct Reminder: Decodable, Identifiable {
    let id: Int
    let mediaType: String
    let mediaId: Int
    let title: String
    let remindAt: String
}

extension AppModel {
    // Reminders waiting for this profile: due ones (shown on Home) or all
    // pending ones (the title page's "Reminder set").
    func reminders(dueOnly: Bool) async -> [Reminder] {
        guard let session else { return [] }
        var query = [
            URLQueryItem(name: "select", value: "id,media_type,media_id,title,remind_at"),
            URLQueryItem(name: "user_id", value: "eq.\(session.userId)"),
            URLQueryItem(name: "dismissed_at", value: "is.null"),
            URLQueryItem(name: "media_type", value: "in.(movie,tv_show)"),
            URLQueryItem(name: "order", value: "remind_at.asc"),
            URLQueryItem(name: "limit", value: "50"),
        ]
        if let profile { query.append(URLQueryItem(name: "profile_id", value: "eq.\(profile.id)")) }
        query.append(dueOnly
            ? URLQueryItem(name: "remind_at", value: "lte.\(ISO8601DateFormatter().string(from: Date()))")
            : URLQueryItem(name: "sent_at", value: "is.null"))
        return (try? await Supabase.shared.select("watch_reminders", query)) ?? []
    }

    func addReminder(_ title: Title, at when: Date) async throws {
        guard let session else { throw BingeError.signedOut }
        try await Supabase.shared.insert("watch_reminders", [
            "user_id": session.userId,
            "profile_id": profile?.id ?? NSNull(),
            "media_type": title.kind.rawValue,
            "media_id": title.dbId,
            "title": title.name,
            "url": "/\(title.kind.sitePath)/\(title.dbId)",
            "remind_at": ISO8601DateFormatter().string(from: when),
        ])
    }

    func dismissReminder(_ id: Int) async {
        try? await Supabase.shared.update("watch_reminders", [URLQueryItem(name: "id", value: "eq.\(id)")],
                                          ["dismissed_at": ISO8601DateFormatter().string(from: Date())])
    }
}

enum ReleaseReminder {
    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    // What's coming and when (nil when nothing is): a movie's release, or a
    // series' next episode. Reminded at 9 in the morning that day.
    static func upcoming(_ title: Title, details: TMDBDetails?, now: Date = Date()) -> (label: String, at: Date)? {
        let calendar = Calendar.current
        func morning(_ text: String?) -> Date? {
            guard let text, let date = day.date(from: String(text.prefix(10))) else { return nil }
            let at = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: date) ?? date
            return calendar.startOfDay(for: date) > calendar.startOfDay(for: now) ? at : nil
        }
        if title.kind == .movie, let at = morning(details?.releaseDate) {
            return ("Remind me when it's out", at)
        }
        if let next = details?.nextEpisodeToAir, let at = morning(next.airDate) {
            return ("Remind me about S\(next.seasonNumber):E\(next.episodeNumber)", at)
        }
        return nil
    }
}

// MARK: - Surprise me (the website's utils/surprise.js)

enum Surprise {
    private static let recentKey = "binge.surprise.recent"
    static var recent: [String] { UserDefaults.standard.stringArray(forKey: recentKey) ?? [] }

    static func remember(_ title: Title) {
        UserDefaults.standard.set(Array(([title.id] + recent.filter { $0 != title.id }).prefix(6)), forKey: recentKey)
    }

    // Top Picks, then the "Because you…" rows; trending when there's no
    // history. Not out yet, or watched: never picked.
    static func pool(_ personal: Personal.Rows, fallback: [Title], kind: MediaKind, exclude: Set<String>) -> [Title] {
        var seen = exclude
        var pool: [Title] = []
        func add(_ items: [Title], _ limit: Int) {
            for title in items.filter({ $0.kind == kind && !$0.comingSoon && !seen.contains($0.id) }).prefix(limit) where seen.insert(title.id).inserted {
                pool.append(title)
            }
        }
        add(personal.topPicks?.items ?? [], 15)
        personal.because.forEach { add($0.items, 6) }
        if pool.isEmpty { add(fallback, 20) }
        return pool
    }

    // Random, leaning toward the top, skipping the last few surprises.
    static func pick(_ pool: [Title], recent: [String], random: () -> Double = { Double.random(in: 0..<1) }) -> Title? {
        let fresh = pool.filter { !recent.contains($0.id) }
        let choices = fresh.isEmpty ? pool : fresh
        guard !choices.isEmpty else { return nil }
        let weights = choices.indices.map { 1 / (1 + Double($0) * 0.12) }
        var roll = random() * weights.reduce(0, +)
        for (index, weight) in weights.enumerated() {
            roll -= weight
            if roll <= 0 { return choices[index] }
        }
        return choices.last
    }
}

// MARK: - Recent searches (per profile, this Apple TV)

enum RecentSearches {
    static let limit = 8
    private static func key(_ profile: String?) -> String { "binge.recentSearches.\(profile ?? "none")" }

    static func list(_ profile: String?) -> [String] { UserDefaults.standard.stringArray(forKey: key(profile)) ?? [] }

    static func add(_ query: String, profile: String?) {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 2 else { return }
        let rest = list(profile).filter { $0.caseInsensitiveCompare(text) != .orderedSame }
        UserDefaults.standard.set(Array(([text] + rest).prefix(limit)), forKey: key(profile))
    }

    static func clear(_ profile: String?) { UserDefaults.standard.removeObject(forKey: key(profile)) }
}

// MARK: - Hide scores (Sports)

enum ScoreVisibility {
    // Same name as the website's setting (binge.sports.hideScores).
    static let key = "binge.sports.hideScores"
    static var hidden: Bool { UserDefaults.standard.bool(forKey: key) }
}
