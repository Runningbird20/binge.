import Foundation
import Testing
@testable import BingeTV

// One entry per game across three feeds: team-name matching, the league a
// game belongs to, stream labels, and the feed memory that ranks servers.

private func game(_ id: String, _ title: String, category: String = "Basketball", teams: (String, String)? = nil,
                  start: Date? = Date(), streams: [String] = [], tag: String? = nil, alwaysLive: Bool = false) -> SportGame {
    SportGame(id: id, title: title, category: category, startsAt: start, endsAt: nil, alwaysLive: alwaysLive,
              teams: teams.map { (home: $0.0, away: $0.1) }, logos: nil, poster: nil,
              streams: streams.map { SportStream(label: $0, source: .embed(URL(string: "https://e.example/\($0.replacingOccurrences(of: " ", with: ""))")!)) },
              tag: tag)
}

@Suite struct SportsTokenTests {
    @Test(arguments: [
        ("Boston Celtics vs Cleveland Cavaliers", ["celtics", "cavaliers"]),
        ("Boston Celtics vs. Cleveland Cavaliers", ["celtics", "cavaliers"]),
        ("Celtics @ Cavaliers", ["celtics", "cavaliers"]),
        ("Boston Celtics at Cleveland Cavaliers", ["celtics", "cavaliers"]),
        ("NBA: Boston Celtics - Cleveland Cavaliers", ["celtics", "cavaliers"]),
        ("Portland Trail Blazers vs Utah Jazz", ["blazers", "jazz"]),
        ("Arsenal v Chelsea", ["arsenal", "chelsea"]),
    ] as [(String, Set<String>)])
    func fromTitle(_ name: String, _ expected: Set<String>) {
        #expect(SportsFeed.tokens(teams: nil, name: name) == expected)
    }

    @Test func fromTeamNames() {
        #expect(SportsFeed.tokens(teams: (home: "Los Angeles Lakers", away: "Golden State Warriors"), name: "") == ["lakers", "warriors"])
    }

    @Test(arguments: ["Formula 1: Mexico City Grand Prix", "WWE Raw", "RedZone", ""])
    func noMatchup(_ name: String) {
        #expect(SportsFeed.tokens(teams: nil, name: name) == nil)
    }

    @Test func soccerSuffixesAreNotNicknames() {
        // "FC"/"CF"/"SC" are what most clubs end with: two different MLS
        // games at the same time must not look like one.
        let a = SportsFeed.tokens(teams: (home: "Toronto FC", away: "Chicago Fire FC"), name: "")
        let b = SportsFeed.tokens(teams: (home: "Austin FC", away: "Inter Miami CF"), name: "")
        #expect(a != nil && b != nil)
        #expect(a != b)
        #expect(a?.count == 2)
    }

    @Test func sameCityClubsStayApart() {
        let united = SportsFeed.tokens(teams: (home: "Manchester United", away: "Liverpool"), name: "")
        let city = SportsFeed.tokens(teams: (home: "Manchester City", away: "Liverpool"), name: "")
        #expect(united != city)
    }
}

@Suite struct SportsSidesTests {
    @Test func sidesDropFillerWords() {
        let sides = SportsFeed.sides(teams: nil, name: "Iowa State Cyclones at BYU Cougars")
        #expect(sides == [["iowa", "cyclones"], ["byu", "cougars"]])
    }

    @Test func sameMatchupEitherOrder() throws {
        let a = try #require(SportsFeed.sides(teams: nil, name: "Iowa State Cyclones at BYU Cougars"))
        let b = try #require(SportsFeed.sides(teams: nil, name: "BYU vs Iowa State"))
        #expect(SportsFeed.sameMatchup(a, b))
        #expect(SportsFeed.sameMatchup(b, a))
    }

    @Test func differentGamesAreDifferent() throws {
        let a = try #require(SportsFeed.sides(teams: nil, name: "Michigan Wolverines vs Ohio State Buckeyes"))
        let b = try #require(SportsFeed.sides(teams: nil, name: "Penn State Nittany Lions vs Ohio State Buckeyes"))
        #expect(!SportsFeed.sameMatchup(a, b))
    }

    @Test func onlyFillerIsNoSide() {
        #expect(SportsFeed.sides(teams: (home: "FC", away: "United"), name: "") == nil)
    }
}

