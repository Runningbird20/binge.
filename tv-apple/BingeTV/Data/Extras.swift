import Foundation

// Site features reused by the TV app: admin server switches, outside
// ratings, your own star ratings, the AI search, franchise order, and the
// community audio reports. Same tables / endpoints as the website.

// MARK: - Admin server switches (server_config, public read)

actor ServerSwitches {
    static let shared = ServerSwitches()
    private var disabled: Set<String> = []
    private var fetchedAt = Date.distantPast

    // Servers an admin has turned off in the panel. Refreshed every 2 min.
    func disabledServers() async -> Set<String> {
        if Date().timeIntervalSince(fetchedAt) < 120 { return disabled }
        struct Row: Decodable { let provider: String; let enabled: Bool }
        if let rows: [Row] = try? await Supabase.shared.select("server_config", [
            URLQueryItem(name: "select", value: "provider,enabled"),
        ], auth: .optional) {
            disabled = Set(rows.filter { !$0.enabled }.map(\.provider))
            fetchedAt = Date()
        }
        return disabled
    }
}

// MARK: - Playback preferences (account_profiles.audio_pref / subtitle_pref)

enum PlaybackPrefs {
    static let audioChoices: [(String, String)] = [
        ("original", "Original language"), ("en", "English"), ("es", "Spanish"), ("fr", "French"),
        ("ja", "Japanese"), ("ko", "Korean"), ("hi", "Hindi"),
    ]
    static let subtitleChoices: [(String, String)] = [
        ("off", "Off"), ("en", "English"), ("es", "Spanish"), ("fr", "French"),
        ("pt", "Portuguese"), ("de", "German"), ("ar", "Arabic"),
    ]

    // Subtitle look (this Apple TV): size and background behind the text.
    static let captionSizes: [(Int, String)] = [(80, "Small"), (100, "Default"), (135, "Large"), (175, "Extra large")]
    static let captionBackgrounds: [(String, String)] = [
        ("transparent", "None"), ("rgba(0,0,0,0.6)", "Shaded"), ("rgba(0,0,0,1)", "Solid"),
    ]
    static var captionSize: Int { UserDefaults.standard.object(forKey: "binge.captionSize") as? Int ?? 100 }
    static var captionBackground: String { UserDefaults.standard.string(forKey: "binge.captionBackground") ?? "rgba(0,0,0,0.6)" }
    // Prefer an audio-description track when the video has one.
    static var audioDescription: Bool { UserDefaults.standard.bool(forKey: "binge.audioDescription") }

    // Read by the server URL builders (CineSrc takes a subtitle language).
    nonisolated(unsafe) static var subtitle = "en"
    nonisolated(unsafe) static var audio = "original"

    static func languageName(_ code: String) -> String {
        Locale(identifier: "en").localizedString(forLanguageCode: code) ?? code
    }
}

// The title's own language: the catalog's, or TMDB's when the catalog row
// doesn't have one (many don't).
enum OriginalLanguage {
    static func of(_ title: Title) async -> String? {
        if let known = title.originalLanguage, !known.isEmpty { return known }
        guard let tmdbId = title.tmdbId,
              let details: TMDBDetails = try? await TMDB.shared.get("\(title.kind.tmdbPath)/\(tmdbId)") else { return nil }
        return details.originalLanguage
    }
}

// MARK: - Community audio reports → server choice

enum ServerPlan {
    struct Report: Decodable {
        let provider: String
        let worksCount: Int?
        let brokenCount: Int?
        let audioLang: String?
        let audioCount: Int?
    }

