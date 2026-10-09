import Foundation

// Same rules as the website's src/utils/seasonStatus.js: where you are in
// the season ("2 episodes left in Season 3", "Season finale next") or
// what's coming ("Next episode Friday", "Season 4 starts Oct 24").
enum SeasonStatus {
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func friendlyDay(_ text: String?, now: Date = Date()) -> String? {
        guard let text, let date = dayFormatter.date(from: text) else { return nil }
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? -1
        switch days {
        case ..<0: return nil
        case 0: return "today"
        case 1: return "tomorrow"
        case 2..<7: return date.formatted(.dateTime.weekday(.wide))
        default: return date.formatted(.dateTime.month(.abbreviated).day())
        }
    }

    static func note(_ details: TMDBDetails, season: Int, episode: Int, now: Date = Date()) -> String? {
        guard season > 0, episode > 0 else { return nil }
        let seasons = (details.seasons ?? []).filter { $0.seasonNumber > 0 }
        let current = seasons.first { $0.seasonNumber == season }
        let next = details.nextEpisodeToAir
        let nextDay = friendlyDay(next?.airDate, now: now)

        var aired = current?.episodeCount ?? 0
        if let next, next.seasonNumber == season { aired = min(aired == 0 ? Int.max : aired, next.episodeNumber - 1) }
        let left = aired - episode

        if left >= 2 { return "\(left) episodes left in Season \(season)" }
        if left == 1 {
            let finale = next == nil || next!.seasonNumber > season
            return finale ? "Season finale next" : "1 episode left so far"
        }
        if let next, next.seasonNumber == season, let nextDay { return "Next episode \(nextDay)" }
        if let next, next.seasonNumber > season, let nextDay {
            return next.episodeNumber == 1 ? "Season \(next.seasonNumber) starts \(nextDay)" : "New episode \(nextDay)"
        }
        if let later = seasons.first(where: { $0.seasonNumber > season && ($0.episodeCount ?? 0) > 0
            && ($0.airDate.flatMap(dayFormatter.date(from:)).map { $0 <= now } ?? false) }) {
            return "Season \(later.seasonNumber) is out"
        }
        if details.status == "Ended" || details.status == "Canceled" { return "Series finale" }
        return nil
    }
}