@Suite struct SportsMergeTests {
    @Test func sameGameAcrossFeedsBecomesOne() {
        let merged = SportsFeed.merge([
            game("ppv:1", "Boston Celtics vs Cleveland Cavaliers", streams: ["PPV"]),
            game("streamed:2", "Celtics @ Cavaliers", teams: ("Boston Celtics", "Cleveland Cavaliers"), streams: ["Streamed · admin"]),
            game("streamfree:3", "Cavaliers vs Celtics", streams: ["StreamFree 1080p"]),
        ])
        #expect(merged.count == 1)
        #expect(merged[0].id == "ppv:1", "the first feed's id wins (stable ids across refreshes)")
        #expect(merged[0].streams.map(\.label) == ["PPV", "Streamed · admin", "StreamFree 1080p"])
        #expect(merged[0].teams?.home == "Boston Celtics", "teams filled in from a later feed")
    }

    @Test func rematchDaysApartStaysSeparate() {
        let merged = SportsFeed.merge([
            game("a", "Celtics vs Cavaliers", start: Date()),
            game("b", "Celtics vs Cavaliers", start: Date().addingTimeInterval(2 * 86400)),
        ])
        #expect(merged.count == 2)
    }

    @Test func threeHourWindow() {
        let now = Date()
        #expect(SportsFeed.merge([game("a", "Celtics vs Cavaliers", start: now),
                                  game("b", "Celtics vs Cavaliers", start: now.addingTimeInterval(3 * 3600))]).count == 1)
        #expect(SportsFeed.merge([game("a", "Celtics vs Cavaliers", start: now),
                                  game("b", "Celtics vs Cavaliers", start: now.addingTimeInterval(3 * 3600 + 60))]).count == 2)
    }

    @Test func simultaneousMLSGamesStaySeparate() {
        let merged = SportsFeed.merge([
            game("a", "Toronto FC vs Chicago Fire FC", category: "Soccer", teams: ("Toronto FC", "Chicago Fire FC")),
            game("b", "Austin FC vs Charlotte FC", category: "Soccer", teams: ("Austin FC", "Charlotte FC")),
            game("c", "St. Louis City SC vs Austin FC", category: "Soccer", teams: ("St. Louis City SC", "Seattle Sounders FC")),
            game("d", "Orlando City SC vs Atlanta United FC", category: "Soccer", teams: ("Orlando City SC", "Atlanta United FC")),
        ])
        #expect(merged.count == 4)
    }

    @Test func duplicateStreamsAreNotRepeated() {
        let merged = SportsFeed.merge([game("a", "Celtics vs Cavaliers", streams: ["PPV"]), game("b", "Celtics vs Cavaliers", streams: ["PPV"])])
        #expect(merged.first?.streams.count == 1)
    }

    @Test func otherCategoryIsUpgraded() {
        let merged = SportsFeed.merge([game("a", "Celtics vs Cavaliers", category: "Other"), game("b", "Celtics vs Cavaliers", category: "Basketball")])
        #expect(merged.first?.category == "Basketball")
    }

    @Test func untimedChannelMergesByTitle() {
        let merged = SportsFeed.merge([game("a", "NFL RedZone", start: nil, alwaysLive: true), game("b", "NFL RedZone", start: nil, alwaysLive: true),
                                       game("c", "Sky Sports F1", start: nil, alwaysLive: true)])
        #expect(merged.count == 2)
        #expect(merged.first?.alwaysLive == true)
    }

    @Test func unrelatedTitlesStaySeparate() {
        #expect(SportsFeed.merge([game("a", "UFC 312"), game("b", "WWE Raw")]).count == 2)
    }
}

@Suite struct SportsLeagueTests {
    @Test(arguments: [
        ("Kansas City Chiefs vs Buffalo Bills", "American Football", "NFL"),
        ("Alabama Crimson Tide vs Georgia Bulldogs", "American Football", "College Football"),
        ("Boston Celtics vs Miami Heat", "Basketball", "NBA"),
        ("Duke Blue Devils vs North Carolina Tar Heels", "Basketball", "Basketball"),
        ("Boston Bruins vs Toronto Maple Leafs", "Hockey", "NHL"),
        ("New York Yankees vs Boston Red Sox", "Baseball", "MLB"),
        ("Arsenal vs Chelsea", "Soccer", "Soccer"),
    ] as [(String, String, String)])
    func inferred(_ title: String, _ category: String, _ league: String) {
        #expect(game("x", title, category: category).league == league)
    }

    @Test func tagWins() {
        #expect(game("x", "Arsenal vs Chelsea", category: "Soccer", tag: "Premier League").league == "Premier League")
    }