    // Movie/TV servers for a title: admin switches applied, then the audio
    // preference. If viewers reported a server playing the wanted audio, race
    // only those; servers reported in a different language drop out.
    static func servers(for title: Title, originalLanguage: String?) async -> [StreamServer] {
        let disabled = await ServerSwitches.shared.disabledServers()
        var list = StreamServer.ranked(for: title).filter { !disabled.contains($0.id) }
        #if DEBUG
        // -BingeServer vidrift: race only that server (testing).
        if let only = UserDefaults.standard.string(forKey: "BingeServer") { list = list.filter { $0.id == only } }
        #endif
        let original: String?
        if let originalLanguage { original = originalLanguage } else { original = await OriginalLanguage.of(title) }
        let wanted = PlaybackPrefs.audio == "original" ? original : PlaybackPrefs.audio
        guard let wanted, !wanted.isEmpty else { return list }
        let reports: [Report] = (try? await Supabase.shared.rpc("stream_report_summary", [
            "p_media_type": title.kind.rawValue, "p_media_id": title.dbId,
        ])) ?? []
        let audio = Dictionary(reports.compactMap { r in r.audioLang.map { (r.provider, $0) } }, uniquingKeysWith: { a, _ in a })
        let matching = list.filter { audio[$0.id] == wanted }
        if !matching.isEmpty { return matching + list.filter { audio[$0.id] == nil } }
        list.removeAll { audio[$0.id] != nil && audio[$0.id] != wanted }
        return list.isEmpty ? StreamServer.ranked(for: title).filter { !disabled.contains($0.id) } : list
    }
}

// MARK: - Outside ratings (IMDb / Rotten Tomatoes / Metacritic)

struct OutsideRatings: Decodable {
    let imdbRating: Double?
    let imdbVotes: Int?
    let rottenTomatoes: Int?
    let metacritic: Int?

    // Looked up by the site's server (its OMDb key stays server-side) and
    // cached in title_ratings for everyone.
    static func load(_ title: Title) async -> OutsideRatings? {
        guard let tmdbId = title.tmdbId else { return nil }
        var components = URLComponents(url: Config.siteURL.appending(path: "api/extras/ratings"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "type", value: title.kind == .tvShow ? "tv" : "movie"),
                                 URLQueryItem(name: "tmdb", value: String(tmdbId))]
        guard let (data, response) = try? await URLSession.shared.data(from: components.url!),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let ratings = try? decoder.decode(OutsideRatings.self, from: data)
        return ratings?.imdbRating == nil && ratings?.rottenTomatoes == nil ? nil : ratings
    }
}

// MARK: - Your rating (1–5 stars → every criterion, like the site's import)

enum UserRatings {
    static let criteria: [MediaKind: [String]] = [
        .movie: ["acting", "writing", "originality", "pacing", "cinematography"],
        .tvShow: ["premise", "originality", "acting", "cinematography", "writing", "pacing", "resonance"],
    ]
    static func table(_ kind: MediaKind) -> String { kind == .movie ? "movie_ratings" : "tv_show_ratings" }
}

extension AppModel {
    func myRating(for title: Title) async -> Double? {
        guard isSignedIn, let fields = UserRatings.criteria[title.kind] else { return nil }
        let rows: [[String: Double?]]? = try? await Supabase.shared.select(UserRatings.table(title.kind), [
            URLQueryItem(name: "select", value: fields.joined(separator: ",")),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
            URLQueryItem(name: "limit", value: "1"),
        ] + ownerQuery)
        guard let row = rows?.first else { return nil }
        let values = row.values.compactMap { $0 }
        return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
    }

    // Saves the same row the website writes; a rated title counts as watched,
    // so it leaves My List (the site does the same).
    func rate(_ title: Title, stars: Int) async throws {
        guard let session, let fields = UserRatings.criteria[title.kind] else { throw BingeError.signedOut }
        var row: [String: Any] = [:]
        for field in fields { row[field] = Double(stars) }
        let table = UserRatings.table(title.kind)
        let match = [
            URLQueryItem(name: "user_id", value: "eq.\(session.userId)"),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
            URLQueryItem(name: "profile_id", value: profile.map { "eq.\($0.id)" } ?? "is.null"),
        ]
        struct IdRow: Decodable { let id: Int }
        let existing: [IdRow] = try await Supabase.shared.select(table, [URLQueryItem(name: "select", value: "id")] + match)
        if let id = existing.first?.id {
            try await Supabase.shared.update(table, [URLQueryItem(name: "id", value: "eq.\(id)")], row)
        } else {
            row["user_id"] = session.userId
            row["profile_id"] = profile?.id ?? NSNull()
            row["media_id"] = title.dbId
            try await Supabase.shared.insert(table, row)
        }
        if let listId = listIds[title.id] {
            try? await Supabase.shared.delete("watchlist", [URLQueryItem(name: "id", value: "eq.\(listId)")])
            await refreshList()
        }
    }

    // MARK: Playback preferences

