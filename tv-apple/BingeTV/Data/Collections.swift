import Foundation

// Collections: the website's ready-made sets (Marvel Studios, Christmas,
// Malayalam classics, All-time top 100…). The list is the site's own
// /collections.json (scripts/generate-collections.js), read here too, so a
// new set needs no app update. Each set is live TMDB queries, so new
// releases join by themselves; titles are matched to the catalog like every
// row (Catalog.match: release window, the profile's maturity level). The
// website's twin is src/utils/collections.js.
struct CollectionsFile: Decodable {
    struct Group: Decodable, Identifiable { let id: String; let title: String }
    struct Source: Decodable {
        let type: String
        let media: String
        var params: [String: String]? = nil
        var path: String? = nil
        var ids: [Int]? = nil
        var id: Int? = nil
        var job: String? = nil
        var minVotes: Int? = nil
    }
    struct Set: Decodable, Identifiable, Hashable {
        let id: String
        let group: String
        let title: String
        let subtitle: String
        let sources: [Source]
        var order: String? = nil
        var limit: Int? = nil
        var mature: Bool? = nil
        static func == (a: Set, b: Set) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }
    let groups: [Group]
    let collections: [Set]

    // The groups with the sets a profile may see (no mature sets on a
    // restricted level), empty groups left out.
    func visible(restricted: Bool) -> [(group: Group, sets: [Set])] {
        groups.compactMap { group in
            let sets = collections.filter { $0.group == group.id && !(restricted && $0.mature == true) }
            return sets.isEmpty ? nil : (group, sets)
        }
    }
}

enum Collections {
    private static var cached: CollectionsFile?

    static func load() async throws -> CollectionsFile {
        if let cached { return cached }
        var url = Config.siteURL.appendingPathComponent("collections.json")
        #if DEBUG
        // -BingeCollectionsURL <url>: a list not yet deployed (a local dev server).
        if let other = UserDefaults.standard.string(forKey: "BingeCollectionsURL").flatMap(URL.init(string:)) { url = other }
        #endif
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw BingeError.notConfigured }
        let file = try JSONDecoder().decode(CollectionsFile.self, from: data)
        cached = file
        return file
    }

    // "{today}", "{today+30}", "{today-365}" → a local YYYY-MM-DD.
    static func fill(_ params: [String: String], today: Date = Date()) -> [String: String] {
        params.mapValues { value in
            guard let match = value.range(of: #"\{today([+-]\d+)?\}"#, options: .regularExpression) else { return value }
            let token = value[match]
            let offset = Int(token.dropFirst(6).dropLast()) ?? 0
            let date = Calendar.current.date(byAdding: .day, value: offset, to: today) ?? today
            let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
            let iso = String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
            return value.replacingCharacters(in: match, with: iso)
        }
    }
}

private struct PagedItems: Decodable { let results: [TMDBItem]; var totalPages: Int? = nil }
private struct CollectionParts: Decodable { let parts: [TMDBItem]? }
private struct Credits: Decodable { let crew: [Credit]? }
private struct Credit: Decodable {
    let item: TMDBItem
    let job: String?
    let voteCount: Int?
    private enum Keys: String, CodingKey { case job, voteCount }
    init(from decoder: Decoder) throws {
        item = try TMDBItem(from: decoder)
        let c = try decoder.container(keyedBy: Keys.self)
        job = try c.decodeIfPresent(String.self, forKey: .job)
        voteCount = try c.decodeIfPresent(Int.self, forKey: .voteCount)
    }
}

// One set as a feed: loadMore() adds the next titles on binge., in the
// set's order, until done. A batch that matched nothing reads on (up to 4
// pages) so scrolling never stalls.
@MainActor
final class CollectionFeed: ObservableObject {
    let set: CollectionsFile.Set
    @Published private(set) var items: [Title] = []
    @Published private(set) var done = false
    @Published private(set) var loading = false
    @Published private(set) var failed = false
    private var pages: [Int]
    private var more: [Bool]
    private var seen: Swift.Set<String> = []
    private let maturity: Maturity