    @Test func channels() {
        let channel = game("x", "Sky Sports F1", category: "Racing", start: nil, alwaysLive: true)
        #expect(channel.is247)
        #expect(channel.league == "24/7 Channels")
        #expect(game("y", "Willow", tag: "24/7 Cricket").is247)
    }

    @Test func icons() {
        #expect(game("x", "a vs b", category: "Basketball").icon == "basketball.fill")
        #expect(game("x", "a vs b", category: "Curling").icon == "trophy.fill")
        for (_, symbol) in SportsFeed.icons { #expect(!symbol.isEmpty) }
    }

    @Test func teamListsHaveNoTypos() {
        #expect(SportsFeed.nflTeams.count == 32)
        #expect(SportsFeed.nbaTeams.count == 30)
        #expect(SportsFeed.nhlTeams.count == 32)
    }
}

@Suite struct SportsLiveWindowTests {
    private func at(_ start: Date?, end: Date? = nil, always: Bool = false) -> SportGame {
        SportGame(id: "x", title: "a vs b", category: "Basketball", startsAt: start, endsAt: end, alwaysLive: always,
                  teams: nil, logos: nil, poster: nil, streams: [])
    }

    @Test func liveWindow() {
        let now = Date()
        #expect(at(now).isLive)
        #expect(at(now.addingTimeInterval(9 * 60)).isLive, "doors open 10 minutes early")
        #expect(!at(now.addingTimeInterval(11 * 60)).isLive)
        #expect(at(now.addingTimeInterval(-2.9 * 3600)).isLive)
        #expect(!at(now.addingTimeInterval(-3.1 * 3600)).isLive)
        #expect(at(now.addingTimeInterval(-4 * 3600), end: now.addingTimeInterval(600)).isLive)
        #expect(!at(now.addingTimeInterval(-600), end: now.addingTimeInterval(-60)).isLive)
        #expect(!at(nil).isLive)
        #expect(at(nil, always: true).isLive)
    }
}

@Suite struct SportsStreamTests {
    @Test(arguments: [
        ("https://streamfree.top/embed/football/redzone1080p", 0, 1, "StreamFree 1080p"),
        ("https://streamfree.top/embed/x/2160p", 0, 1, "StreamFree 4K"),
        ("https://streamfree.top/embed/x/720p-alt", 1, 3, "StreamFree 720p"),
        ("https://streamfree.top/embed/x/main", 1, 3, "StreamFree 2"),
        ("https://streamfree.top/embed/x/main", 0, 1, "StreamFree"),
    ] as [(String, Int, Int, String)])
    func streamfreeLabels(_ url: String, _ index: Int, _ count: Int, _ expected: String) {
        #expect(SportsFeed.streamfreeLabel(URL(string: url)!, index: index, count: count) == expected)
    }

    @Test func switchKeys() {
        #expect(SportStream(label: "PPV · ESPN", source: .embed(URL(string: "https://a")!)).switchKeys == ["sports:ppv"])
        #expect(SportStream(label: "StreamFree 1080p", source: .embed(URL(string: "https://a")!)).switchKeys == ["sports:streamfree"])
        #expect(SportStream(label: "Streamed · admin", source: .streamed(source: "admin", id: "1")).switchKeys == ["sports:streamed", "sports:streamed:admin"])
    }

    @Test(arguments: [
        ("PPV", "PPV"), ("PPV · ESPN", "PPV"), ("PPV mirror", "PPV"), ("StreamFree 1080p", "StreamFree"), ("StreamFree", "StreamFree"),
        ("Streamed · admin 2 HD", "Streamed · admin"), ("Streamed · alpha", "Streamed · alpha"), ("Streamed · delta 1 HD · Spanish", "Streamed · delta"),
        ("Other · thing", "Other"),
    ] as [(String, String)])
    func families(_ label: String, _ family: String) {
        #expect(SportsMemory.family(label) == family)
    }

