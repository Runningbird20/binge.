import Foundation

// ESPN's public scoreboard feed, the same one the site's live score panel
// uses. Scores only; the game streams themselves open on the phone.
struct League: Identifiable, Hashable {
    let id: String
    let name: String
    let path: String

    static let all: [League] = [
        League(id: "nfl", name: "NFL", path: "football/nfl"),
        League(id: "nba", name: "NBA", path: "basketball/nba"),
        League(id: "mlb", name: "MLB", path: "baseball/mlb"),
        League(id: "nhl", name: "NHL", path: "hockey/nhl"),
        League(id: "cfb", name: "College Football", path: "football/college-football"),
        League(id: "wnba", name: "WNBA", path: "basketball/wnba"),
        League(id: "epl", name: "Premier League", path: "soccer/eng.1"),
        League(id: "ucl", name: "Champions League", path: "soccer/uefa.champions"),
        League(id: "mls", name: "MLS", path: "soccer/usa.1"),
    ]
}

struct Scoreboard: Decodable {
    struct Event: Decodable, Identifiable, Hashable {
        let id: String
        let shortName: String?
        let status: Status
        let competitions: [Competition]

        var competitors: [Competitor] { competitions.first?.competitors ?? [] }
        var away: Competitor? { competitors.first { $0.homeAway == "away" } ?? competitors.first }
        var home: Competitor? { competitors.first { $0.homeAway == "home" } ?? competitors.last }
        var isLive: Bool { status.type.state == "in" }
        var isFinal: Bool { status.type.state == "post" }
        var sortRank: Int { isLive ? 0 : (isFinal ? 2 : 1) }
    }
    struct Status: Decodable, Hashable {
        struct Kind: Decodable, Hashable { let state: String; let shortDetail: String? }
        let type: Kind
    }
    struct Competition: Decodable, Hashable {
        let competitors: [Competitor]
    }
    struct Competitor: Decodable, Hashable {
        struct Team: Decodable, Hashable {
            let displayName: String?
            let shortDisplayName: String?
            let abbreviation: String?
            let logo: String?
            let color: String?
        }
        let homeAway: String?
        let score: String?
        let winner: Bool?
        let team: Team

        var name: String { team.shortDisplayName ?? team.displayName ?? team.abbreviation ?? "TBD" }
        var logoURL: URL? { team.logo.flatMap(URL.init(string:)) }
    }

    let events: [Event]

    static func load(_ league: League) async throws -> [Event] {
        let url = URL(string: "https://site.api.espn.com/apis/site/v2/sports/\(league.path)/scoreboard")!
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { return [] }
        let board = try JSONDecoder().decode(Scoreboard.self, from: data)
        return board.events.sorted { $0.sortRank < $1.sortRank }
    }
}
