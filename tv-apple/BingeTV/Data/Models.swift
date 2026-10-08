import Foundation

enum MediaKind: String, Codable, Hashable, Sendable {
    case movie
    case tvShow = "tv_show"

    var table: String { self == .movie ? "movies" : "tv_shows" }
    var tmdbPath: String { self == .movie ? "movie" : "tv" }
    var sitePath: String { self == .movie ? "movie" : "tv-show" }
}

// A title from binge.'s catalog (the site's movies / tv_shows tables),
// optionally decorated with TMDB art.
struct Title: Identifiable, Hashable, Sendable {
    let kind: MediaKind
    let dbId: Int
    let name: String
    let year: Int?
    let overview: String?
    let genre: String?
    let ageRating: String?
    var poster: URL?
    var backdrop: URL?
    var tmdbId: Int?
    var comingSoon = false
    var badge: String?

    var id: String { "\(kind.rawValue):\(dbId)" }

    // The site's own deep link: /movie/:id?play=1 or
    // /tv-show/:id?play=1&season=&episode=, plus &t= to resume.
    func watchURL(season: Int? = nil, episode: Int? = nil, seconds: Double? = nil) -> URL {
        var components = URLComponents(url: Config.siteURL.appending(path: "\(kind.sitePath)/\(dbId)"), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "play", value: "1")]
        if kind == .tvShow, let season, let episode {
            items.append(URLQueryItem(name: "season", value: String(season)))
            items.append(URLQueryItem(name: "episode", value: String(episode)))
        }
        if let seconds, seconds > 30 {
            items.append(URLQueryItem(name: "t", value: String(Int(seconds))))
        }
        components.queryItems = items
        return components.url!
    }
}

struct CatalogRow: Decodable {
    static let columns = "id,title,year,genre,overview,poster_url,source_key,age_rating"

    let id: Int
    let title: String
    let year: Int?
    let genre: String?
    let overview: String?
    let posterUrl: String?
    let sourceKey: String?
    let ageRating: String?

    func asTitle(_ kind: MediaKind) -> Title {
        let tmdbId = sourceKey.flatMap { $0.split(separator: ":").last.flatMap { Int($0) } }
        return Title(
            kind: kind,
            dbId: id,
            name: title,
            year: year,
            overview: overview,
            genre: genre,
            ageRating: ageRating,
            poster: posterUrl.flatMap(URL.init(string:)),
            backdrop: nil,
            tmdbId: tmdbId
        )
    }
}

struct AccountProfile: Decodable, Identifiable, Hashable {
    static let columns = "id,name,avatar_url,avatar_color,is_kids,is_default"

    let id: String
    let name: String
    let avatarUrl: String?
    let avatarColor: String?
    let isKids: Bool
    let isDefault: Bool

    var avatarImageURL: URL? {
        guard let avatarUrl, !avatarUrl.isEmpty else { return nil }
        if avatarUrl.hasPrefix("/") { return Config.siteURL.appending(path: String(avatarUrl.dropFirst())) }
        return URL(string: avatarUrl)
    }
}

struct ContinueRow: Decodable {
    static let columns = "id,media_type,media_id,current_season,current_episode,position_seconds,duration_seconds,updated_at"

    let id: Int
    let mediaType: String
    let mediaId: Int
    let currentSeason: Int?
    let currentEpisode: Int?
    let positionSeconds: Double?
    let durationSeconds: Double?
}

struct ContinueItem: Identifiable, Hashable {
    var title: Title
    let season: Int?
    let episode: Int?
    let position: Double?
    let duration: Double?
    // Set when an episode newer than the one you're on aired recently.
    var newEpisode: String?

    var id: String { title.id }

    var progress: Double? {
        guard let position, let duration, duration > 0 else { return nil }
        return min(1, max(0, position / duration))
    }

    var episodeLabel: String? {
        guard title.kind == .tvShow, let season, let episode else { return nil }
        return "S\(season):E\(episode)"
    }
}

struct WatchlistRow: Decodable {
    let id: Int
    let mediaType: String
    let mediaId: Int
}

// Same rule as the site's releaseWindow.js: released → shown; out within
// 30 days → shown as Coming Soon; later → hidden.
enum ReleaseWindow {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static func days(until value: String?) -> Double? {
        guard let value, let date = formatter.date(from: String(value.prefix(10))) else { return nil }
        return date.timeIntervalSinceNow / 86_400
    }

    static func isRecent(_ value: String?, days: Double) -> Bool {
        guard let until = self.days(until: value) else { return false }
        return until <= 0 && until > -days
    }

    static func isVisible(_ value: String?) -> Bool { (days(until: value) ?? 0) <= 30 }
    static func isComingSoon(_ value: String?) -> Bool {
        guard let days = days(until: value) else { return false }
        return days > 0 && days <= 30
    }
}

// Kids profiles only see titles rated for kids (unknown ratings are left out).
enum KidsFilter {
    static let allowed: Set<String> = ["G", "PG", "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG"]
    static func allows(_ rating: String?) -> Bool {
        guard let rating else { return false }
        return allowed.contains(rating.uppercased())
    }
}
