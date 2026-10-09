import Foundation
import SwiftUI

// Followed teams (the website's followed_teams table) and close-game
// alerts. The site sends these as push notifications from a cron job; the
// TV checks ESPN itself every minute while the app is open and shows a
// banner over whatever is on screen (movies included).

struct FollowedTeam: Decodable, Identifiable, Hashable {
    let id: Int
    let leaguePath: String
    let teamId: String
    let teamName: String
    let teamAbbr: String?
    let logo: String?

    var nickname: String? { SportsFeed.tokens(teams: (teamName, teamName), name: "")?.first }
}

struct GameAlert: Identifiable, Equatable {
    let id: String
    let headline: String
    let detail: String
    let teams: Set<String>
    let at = Date()
}

@MainActor
final class TeamCenter: ObservableObject {
    static let shared = TeamCenter()

    @Published private(set) var teams: [FollowedTeam] = []
    @Published private(set) var banner: GameAlert?
    @Published private(set) var recent: GameAlert?
    private weak var app: AppModel?
    private var loop: Task<Void, Never>?
    private var sent: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "binge.alertsSent") ?? []) }
        set { UserDefaults.standard.set(Array(newValue.suffix(200)), forKey: "binge.alertsSent") }
    }

    func start(app: AppModel) {
        self.app = app
        loop?.cancel()
        loop = Task {
            await reload()
            while !Task.isCancelled {
                await check()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    func stop() {
        loop?.cancel()
        teams = []
    }

    func reload() async {
        guard let app, app.isSignedIn else { teams = []; return }
        teams = (try? await Supabase.shared.select("followed_teams", [
            URLQueryItem(name: "select", value: "id,league_path,team_id,team_name,team_abbr,logo"),
            URLQueryItem(name: "order", value: "created_at.asc"),
        ] + app.ownerQuery)) ?? []
    }

    func isFollowing(_ team: Scoreboard.Competitor.Team) -> Bool {
        teams.contains { $0.teamId == team.id }
    }

    func toggle(_ team: Scoreboard.Competitor.Team, leaguePath: String) async {
        guard let app, let session = app.session, let teamId = team.id else { return }
        if let existing = teams.first(where: { $0.teamId == teamId }) {
            try? await Supabase.shared.delete("followed_teams", [URLQueryItem(name: "id", value: "eq.\(existing.id)")])
        } else {
            try? await Supabase.shared.insert("followed_teams", [
                "user_id": session.userId, "profile_id": app.profile?.id ?? NSNull(),
                "league_path": leaguePath, "team_id": teamId,
                "team_name": team.displayName ?? team.shortDisplayName ?? teamId,
                "team_abbr": team.abbreviation ?? NSNull(), "logo": team.logo ?? NSNull(), "alerts": true,
            ])
        }
        await reload()
    }

    func dismissBanner() { banner = nil }

    #if DEBUG
    func debugShow(_ alert: GameAlert) { show(alert) }
    #endif

    // MARK: Alert rules (same idea as gameAlerts() in server/routes/cron.js)

    private func check() async {
        let paths = Set(teams.map(\.leaguePath))
        guard !paths.isEmpty else { return }
        let ids = Set(teams.map(\.teamId))
        for path in paths {
            guard let league = League.all.first(where: { $0.path == path }) ?? Optional(League(id: path, name: path, path: path)),
                  let events = try? await Scoreboard.load(league) else { continue }
            for event in events where event.competitors.contains(where: { ids.contains($0.team.id ?? "") }) {
                if let alert = Self.alert(for: event, sport: path.split(separator: "/").first.map(String.init) ?? "") {
                    var seen = sent
                    guard !seen.contains(alert.id) else { continue }
                    seen.insert(alert.id)
                    sent = seen
                    show(alert)
                }
            }
        }
    }

    private func show(_ alert: GameAlert) {
        banner = alert
        recent = alert
        Task {
            try? await Task.sleep(for: .seconds(15))
            if banner == alert { banner = nil }
        }
    }

    static func alert(for event: Scoreboard.Event, sport: String) -> GameAlert? {
        guard let away = event.away, let home = event.home else { return nil }
        let matchup = "\(away.name) vs \(home.name)"
        let tokens = Set([away, home].compactMap { SportsFeed.tokens(teams: ($0.team.displayName ?? $0.name, $0.team.displayName ?? $0.name), name: "")?.first })
        let state = event.status.type.state
        if state == "pre", let date = event.date.flatMap(Self.espnDate), date.timeIntervalSinceNow < 30 * 60, date.timeIntervalSinceNow > -5 * 60 {
            return GameAlert(id: "\(event.id):start", headline: "Starting soon: \(matchup)",
                             detail: event.status.type.shortDetail ?? "", teams: tokens)
        }
        guard state == "in", let period = event.status.period else { return nil }
        let a = Int(away.score ?? "") ?? 0, h = Int(home.score ?? "") ?? 0
        let margin = abs(a - h)
        let score = "\(away.team.abbreviation ?? away.name) \(a) – \(h) \(home.team.abbreviation ?? home.name)"
        let regulation: Int, close: Int
        switch sport {
        case "basketball": (regulation, close) = (4, 6)
        case "football": (regulation, close) = (4, 8)
        case "hockey": (regulation, close) = (3, 1)
        case "baseball": (regulation, close) = (9, 2)
        case "soccer": (regulation, close) = (2, 1)
        default: return nil
        }
        if period > regulation {
            return GameAlert(id: "\(event.id):ot", headline: "Overtime! \(matchup)", detail: score, teams: tokens)
        }
        let late: Bool = sport == "baseball" ? period >= 8 : (period == regulation && (event.status.clock ?? 9999) <= (sport == "soccer" ? 900 : 300))
        if late, margin <= close {
            return GameAlert(id: "\(event.id):close", headline: "Close game: \(matchup)",
                             detail: "\(score) · \(event.status.type.shortDetail ?? "")", teams: tokens)
        }
        return nil
    }

    static func espnDate(_ text: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        for format in ["yyyy-MM-dd'T'HH:mm'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: text) { return date }
        }
        return nil
    }
}
