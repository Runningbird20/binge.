import Foundation

// The same three feeds the website's Sports page uses (see
// src/utils/sportsProviders.js), fetched directly (the site's
// /api/sports/streams proxy is just a cache in front of them). Entries are
// merged into one game each; each game's feeds become the servers raced by
// the player, exactly like movie servers.
struct SportStream: Hashable {
    enum Source: Hashable {
        case embed(URL)
        case streamed(source: String, id: String)
    }
    let label: String
    let source: Source
}

struct SportGame: Identifiable, Hashable {
    let id: String
    var title: String
    var category: String
    var startsAt: Date?
    var endsAt: Date?
    var alwaysLive: Bool
    var teams: (home: String, away: String)?
    var logos: (home: URL?, away: URL?)?
    var poster: URL?
    var streams: [SportStream]
    var tag: String? = nil
    var colors: [String]? = nil

    static func == (lhs: SportGame, rhs: SportGame) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    var isLive: Bool {
        if alwaysLive { return true }
        guard let startsAt else { return false }
        let now = Date()
        return startsAt <= now.addingTimeInterval(10 * 60) && now <= (endsAt ?? startsAt.addingTimeInterval(3 * 3600))
    }

    // Team nicknames ("celtics", "cavaliers"): what matching keys on.
    var teamTokens: Set<String>? { SportsFeed.tokens(teams: teams, name: title) }

    var is247: Bool { alwaysLive || (tag?.contains("24/7") ?? false) }

    // Same rules as the site's inferLeague (sportsProviders.js).
    var league: String {
        if let tag, !tag.contains("24/7"), !tag.isEmpty { return tag }
        if is247 { return "24/7 Channels" }
        if let tokens = teamTokens {
            let inSet = { (set: Set<String>) in tokens.allSatisfy { set.contains($0) } }
            switch category {
            case "American Football": return inSet(SportsFeed.nflTeams) ? "NFL" : "College Football"
            case "Basketball" where inSet(SportsFeed.nbaTeams): return "NBA"
            case "Hockey" where inSet(SportsFeed.nhlTeams): return "NHL"
            case "Baseball": return "MLB"
            default: break
            }
        }
        return category
    }

    var icon: String { SportsFeed.icons[category] ?? "🏆" }
}

enum SportsFeed {
    static let icons: [String: String] = [
        "American Football": "🏈", "Australian Football": "🏉", "Basketball": "🏀", "Soccer": "⚽",
        "Baseball": "⚾", "Hockey": "🏒", "Combat Sports": "🥊", "Tennis": "🎾", "Golf": "⛳", "Racing": "🏎️",
        "Rugby": "🏉", "Cricket": "🏏", "Volleyball": "🏐", "Billiards": "🎱", "Darts": "🎯",
    ]
    static let nflTeams: Set<String> = ["cardinals", "falcons", "ravens", "bills", "panthers", "bears", "bengals", "browns", "cowboys", "broncos", "lions", "packers", "texans", "colts", "jaguars", "chiefs", "raiders", "chargers", "rams", "dolphins", "vikings", "patriots", "saints", "giants", "jets", "eagles", "steelers", "49ers", "seahawks", "buccaneers", "titans", "commanders"]
    static let nbaTeams: Set<String> = ["hawks", "celtics", "nets", "hornets", "bulls", "cavaliers", "mavericks", "nuggets", "pistons", "warriors", "rockets", "pacers", "clippers", "lakers", "grizzlies", "heat", "bucks", "timberwolves", "pelicans", "knicks", "thunder", "magic", "76ers", "suns", "blazers", "kings", "spurs", "raptors", "jazz", "wizards"]
    static let nhlTeams: Set<String> = ["ducks", "bruins", "sabres", "flames", "hurricanes", "blackhawks", "avalanche", "jackets", "stars", "wings", "oilers", "panthers", "kings", "wild", "canadiens", "predators", "devils", "islanders", "rangers", "senators", "flyers", "penguins", "sharks", "kraken", "blues", "lightning", "leafs", "canucks", "knights", "capitals", "jets", "mammoth"]
    // PPV's own category names → the site's.
    private static let ppvCategories: [String: String] = ["Ice Hockey": "Hockey", "Football": "Soccer", "MMA": "Combat Sports", "Boxing": "Combat Sports", "Wrestling": "Combat Sports", "Motorsport": "Racing", "Motorsports": "Racing"]

