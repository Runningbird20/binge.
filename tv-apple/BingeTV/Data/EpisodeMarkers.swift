import Foundation

// Intro and credits markers, same sources and rules as the website
// (src/utils/episodeMarkers.js): viewers' timings via the
// episode_marker_summary RPC (2+ viewers agree; a show's usual intro covers
// untimed episodes), and AniSkip's community timings for anime.
struct EpisodeMarkers: Equatable {
    struct Intro: Equatable { let start: Double; let end: Double; let source: String }
    var intro: Intro?
    var credits: Double?

    // An early 15s–3.5min forward jump: someone skipping the intro.
    static func looksLikeIntroSkip(from: Double, to: Double, duration: Double) -> Bool {
        guard from >= 0, to > from else { return false }
        let jump = to - from
        let early = from < min(600, duration > 0 ? duration * 0.35 : 600)
        return early && jump >= 15 && jump <= 210
    }

    // Moving on this far in (but before the last 20s): the credits had started.
    static func looksLikeCredits(time: Double, duration: Double) -> Bool {
        duration > 300 && time > 0 && time / duration >= 0.85 && duration - time >= 20
    }
}

@MainActor
enum EpisodeMarkerStore {
    private static var cache: [String: EpisodeMarkers] = [:]

    static func markers(for title: Title, season: Int, episode: Int) async -> EpisodeMarkers {
        let key = "\(title.dbId):\(season):\(episode)"
        if let hit = cache[key] { return hit }
        async let crowd = crowdMarkers(title.dbId, season, episode)
        async let anime = AniSkip.markers(for: title, season: season, episode: episode)
        let (viewers, aniskip) = await (crowd, anime)
        var result = EpisodeMarkers()
        result.intro = viewers.intro?.source == "viewers" ? viewers.intro : (aniskip.intro ?? viewers.intro)
        result.credits = viewers.credits ?? aniskip.credits
        cache[key] = result
        return result
    }

    private static func crowdMarkers(_ mediaId: Int, _ season: Int, _ episode: Int) async -> EpisodeMarkers {
        struct Row: Decodable { let kind: String; let startS: Double?; let endS: Double?; let source: String? }
        let rows: [Row] = (try? await Supabase.shared.rpc("episode_marker_summary", [
            "p_media_id": mediaId, "p_season": season, "p_episode": episode,
        ])) ?? []
        var out = EpisodeMarkers()
        for row in rows {
            if row.kind == "intro", let start = row.startS, let end = row.endS, end > start {
                out.intro = .init(start: start, end: end, source: row.source == "show" ? "show" : "viewers")
            }
            if row.kind == "credits", let start = row.startS { out.credits = start }
        }
        return out
    }

    static func reportIntro(_ title: Title, season: Int, episode: Int, start: Double, end: Double, duration: Double) {
        guard EpisodeMarkers.looksLikeIntroSkip(from: start, to: end, duration: duration) else { return }
        report(title, season, episode, kind: "intro", start: start, end: end, duration: duration)
    }

    static func reportCredits(_ title: Title, season: Int, episode: Int, start: Double, duration: Double) {
        guard EpisodeMarkers.looksLikeCredits(time: start, duration: duration) else { return }
        report(title, season, episode, kind: "credits", start: start, end: nil, duration: duration)
    }

    private static func report(_ title: Title, _ season: Int, _ episode: Int, kind: String, start: Double, end: Double?, duration: Double) {
        cache["\(title.dbId):\(season):\(episode)"] = nil
        Task {
            guard let userId = await Supabase.shared.session?.userId else { return }
            try? await Supabase.shared.upsert("episode_markers", onConflict: "user_id,media_id,season,episode,kind", [
                "user_id": userId, "media_id": title.dbId, "season": season, "episode": episode, "kind": kind,
                "start_s": (start * 10).rounded() / 10, "end_s": end.map { ($0 * 10).rounded() / 10 } ?? NSNull(),
                "duration_s": duration > 0 ? duration : NSNull(), "updated_at": ISO8601DateFormatter().string(from: Date()),
            ])
        }
    }
}

// AniSkip (api.aniskip.com): community-timed openings/endings for anime,
// keyed by MyAnimeList id, which AniList gives us from the title.
enum AniSkip {
    static func markers(for title: Title, season: Int, episode: Int) async -> EpisodeMarkers {
        // Animated and not known to be non-Japanese (the catalog's language
        // is often empty); AniList must confirm a Japanese title of that name.
        guard title.genre?.localizedCaseInsensitiveContains("animation") == true,
              title.originalLanguage == nil || title.originalLanguage == "ja",
              let malId = await malId(title.name, season: season, episode: episode),
              let url = URL(string: "https://api.aniskip.com/v2/skip-times/\(malId)/\(episode)?types[]=op&types[]=ed&episodeLength=0"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return EpisodeMarkers() }
        var out = EpisodeMarkers()
        for result in root["results"] as? [[String: Any]] ?? [] {
            guard let interval = result["interval"] as? [String: Any],
                  let start = (interval["startTime"] as? NSNumber)?.doubleValue,
                  let end = (interval["endTime"] as? NSNumber)?.doubleValue, end > start else { continue }
            if result["skipType"] as? String == "op", out.intro == nil { out.intro = .init(start: start, end: end, source: "aniskip") }
            if result["skipType"] as? String == "ed", out.credits == nil { out.credits = start }
        }
        return out
    }

    private static func malId(_ name: String, season: Int, episode: Int) async -> Int? {
        var request = URLRequest(url: URL(string: "https://graphql.anilist.co")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let search = season > 1 ? "\(name) Season \(season)" : name
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "query": "query($s:String){Media(search:$s,type:ANIME){idMal episodes countryOfOrigin synonyms title{english romaji}}}",
            "variables": ["s": search],
        ])
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let media = (root["data"] as? [String: Any])?["Media"] as? [String: Any],
              let id = (media["idMal"] as? NSNumber)?.intValue,
              media["countryOfOrigin"] as? String == "JP" else { return nil }
        let normalize = { (text: String) in
            text.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
        }
        let titles = media["title"] as? [String: Any]
        let names = ([titles?["english"], titles?["romaji"]].compactMap { $0 as? String } + (media["synonyms"] as? [String] ?? [])).map(normalize)
        let wanted = normalize(name)
        guard names.contains(where: { season > 1 ? $0.hasPrefix(wanted) : $0 == wanted }) else { return nil }
        if let count = (media["episodes"] as? NSNumber)?.intValue, episode > count { return nil }
        return id
    }
}