    init(_ set: CollectionsFile.Set, maturity: Maturity) {
        self.set = set
        self.maturity = maturity
        pages = set.sources.map { _ in 1 }
        more = set.sources.map { _ in true }
    }

    // Kept per set and maturity, so going back shows what was loaded.
    private static var kept: [String: CollectionFeed] = [:]
    static func shared(_ set: CollectionsFile.Set, maturity: Maturity) -> CollectionFeed {
        let key = "\(set.id)|\(maturity)"
        if let feed = kept[key] { return feed }
        let feed = CollectionFeed(set, maturity: maturity)
        kept[key] = feed
        return feed
    }

    func loadMore() async {
        guard !loading, !done else { return }
        loading = true
        failed = false
        defer { loading = false }
        do {
            for _ in 0..<4 {
                let added = try await batch()
                items += added
                if !added.isEmpty || done { break }
            }
        } catch {
            failed = true
        }
    }

    private func batch() async throws -> [Title] {
        var found: [(MediaKind, TMDBItem)] = []
        for (index, source) in set.sources.enumerated() where more[index] {
            let kind: MediaKind = source.media == "tv" ? .tvShow : .movie
            let (results, hasMore) = try await read(source, page: pages[index])
            pages[index] += 1
            more[index] = hasMore
            found += results.map { (kind, $0) }
        }
        found = found.filter { !seen.contains("\($0.0.rawValue):\($0.1.id)") }
        if set.order == "release" { found.sort { ($0.1.date ?? "9999") < ($1.1.date ?? "9999") } }
        async let movies = Catalog.match(found.filter { $0.0 == .movie }.map(\.1), kind: .movie, maturity: maturity)
        async let shows = Catalog.match(found.filter { $0.0 == .tvShow }.map(\.1), kind: .tvShow, maturity: maturity)
        let matched = try await movies + shows
        let byKey = Dictionary(matched.map { ("\($0.kind.rawValue):\($0.tmdbId ?? 0)", $0) }, uniquingKeysWith: { first, _ in first })
        var added: [Title] = []
        let limit = set.limit ?? .max
        for (kind, item) in found {
            let key = "\(kind.rawValue):\(item.id)"
            seen.insert(key)
            if let title = byKey[key], items.count + added.count < limit { added.append(title) }
        }
        done = items.count + added.count >= limit || !more.contains(true)
        return added
    }

    private func read(_ source: CollectionsFile.Source, page: Int) async throws -> ([TMDBItem], Bool) {
        let byDate: (TMDBItem, TMDBItem) -> Bool = { ($0.date ?? "9999") < ($1.date ?? "9999") }
        switch source.type {
        case "discover", "list":
            let path = source.type == "discover" ? "discover/\(source.media)" : String((source.path ?? "").drop { $0 == "/" })
            var params = source.type == "discover" ? Collections.fill(source.params ?? [:]) : [:]
            if source.type == "discover" { params["include_adult"] = "false"; params["sort_by"] = params["sort_by"] ?? "popularity.desc" }
            params["page"] = String(page)
            let result: PagedItems = try await TMDB.shared.get(path, params)
            return (result.results, page < min(result.totalPages ?? 1, 500))
        case "collection":
            var parts: [TMDBItem] = []
            for id in source.ids ?? [] {
                let result: CollectionParts? = try? await TMDB.shared.get("collection/\(id)")
                parts += result?.parts ?? []
            }
            return (parts.sorted(by: byDate), false)
        case "titles":
            var items: [TMDBItem] = []
            for id in source.ids ?? [] {
                if let item: TMDBItem = try? await TMDB.shared.get("\(source.media)/\(id)") { items.append(item) }
            }
            return (items, false)
        case "person":
            guard let id = source.id else { return ([], false) }
            let credits: Credits = try await TMDB.shared.get("person/\(id)/\(source.media == "tv" ? "tv" : "movie")_credits")
            let items = (credits.crew ?? [])
                .filter { $0.job == source.job && ($0.voteCount ?? 0) >= (source.minVotes ?? 0) }
                .map(\.item)
            return (items.sorted(by: byDate), false)
        default:
            return ([], false)
        }
    }
}