    private static let durations: [String: Double] = [
        "Basketball": 3, "Soccer": 2.25, "American Football": 3.5, "Baseball": 3.5, "Hockey": 3,
        "Combat Sports": 5, "Tennis": 3, "Golf": 5, "Racing": 3, "Rugby": 2, "Cricket": 8,
    ]
    private static let streamedCategories: [String: String] = [
        "basketball": "Basketball", "football": "Soccer", "american-football": "American Football",
        "hockey": "Hockey", "baseball": "Baseball", "motor-sports": "Racing", "fight": "Combat Sports",
        "tennis": "Tennis", "rugby": "Rugby", "golf": "Golf", "cricket": "Cricket",
    ]
    private static let streamfreeCategories: [String: String] = [
        "soccer": "Soccer", "basketball": "Basketball", "hockey": "Hockey", "combat": "Combat Sports",
        "baseball": "Baseball", "football": "American Football", "racing": "Racing", "tennis": "Tennis", "cricket": "Cricket",
    ]

    // MARK: Loading

    static func load() async -> [SportGame] {
        async let ppv = fetchPPV()
        async let streamed = fetchStreamed()
        async let streamfree = fetchStreamFree()
        let all = await (ppv + streamed + streamfree)
        return merge(all).sorted { ($0.isLive ? 0 : 1, $0.startsAt ?? .distantFuture) < ($1.isLive ? 0 : 1, $1.startsAt ?? .distantFuture) }
    }