    @Test func memoryScoreIsBounded() {
        let label = "Streamed · test\(UUID().uuidString.prefix(6))"
        defer { UserDefaults.standard.removeObject(forKey: "binge.sportsFeed." + SportsMemory.family(label)) }
        #expect(SportsMemory.score(label) == 0)
        SportsMemory.record(label, worked: true)
        #expect(SportsMemory.score(label) == 3)
        SportsMemory.record(label + " 2 HD", worked: false)
        #expect(SportsMemory.score(label) == 2, "same family")
        for _ in 0..<20 { SportsMemory.record(label, worked: true) }
        #expect(SportsMemory.score(label) == 30)
        for _ in 0..<60 { SportsMemory.record(label, worked: false) }
        #expect(SportsMemory.score(label) == -9)
    }
}

@Suite struct ScoreboardTests {
    static let fixture = """
    {"events":[
     {"id":"1","shortName":"BOS @ CLE","date":"2026-10-28T00:00Z","status":{"type":{"state":"post","shortDetail":"Final"},"period":4},
      "competitions":[{"competitors":[{"homeAway":"home","score":"110","winner":true,"team":{"id":"5","displayName":"Cleveland Cavaliers","shortDisplayName":"Cavaliers","abbreviation":"CLE"}},
                                      {"homeAway":"away","score":"101","team":{"id":"2","displayName":"Boston Celtics","shortDisplayName":"Celtics","abbreviation":"BOS"}}]}]},
     {"id":"2","date":"2026-10-28T01:00Z","status":{"type":{"state":"in","shortDetail":"Q4 2:10"},"period":4,"displayClock":"2:10","clock":130},
      "competitions":[{"competitors":[{"homeAway":"away","score":"99","team":{"id":"13","displayName":"Los Angeles Lakers"}},
                                      {"homeAway":"home","score":"101","team":{"id":"9","displayName":"Golden State Warriors"}}]}]},
     {"id":"3","date":"2026-10-28T02:00Z","status":{"type":{"state":"pre"}},
      "competitions":[{"competitors":[{"team":{"abbreviation":"AAA"}},{"team":{}}]}]}
    ]}
    """

    @Test func decodesAndSorts() throws {
        let board = try JSONDecoder().decode(Scoreboard.self, from: Data(Self.fixture.utf8))
        #expect(board.events.count == 3)
        let sorted = board.events.sorted { $0.sortRank < $1.sortRank }
        #expect(sorted.map(\.id) == ["2", "3", "1"], "live, then upcoming, then final")
        let live = board.events[1]
        #expect(live.isLive)
        #expect(live.away?.team.displayName == "Los Angeles Lakers")
        #expect(live.home?.name == "Golden State Warriors")
        let pre = board.events[2]
        #expect(pre.away?.name == "AAA", "no homeAway: first is away")
        #expect(pre.home?.name == "TBD")
        #expect(board.events[0].isFinal)
    }

