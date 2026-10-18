import Foundation

// Streaming servers that play inside tvOS's web view. That web view has no
// Media Source Extensions, so only servers that fall back to native HLS
// work. Each was checked in the tvOS simulator (Fight Club, 2026-10-08):
// a real <video> in the top-level page, playing. VidLink, Videasy and the
// vidsrc servers loaded but never produced a playable video there.
struct StreamServer: Identifiable, Hashable {
    let id: String
    let name: String
    let build: @Sendable (_ tmdbId: Int, _ kind: MediaKind, _ season: Int, _ episode: Int) -> URL

    static func == (lhs: StreamServer, rhs: StreamServer) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    static let all: [StreamServer] = [
        StreamServer(id: "vidrift", name: "VidRift") { id, kind, s, e in
            var c = URLComponents(string: kind == .tvShow
                ? "https://embed.vidrift.net/embed/tv/\(id)/\(s)/\(e)"
                : "https://embed.vidrift.net/embed/movie/\(id)")!
            c.queryItems = [URLQueryItem(name: "brand", value: "binge."), URLQueryItem(name: "brandColor", value: "f4f6f8")]
            return c.url!
        },
        StreamServer(id: "vidy", name: "Vidy") { id, kind, s, e in
            var c = URLComponents(string: kind == .tvShow ? "https://vidy.st/tv/\(id)/\(s)/\(e)" : "https://vidy.st/movie/\(id)")!
            c.queryItems = [URLQueryItem(name: "autoplay", value: "true"), URLQueryItem(name: "color", value: "F4F6F8")]
            return c.url!
        },
        StreamServer(id: "cinesrc", name: "CineSrc") { id, kind, s, e in
            var c = URLComponents(string: kind == .tvShow ? "https://cinesrc.st/embed/tv/\(id)" : "https://cinesrc.st/embed/movie/\(id)")!
            var items = [URLQueryItem(name: "autoplay", value: "true"), URLQueryItem(name: "autonext", value: "false"),
                         URLQueryItem(name: "color", value: "#f4f6f8")]
            if kind == .tvShow { items = [URLQueryItem(name: "s", value: String(s)), URLQueryItem(name: "e", value: String(e))] + items }
            // CineSrc can switch subtitles on in the profile's language.
            if PlaybackPrefs.subtitle != "off" {
                items.append(URLQueryItem(name: "subtitles", value: "auto"))
                items.append(URLQueryItem(name: "subtitlelang", value: PlaybackPrefs.languageName(PlaybackPrefs.subtitle)))
            }
            c.queryItems = items
            return c.url!
        },
    ]

    // The server that last worked for this title goes first (so episode 2
    // starts where episode 1 ended up), like the site's streamPreferences.
    static func ranked(for title: Title) -> [StreamServer] {
        guard let last = UserDefaults.standard.string(forKey: lastKey(title)),
              let index = all.firstIndex(where: { $0.id == last }) else { return all }
        var list = all
        list.insert(list.remove(at: index), at: 0)
        return list
    }

    static func rememberWorking(_ server: StreamServer, for title: Title) {
        UserDefaults.standard.set(server.id, forKey: lastKey(title))
    }

    private static func lastKey(_ title: Title) -> String { "binge.server.\(title.id)" }
}