    func applyPrefs() {
        PlaybackPrefs.audio = profile?.audioPref ?? "original"
        PlaybackPrefs.subtitle = profile?.subtitlePref ?? "en"
    }

    func savePrefs(audio: String? = nil, subtitle: String? = nil) async {
        if let audio { PlaybackPrefs.audio = audio }
        if let subtitle { PlaybackPrefs.subtitle = subtitle }
        guard let id = profile?.id else { return }
        var row: [String: Any] = [:]
        if let audio { row["audio_pref"] = audio }
        if let subtitle { row["subtitle_pref"] = subtitle }
        try? await Supabase.shared.update("account_profiles", [URLQueryItem(name: "id", value: "eq.\(id)")], row)
        await reloadProfile()
    }

    // MARK: Episodes watched (episode_progress, like the site)

    func markEpisodeWatched(_ title: Title, season: Int, episode: Int) async {
        guard let session else { return }
        let match = [
            URLQueryItem(name: "user_id", value: "eq.\(session.userId)"),
            URLQueryItem(name: "media_id", value: "eq.\(title.dbId)"),
            URLQueryItem(name: "season", value: "eq.\(season)"),
            URLQueryItem(name: "episode", value: "eq.\(episode)"),
            URLQueryItem(name: "profile_id", value: profile.map { "eq.\($0.id)" } ?? "is.null"),
        ]
        struct Row: Decodable { let season: Int }
        let existing: [Row]? = try? await Supabase.shared.select("episode_progress", [URLQueryItem(name: "select", value: "season")] + match)
        guard existing?.isEmpty == true else { return }
        try? await Supabase.shared.insert("episode_progress", [
            "user_id": session.userId, "profile_id": profile?.id ?? NSNull(), "media_id": title.dbId,
            "season": season, "episode": episode, "watched_at": ISO8601DateFormatter().string(from: Date()),
        ])
    }
}

// MARK: - Ask binge. (the site's Groq-backed /api/extras/ai/picks)

enum AskBinge {
    struct Pick: Decodable { let tmdbId: Int; let mediaType: String; let why: String? }
    struct Response: Decodable { let summary: String?; let picks: [Pick]?; let error: String? }

    // Sentence-like queries ("something like Severance but funnier") run
    // automatically; plain titles don't.
    static func isConversational(_ query: String) -> Bool {
        let words = query.split(separator: " ")
        let lower = query.lowercased()
        let cues = ["like ", "something", "movies ", "shows ", "series ", "funny", "scary", "under ", "about ", "with ", "for a ", "feel", "similar"]
        // How people talk to the remote ("show me…", "I want…").
        let spoken = ["show me", "find me", "i want", "i'm in the mood", "im in the mood", "recommend", "what should i", "give me", "play something"]
        if spoken.contains(where: { lower.hasPrefix($0) }) { return true }
        return words.count >= 4 || cues.contains { lower.contains($0) } && words.count >= 3
    }

    static func ask(_ query: String, kids: Bool) async throws -> (summary: String?, titles: [(Title, String?)]) {
        var request = URLRequest(url: Config.siteURL.appending(path: "api/extras/ai/picks"), timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["q": query])
        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(Response.self, from: data)
        if let error = response.error { throw BingeError.http(0, error) }
        let picks = response.picks ?? []
        let keys = picks.map { pick in (pick.mediaType == "tv_show" ? MediaKind.tvShow : .movie, pick) }
        async let movies = Catalog.match(keys.filter { $0.0 == .movie }.map { stub($0.1) }, kind: .movie, kids: kids)
        async let shows = Catalog.match(keys.filter { $0.0 == .tvShow }.map { stub($0.1) }, kind: .tvShow, kids: kids)
        let found = try await movies + shows
        let byKey = Dictionary(found.map { ("\($0.kind.rawValue):\($0.tmdbId ?? 0)", $0) }, uniquingKeysWith: { a, _ in a })
        let titles = picks.compactMap { pick -> (Title, String?)? in
            guard let title = byKey["\(pick.mediaType):\(pick.tmdbId)"] else { return nil }
            return (title, pick.why)
        }
        return (response.summary, titles)
    }