    @Test func leaguesAreUnique() {
        #expect(Set(League.all.map(\.id)).count == League.all.count)
        #expect(Set(League.all.map(\.path)).count == League.all.count)
    }
}

@Suite struct GameAlertTests {
    private func event(_ state: String, sport: String = "basketball", period: Int? = 4, clock: Double? = 120,
                       away: Int = 100, home: Int = 98, date: String? = nil) -> Scoreboard.Event {
        var status: [String: Any] = ["type": ["state": state, "shortDetail": "detail"]]
        if let period { status["period"] = period }
        if let clock { status["clock"] = clock }
        var json: [String: Any] = [
            "id": "e1", "status": status,
            "competitions": [["competitors": [
                ["homeAway": "away", "score": String(away), "team": ["id": "1", "displayName": "Boston Celtics", "abbreviation": "BOS"]],
                ["homeAway": "home", "score": String(home), "team": ["id": "2", "displayName": "Miami Heat", "abbreviation": "MIA"]],
            ]]],
        ]
        if let date { json["date"] = date }
        return try! JSONDecoder().decode(Scoreboard.Event.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private static func espn(_ offsetMinutes: Double) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm'Z'"
        return f.string(from: Date().addingTimeInterval(offsetMinutes * 60))
    }

    @MainActor @Test func startingSoon() {
        let alert = TeamCenter.alert(for: event("pre", period: nil, clock: nil, date: Self.espn(20)), sport: "basketball")
        #expect(alert?.id == "e1:start")
        #expect(alert?.headline == "Starting soon: Celtics vs Heat" || alert?.headline == "Starting soon: Boston Celtics vs Miami Heat")
        #expect(alert?.teams == ["celtics", "heat"])
        #expect(TeamCenter.alert(for: event("pre", period: nil, clock: nil, date: Self.espn(45)), sport: "basketball") == nil)
        #expect(TeamCenter.alert(for: event("pre", period: nil, clock: nil, date: Self.espn(-10)), sport: "basketball") == nil)
    }

    @MainActor @Test(arguments: [
        // sport, period, clock (ESPN seconds), away, home, expected alert kind
        ("basketball", 4, 120.0, 100, 98, "close"), ("basketball", 4, 120, 100, 90, nil), ("basketball", 4, 400, 100, 98, nil),
        ("basketball", 3, 60, 100, 98, nil), ("basketball", 5, 300, 110, 110, "ot"),
        ("football", 4, 200, 21, 17, "close"), ("football", 4, 200, 28, 17, nil), ("football", 5, 600, 20, 20, "ot"),
        ("hockey", 3, 250, 2, 1, "close"), ("hockey", 3, 250, 3, 1, nil), ("hockey", 4, 100, 2, 2, "ot"),
        ("baseball", 8, nil, 3, 2, "close"), ("baseball", 7, nil, 3, 2, nil), ("baseball", 10, nil, 3, 3, "ot"),
        ("golf", 4, 100, 1, 1, nil),
    ] as [(String, Int, Double?, Int, Int, String?)])
    func inGame(_ sport: String, _ period: Int, _ clock: Double?, _ away: Int, _ home: Int, _ kind: String?) {
        let alert = TeamCenter.alert(for: event("in", sport: sport, period: period, clock: clock, away: away, home: home), sport: sport)
        #expect(alert?.id.components(separatedBy: ":").last == kind)
    }

    @MainActor @Test func soccerLateAndClose() {
        // ESPN's soccer clock counts up (seconds played): 84' is 5040.
        #expect(TeamCenter.alert(for: event("in", sport: "soccer", period: 2, clock: 5040, away: 1, home: 1), sport: "soccer")?.id == "e1:close")
        #expect(TeamCenter.alert(for: event("in", sport: "soccer", period: 2, clock: 3000, away: 1, home: 1), sport: "soccer") == nil, "50th minute isn't late")
        #expect(TeamCenter.alert(for: event("in", sport: "soccer", period: 2, clock: 5040, away: 3, home: 1), sport: "soccer") == nil)
    }

    @MainActor @Test func espnDates() {
        #expect(TeamCenter.espnDate("2026-10-28T00:30Z") != nil)
        #expect(TeamCenter.espnDate("2026-10-28T00:30:15Z") != nil)
        #expect(TeamCenter.espnDate("tomorrow") == nil)
    }

    @Test func followedTeamNickname() throws {
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let team = try decoder.decode(FollowedTeam.self, from: Data(#"{"id":1,"league_path":"basketball/nba","team_id":"2","team_name":"Boston Celtics"}"#.utf8))
        #expect(team.nickname == "celtics")
    }
}

@MainActor @Suite struct FollowedTeamLeagueTests {
    private func team(_ id: String, _ path: String) -> FollowedTeam {
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try! decoder.decode(FollowedTeam.self, from: Data(#"{"id":1,"league_path":"\#(path)","team_id":"\#(id)","team_name":"X"}"#.utf8))
    }

    @Test func idsAreScopedToTheirLeague() {
        let browns = team("5", "football/nfl")
        #expect(TeamCenter.followed([browns], teamId: "5", leaguePath: "football/nfl") != nil)
        #expect(TeamCenter.followed([browns], teamId: "5", leaguePath: "basketball/nba") == nil, "NBA team 5 is the Cavaliers")
        #expect(TeamCenter.followed([browns], teamId: nil, leaguePath: "football/nfl") == nil)
        #expect(TeamCenter.followed([browns, team("5", "basketball/nba")], teamId: "5", leaguePath: "basketball/nba")?.leaguePath == "basketball/nba")
    }
}

@Suite struct LeagueAliasTests {
    @Test(arguments: [("NCAAF", "College Football"), ("ncaa football", "College Football"), ("EPL", "Premier League"),
                      ("La Liga", "LaLiga"), ("UCL", "Champions League"), ("F1", "Formula 1"), ("WWE", "Wrestling"),
                      ("AEW", "Wrestling"), (" ufc ", "UFC"), ("Serie A", "Serie A"), ("MLS", "MLS")] as [(String, String)])
    func aliases(_ raw: String, _ canonical: String) {
        #expect(SportsFeed.canonicalLeague(raw) == canonical)
    }

    @Test func tagsAreUnified() {
        let a = SportGame(id: "a", title: "x vs y", category: "American Football", startsAt: Date(), endsAt: nil, alwaysLive: false,
                          teams: nil, logos: nil, poster: nil, streams: [], tag: "NCAAF")
        #expect(a.league == "College Football")
    }
}