    private static func json(_ url: String) async -> Any? {
        var request = URLRequest(url: URL(string: url)!, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Mozilla/5.0 (AppleTV) binge.", forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private static func date(_ seconds: Any?) -> Date? {
        guard let value = (seconds as? NSNumber)?.doubleValue, value > 0 else { return nil }
        return Date(timeIntervalSince1970: value > 1e11 ? value / 1000 : value)
    }

    private static func truthy(_ value: Any?) -> Bool {
        if let n = value as? NSNumber { return n.boolValue }
        if let s = value as? String { return s == "1" || s == "true" }
        return false
    }

    private static func fetchPPV() async -> [SportGame] {
        guard let root = await json("https://api.ppv.st/api/streams") as? [String: Any],
              let categories = root["streams"] as? [[String: Any]] else { return [] }
        let now = Date()
        var out: [SportGame] = []
        for category in categories {
            let catLive = truthy(category["always_live"])
            for s in category["streams"] as? [[String: Any]] ?? [] {
                guard let iframe = (s["iframe"] as? String).flatMap(URL.init(string:)) else { continue }
                let rawName = s["category_name"] as? String ?? category["category"] as? String ?? "Other"
                if rawName == "24/7 Streams" { continue }
                let name = ppvCategories[rawName] ?? rawName
                let alwaysLive = catLive || truthy(s["always_live"])
                let ends = date(s["ends_at"])
                if !alwaysLive, let ends, ends < now { continue }
                let tag = s["source_tag"] as? String
                out.append(SportGame(
                    id: "ppv:\(s["id"] ?? s["name"] ?? UUID().uuidString)", title: s["name"] as? String ?? "Live",
                    category: name, startsAt: date(s["starts_at"]), endsAt: ends, alwaysLive: alwaysLive,
                    teams: nil, logos: nil, poster: (s["poster"] as? String).flatMap(URL.init(string:)),
                    streams: [SportStream(label: tag.map { "PPV · \($0)" } ?? "PPV", source: .embed(iframe))],
                    tag: s["tag"] as? String, colors: s["colors"] as? [String]))
            }
        }
        return out
    }

    private static func fetchStreamed() async -> [SportGame] {
        guard let matches = await json("https://streamed.pk/api/matches/all") as? [[String: Any]] else { return [] }
        let now = Date()
        var out: [SportGame] = []
        for m in matches {
            guard let sources = m["sources"] as? [[String: Any]], !sources.isEmpty else { continue }
            let category = streamedCategories[m["category"] as? String ?? ""] ?? "Other"
            let starts = date(m["date"])
            let ends = starts?.addingTimeInterval((durations[category] ?? 3) * 3600)
            if let ends, now > ends { continue }
            let teams = m["teams"] as? [String: Any]
            let home = teams?["home"] as? [String: Any], away = teams?["away"] as? [String: Any]
            let badge = { (team: [String: Any]?) -> URL? in
                (team?["badge"] as? String).flatMap { URL(string: "https://streamed.pk/api/images/badge/\($0).webp") }
            }
            let names = (home?["name"] as? String).flatMap { h in (away?["name"] as? String).map { (home: h, away: $0) } }
            out.append(SportGame(
                id: "streamed:\(m["id"] ?? UUID().uuidString)", title: m["title"] as? String ?? "Live",
                category: category, startsAt: starts, endsAt: ends, alwaysLive: starts == nil,
                teams: names, logos: names == nil ? nil : (badge(home), badge(away)),
                poster: (m["poster"] as? String).flatMap { URL(string: "https://streamed.pk\($0)") },
                streams: sources.compactMap { src in
                    guard let source = src["source"] as? String, let id = src["id"] as? String else { return nil }
                    return SportStream(label: "Streamed · \(source)", source: .streamed(source: source, id: id))
                }))
        }
        return out
    }

    private static func fetchStreamFree() async -> [SportGame] {
        guard let root = await json("https://streamfree.top/api/v1/streams") as? [String: Any],
              let streams = root["streams"] as? [[String: Any]] else { return [] }
        let now = Date()
        var out: [SportGame] = []
        for s in streams {
            guard let embed = (s["embed_url"] as? String).flatMap(URL.init(string:)) else { continue }
            let category = streamfreeCategories[s["category"] as? String ?? ""] ?? "Other"
            let starts = date(s["match_timestamp"])
            let ends = starts?.addingTimeInterval((durations[category] ?? 3) * 3600)
            if let ends, now > ends { continue }
            let t1 = s["team1"] as? [String: Any], t2 = s["team2"] as? [String: Any]
            let names = (t1?["name"] as? String).flatMap { h in (t2?["name"] as? String).map { (home: h, away: $0) } }
            out.append(SportGame(
                id: "streamfree:\(s["id"] ?? s["name"] ?? UUID().uuidString)", title: s["name"] as? String ?? "Live",
                category: category, startsAt: starts, endsAt: ends, alwaysLive: starts == nil,
                teams: names,
                logos: names == nil ? nil : ((t1?["logo"] as? String).flatMap(URL.init(string:)), (t2?["logo"] as? String).flatMap(URL.init(string:))),
                poster: (s["thumbnail_url"] as? String).flatMap(URL.init(string:)),
                streams: [SportStream(label: "StreamFree", source: .embed(embed))],
                tag: s["league"] as? String))
        }
        return out
    }

    // MARK: Merging (one entry per game)

    static func tokens(teams: (home: String, away: String)?, name: String) -> Set<String>? {
        func nickname(_ team: String) -> String? {
            let words = team.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
            return words.last
        }
        if let teams, let a = nickname(teams.home), let b = nickname(teams.away) { return [a, b] }
        let lower = " " + name.lowercased() + " "
        for separator in [" vs. ", " vs ", " v ", " at ", " @ ", " - "] where lower.contains(separator) {
            let parts = lower.components(separatedBy: separator)
            guard parts.count == 2 else { continue }
            let left = parts[0].components(separatedBy: ":").last ?? parts[0]
            if let a = nickname(left), let b = nickname(parts[1]) { return [a, b] }
        }
        return nil
    }

    private static func merge(_ entries: [SportGame]) -> [SportGame] {
        var games: [SportGame] = []
        for entry in entries {
            let tokens = entry.teamTokens
            let key = entry.title.lowercased().filter { $0.isLetter || $0.isNumber }
            if let index = games.firstIndex(where: { game in
                let closeInTime: Bool = {
                    guard let a = game.startsAt, let b = entry.startsAt else { return true }
                    return abs(a.timeIntervalSince(b)) <= 3 * 3600
                }()
                if let tokens, let other = game.teamTokens { return tokens == other && closeInTime }
                return game.title.lowercased().filter { $0.isLetter || $0.isNumber } == key && closeInTime
            }) {
                var game = games[index]
                for stream in entry.streams where !game.streams.contains(stream) { game.streams.append(stream) }
                if game.teams == nil { game.teams = entry.teams }
                if game.logos == nil { game.logos = entry.logos }
                if game.poster == nil { game.poster = entry.poster }
                if game.tag == nil { game.tag = entry.tag }
                if game.colors == nil { game.colors = entry.colors }
                if game.category == "Other" { game.category = entry.category }
                game.alwaysLive = game.alwaysLive && entry.alwaysLive
                games[index] = game
            } else {
                games.append(entry)
            }
        }
        return games
    }

    // The live game an alert is about (matched by team nicknames).
    static func game(for alert: GameAlert) async -> SportGame? {
        await load().first { $0.isLive && $0.teamTokens == alert.teams && !$0.streams.isEmpty }
    }

    // MARK: Streams → player servers

    // Streamed sources resolve to one or more embeds (HD first). Capped so a
    // race never opens too many pages at once.
    static func servers(for game: SportGame, limit: Int = 4) async -> [StreamServer] {
        var urls: [(String, URL)] = []
        for stream in game.streams {
            switch stream.source {
            case .embed(let url):
                urls.append((stream.label, url))
            case .streamed(let source, let id):
                let path = "https://streamed.pk/api/stream/\(source)/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
                let list = await json(path) as? [[String: Any]] ?? []
                let sorted = list.sorted { truthy($0["hd"]) && !truthy($1["hd"]) }
                for (index, item) in sorted.prefix(2).enumerated() {
                    if let url = (item["embedUrl"] as? String).flatMap(URL.init(string:)) {
                        urls.append(("\(stream.label) \(index + 1)\(truthy(item["hd"]) ? " HD" : "")", url))
                    }
                }
            }
            if urls.count >= limit { break }
        }
        return urls.prefix(limit).map { label, url in
            StreamServer(id: url.absoluteString, name: label) { _, _, _, _ in url }
        }
    }
}
