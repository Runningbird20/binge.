import Foundation

struct RowSpec: Identifiable, Sendable {
    let id: String
    let title: String
    let kind: MediaKind
    let path: String
    var params: [String: String] = [:]
}

struct LoadedRow: Identifiable {
    let id: String
    let title: String
    let items: [Title]
}

// TMDB lists matched back to catalog rows through
// source_key = 'tmdb:{movie|tv}:{id}', like the site's catalogLookup.js.
enum Catalog {
    static func match(_ items: [TMDBItem], kind: MediaKind, kids: Bool) async throws -> [Title] {
        let candidates = items.filter { ReleaseWindow.isVisible($0.date) }
        guard !candidates.isEmpty else { return [] }

        let keys = candidates.map { "\"tmdb:\(kind.tmdbPath):\($0.id)\"" }.joined(separator: ",")
        let rows: [CatalogRow] = try await Supabase.shared.select(kind.table, [
            URLQueryItem(name: "select", value: CatalogRow.columns),
            URLQueryItem(name: "source_key", value: "in.(\(keys))"),
        ], auth: .optional)

        var byKey: [String: CatalogRow] = [:]
        for row in rows { if let key = row.sourceKey, byKey[key] == nil { byKey[key] = row } }

        var seen = Set<Int>()
        return candidates.compactMap { item in
            guard let row = byKey["tmdb:\(kind.tmdbPath):\(item.id)"], seen.insert(row.id).inserted else { return nil }
            if kids && !KidsFilter.allows(row.ageRating) { return nil }
            var title = row.asTitle(kind)
            title.poster = TMDB.image(item.posterPath, "w342") ?? title.poster
            title.backdrop = TMDB.image(item.backdropPath, "w780")
            title.tmdbId = item.id
            title.comingSoon = ReleaseWindow.isComingSoon(item.date)
            return title
        }
    }

    static func titles(_ kind: MediaKind, ids: [Int]) async throws -> [Int: Title] {
        let unique = Array(Set(ids))
        guard !unique.isEmpty else { return [:] }
        let rows: [CatalogRow] = try await Supabase.shared.select(kind.table, [
            URLQueryItem(name: "select", value: CatalogRow.columns),
            URLQueryItem(name: "id", value: "in.(\(unique.map(String.init).joined(separator: ",")))"),
        ], auth: .optional)
        return Dictionary(rows.map { ($0.id, $0.asTitle(kind)) }, uniquingKeysWith: { first, _ in first })
    }

    static func load(_ spec: RowSpec, kids: Bool) async -> LoadedRow? {
        do {
            let page: TMDBPage = try await TMDB.shared.get(spec.path, spec.params)
            let items = try await match(page.results, kind: spec.kind, kids: kids)
            return items.isEmpty ? nil : LoadedRow(id: spec.id, title: spec.title, items: items)
        } catch {
            return nil
        }
    }

    static func loadAll(_ specs: [RowSpec], kids: Bool) async -> [LoadedRow] {
        await withTaskGroup(of: (Int, LoadedRow?).self) { group in
            for (index, spec) in specs.enumerated() {
                group.addTask { (index, await load(spec, kids: kids)) }
            }
            var loaded: [(Int, LoadedRow)] = []
            for await (index, row) in group {
                if let row { loaded.append((index, row)) }
            }
            return loaded.sorted { $0.0 < $1.0 }.map(\.1)
        }
    }

