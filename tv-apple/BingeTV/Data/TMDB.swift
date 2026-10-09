import Foundation

struct TMDBItem: Decodable, Hashable {
    let id: Int
    let title: String?
    let name: String?
    let overview: String?
    let posterPath: String?
    let backdropPath: String?
    let releaseDate: String?
    let firstAirDate: String?
    let voteAverage: Double?
    let mediaType: String?
    let genreIds: [Int]?
    let knownFor: [TMDBItem]?

    var date: String? { releaseDate ?? firstAirDate }
}

struct TMDBPage: Decodable {
    let results: [TMDBItem]
}

struct TMDBDetails: Decodable {
    struct Genre: Decodable, Hashable { let id: Int; let name: String }
    struct Season: Decodable, Hashable, Identifiable {
        let seasonNumber: Int
        let name: String?
        let episodeCount: Int?
        var airDate: String? = nil
        var id: Int { seasonNumber }
    }
    struct Cast: Decodable, Hashable { let name: String }
    struct Credits: Decodable { let cast: [Cast] }
    struct Logo: Decodable { let filePath: String; let iso6391: String? }
    struct Images: Decodable { let logos: [Logo] }

    let id: Int
    let overview: String?
    let tagline: String?
    let runtime: Int?
    let episodeRunTime: [Int]?
    let genres: [Genre]?
    let voteAverage: Double?
    let backdropPath: String?
    let posterPath: String?
    let numberOfSeasons: Int?
    let originalLanguage: String?
    let seasons: [Season]?
    let lastEpisodeToAir: AiredEpisode?
    let nextEpisodeToAir: AiredEpisode?
    let releaseDate: String?
    let status: String?
    struct AiredEpisode: Decodable, Hashable { let airDate: String?; let seasonNumber: Int; let episodeNumber: Int; let name: String? }
    let credits: Credits?
    let images: Images?

    var logoPath: String? {
        let logos = images?.logos ?? []
        return (logos.first { $0.iso6391 == "en" } ?? logos.first)?.filePath
    }
}

struct TMDBSeason: Decodable {
    struct Episode: Decodable, Hashable, Identifiable {
        let id: Int
        let episodeNumber: Int
        let seasonNumber: Int
        let name: String?
        let overview: String?
        let stillPath: String?
        let runtime: Int?
        let airDate: String?
        let voteAverage: Double?
    }
    let episodes: [Episode]
}

// TMDB's live lists drive the rows, same as the website (the catalog's own
// popularity numbers are a stale import snapshot). Responses are cached
// for 30 minutes.
actor TMDB {
    static let shared = TMDB()

    private var cache: [String: (at: Date, data: Data)] = [:]

    func get<T: Decodable>(_ path: String, _ params: [String: String] = [:]) async throws -> T {
        guard !Config.tmdbKey.isEmpty else { throw BingeError.notConfigured }
        var components = URLComponents(string: "https://api.themoviedb.org/3/\(path)")!
        components.queryItems = [
            URLQueryItem(name: "api_key", value: Config.tmdbKey),
            URLQueryItem(name: "language", value: "en-US"),
        ] + params.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        let url = components.url!
        let key = url.absoluteString

        let data: Data
        if let hit = cache[key], hit.at.timeIntervalSinceNow > -1800 {
            data = hit.data
        } else {
            let (fresh, response) = try await URLSession.shared.data(from: url)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else { throw BingeError.http(status, "TMDB error (\(status))") }
            cache[key] = (Date(), fresh)
            data = fresh
        }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(T.self, from: data)
    }

    nonisolated static func image(_ path: String?, _ size: String = "w500") -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/\(size)\(path)")
    }
}