    private static func stub(_ pick: Pick) -> TMDBItem {
        TMDBItem(id: pick.tmdbId, title: nil, name: nil, overview: nil, posterPath: nil, backdropPath: nil,
                 releaseDate: nil, firstAirDate: nil, voteAverage: nil, mediaType: nil, genreIds: nil, knownFor: nil)
    }
}

// MARK: - Franchise watch order (same curated lists as src/utils/franchises.js)

enum Franchises {
    struct Curated { let name: String; let release: [Int]; let story: [Int] }

    static let curated: [Curated] = [
        Curated(name: "Marvel Cinematic Universe",
                release: [1726, 1724, 10138, 10195, 1771, 24428, 68721, 76338, 100402, 118340, 99861, 102899, 271110, 284052, 283995,
                          315635, 284053, 284054, 299536, 363088, 299537, 299534, 429617, 497698, 566525, 524434, 634649, 453395, 616037,
                          505642, 640146, 447365, 609681, 533535, 822119, 986056, 617126],
                story: [1771, 299537, 1726, 10138, 1724, 10195, 24428, 76338, 68721, 100402, 118340, 283995, 99861, 102899, 271110,
                        497698, 284054, 315635, 284052, 284053, 363088, 299536, 299534, 429617, 566525, 524434, 634649, 453395, 616037,
                        505642, 447365, 640146, 609681, 533535, 822119, 986056, 617126]),
        Curated(name: "Star Wars",
                release: [11, 1891, 1892, 1893, 1894, 1895, 140607, 330459, 181808, 348350, 181812],
                story: [1893, 1894, 1895, 348350, 330459, 11, 1891, 1892, 140607, 181808, 181812]),
        Curated(name: "Fast & Furious",
                release: [9799, 584, 9615, 13804, 51497, 82992, 168259, 337339, 384018, 385128, 385687],
                story: [9799, 584, 13804, 51497, 82992, 9615, 168259, 337339, 384018, 385128, 385687]),
    ]

    struct Order { let name: String; let release: [Title]; let story: [Title]? }

    static func find(for title: Title, kids: Bool) async -> Order? {
        guard title.kind == .movie, let tmdbId = title.tmdbId else { return nil }
        if let franchise = curated.first(where: { $0.release.contains(tmdbId) }) {
            let items = franchise.release.map { id in
                TMDBItem(id: id, title: nil, name: nil, overview: nil, posterPath: nil, backdropPath: nil, releaseDate: nil,
                         firstAirDate: nil, voteAverage: nil, mediaType: nil, genreIds: nil, knownFor: nil)
            }
            let matched = (try? await Catalog.match(items, kind: .movie, kids: kids)) ?? []
            let byId = Dictionary(matched.map { ($0.tmdbId ?? 0, $0) }, uniquingKeysWith: { a, _ in a })
            let posters = await withTaskGroup(of: (Int, URL?).self) { group in
                for id in byId.keys { group.addTask {
                    let d: TMDBDetails? = try? await TMDB.shared.get("movie/\(id)")
                    return (id, TMDB.image(d?.posterPath, "w342"))
                } }
                var out: [Int: URL] = [:]
                for await (id, url) in group { if let url { out[id] = url } }
                return out
            }
            func pick(_ ids: [Int]) -> [Title] {
                ids.compactMap { id in byId[id].map { var t = $0; t.poster = posters[id] ?? t.poster; return t } }
            }
            return Order(name: franchise.name, release: pick(franchise.release), story: pick(franchise.story))
        }
        struct Details: Decodable { struct Collection: Decodable { let id: Int }; let belongsToCollection: Collection? }
        struct CollectionInfo: Decodable { let name: String; let parts: [TMDBItem] }
        guard let details: Details = try? await TMDB.shared.get("movie/\(tmdbId)"),
              let id = details.belongsToCollection?.id,
              let collection: CollectionInfo = try? await TMDB.shared.get("collection/\(id)") else { return nil }
        let parts = collection.parts.filter { $0.releaseDate?.isEmpty == false }.sorted { ($0.releaseDate ?? "") < ($1.releaseDate ?? "") }
        let titles = (try? await Catalog.match(parts, kind: .movie, kids: kids)) ?? []
        guard titles.count >= 2 else { return nil }
        let name = collection.name.replacingOccurrences(of: " Collection", with: "")
        return Order(name: name, release: titles, story: nil)
    }
}