    // Movies and series for a search, in TMDB's relevance order. People
    // contribute the titles they're known for.
    static func search(_ query: String, kids: Bool) async throws -> [Title] {
        let page: TMDBPage = try await TMDB.shared.get("search/multi", ["query": query, "include_adult": "false"])
        var ordered: [(MediaKind, TMDBItem)] = []
        for item in page.results {
            switch item.mediaType {
            case "movie": ordered.append((.movie, item))
            case "tv": ordered.append((.tvShow, item))
            case "person":
                for known in item.knownFor ?? [] {
                    if known.mediaType == "movie" { ordered.append((.movie, known)) }
                    if known.mediaType == "tv" { ordered.append((.tvShow, known)) }
                }
            default: break
            }
        }
        let movieItems = ordered.filter { $0.0 == .movie }.map(\.1)
        let showItems = ordered.filter { $0.0 == .tvShow }.map(\.1)
        async let movies = match(movieItems, kind: .movie, kids: kids)
        async let shows = match(showItems, kind: .tvShow, kids: kids)
        let found = try await movies + shows
        let byTmdb = Dictionary(found.map { ("\($0.kind.rawValue):\($0.tmdbId ?? 0)", $0) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<String>()
        return ordered.compactMap { kind, item in
            guard let title = byTmdb["\(kind.rawValue):\(item.id)"], seen.insert(title.id).inserted else { return nil }
            return title
        }
    }
}

enum Rows {
    static func home(kids: Bool) -> [RowSpec] {
        if kids { return kidsRows }
        return [
            RowSpec(id: "trending-tv", title: "Trending Series", kind: .tvShow, path: "trending/tv/day"),
            RowSpec(id: "trending-movies", title: "Trending Movies", kind: .movie, path: "trending/movie/day"),
            RowSpec(id: "kdrama", title: "Popular K-Dramas", kind: .tvShow, path: "discover/tv",
                    params: ["with_original_language": "ko", "sort_by": "popularity.desc", "vote_count.gte": "50"]),
            RowSpec(id: "top-movies", title: "Top Rated Movies", kind: .movie, path: "movie/top_rated"),
            RowSpec(id: "gems", title: "Hidden Gems", kind: .movie, path: "discover/movie",
                    params: ["vote_average.gte": "7.4", "vote_count.gte": "150", "vote_count.lte": "2500",
                             "with_runtime.gte": "80", "sort_by": "vote_average.desc"]),
            RowSpec(id: "anime", title: "Anime", kind: .tvShow, path: "discover/tv",
                    params: ["with_genres": "16", "with_original_language": "ja", "sort_by": "popularity.desc"]),
            RowSpec(id: "top-tv", title: "Top Rated Series", kind: .tvShow, path: "tv/top_rated"),
        ]
    }

    static func browse(_ kind: MediaKind, kids: Bool) -> [RowSpec] {
        if kids { return kidsRows.filter { $0.kind == kind } }
        if kind == .movie {
            return [
                RowSpec(id: "m-popular", title: "Popular Now", kind: .movie, path: "movie/popular"),
                RowSpec(id: "m-now", title: "New Releases", kind: .movie, path: "movie/now_playing"),
                RowSpec(id: "m-top", title: "Top Rated", kind: .movie, path: "movie/top_rated"),
            ] + genres([(28, "Action"), (35, "Comedy"), (27, "Horror"), (878, "Sci-Fi"), (10749, "Romance"),
                        (53, "Thrillers"), (16, "Animation"), (99, "Documentaries")], kind: .movie)
        }
        return [
            RowSpec(id: "t-popular", title: "Popular Now", kind: .tvShow, path: "tv/popular"),
            RowSpec(id: "t-air", title: "New Episodes This Week", kind: .tvShow, path: "tv/on_the_air"),
            RowSpec(id: "t-top", title: "Top Rated", kind: .tvShow, path: "tv/top_rated"),
            RowSpec(id: "t-kdrama", title: "K-Dramas", kind: .tvShow, path: "discover/tv",
                    params: ["with_original_language": "ko", "sort_by": "popularity.desc", "vote_count.gte": "50"]),
        ] + genres([(80, "Crime"), (35, "Comedy"), (18, "Drama"), (10765, "Sci-Fi & Fantasy"),
                    (16, "Animation"), (10764, "Reality"), (99, "Documentaries")], kind: .tvShow)
    }

    private static func genres(_ list: [(Int, String)], kind: MediaKind) -> [RowSpec] {
        list.map { id, name in
            RowSpec(id: "\(kind.rawValue)-g\(id)", title: name, kind: kind, path: "discover/\(kind.tmdbPath)",
                    params: ["with_genres": String(id), "sort_by": "popularity.desc", "vote_count.gte": "100"])
        }
    }

    private static let kidsRows: [RowSpec] = [
        RowSpec(id: "k-family", title: "Family Movies", kind: .movie, path: "discover/movie",
                params: ["with_genres": "10751", "certification_country": "US", "certification.lte": "PG", "sort_by": "popularity.desc"]),
        RowSpec(id: "k-animated", title: "Animated Movies", kind: .movie, path: "discover/movie",
                params: ["with_genres": "16", "certification_country": "US", "certification.lte": "PG", "sort_by": "popularity.desc"]),
        RowSpec(id: "k-shows", title: "Kids Series", kind: .tvShow, path: "discover/tv",
                params: ["with_genres": "10762", "sort_by": "popularity.desc"]),
        RowSpec(id: "k-cartoons", title: "Cartoons", kind: .tvShow, path: "discover/tv",
                params: ["with_genres": "16,10751", "sort_by": "popularity.desc"]),
    ]
}
