import Foundation

// How long a movie or episode really is (TMDB), so a server that plays
// something else under the same id can be caught: measured on Demon
// Slayer: Infinity Castle (156 min), Vidy served a 98-minute video while
// VidRift and CineSrc had the right one.
@MainActor
enum ExpectedRuntime {
    private static var cache: [String: Double] = [:]

    static func seconds(for request: PlayRequest) async -> Double? {
        guard !request.isLive, let tmdbId = request.title.tmdbId else { return nil }
        let key = StreamRace.key(for: request)
        if let hit = cache[key] { return hit }
        var minutes: Int?
        if request.title.kind == .tvShow, let season = request.season, let episode = request.episode {
            let data: TMDBSeason? = try? await TMDB.shared.get("tv/\(tmdbId)/season/\(season)")
            minutes = data?.episodes.first { $0.episodeNumber == episode }?.runtime
            // No runtime for this one episode (common for anime): the season's
            // typical episode, then the show's, so a different show under the
            // same id is still caught (Vidy: 47 min for a 21-min Fighting Spirit episode).
            if (minutes ?? 0) <= 0 {
                let known = (data?.episodes ?? []).compactMap(\.runtime).filter { $0 > 0 }.sorted()
                minutes = known.isEmpty ? nil : known[known.count / 2]
            }
            if (minutes ?? 0) <= 0 {
                let details: TMDBDetails? = try? await TMDB.shared.get("tv/\(tmdbId)")
                minutes = details?.episodeRunTime?.first { $0 > 0 }
            }
        } else if request.title.kind == .movie {
            let details: TMDBDetails? = try? await TMDB.shared.get("movie/\(tmdbId)")
            minutes = details?.runtime
        }
        guard let minutes, minutes > 0 else { return nil }
        let seconds = Double(minutes) * 60
        cache[key] = seconds
        return seconds
    }

    // Different cuts and credits vary a little; a different video doesn't.
    static func isWrong(_ duration: Double, expected: Double) -> Bool {
        guard duration > 60, expected > 0 else { return false }
        return abs(duration - expected) > max(240, expected * 0.2)
    }
}
