import Foundation

// Subtitles from OpenSubtitles (through the site's /api/extras/subtitles,
// which caches each file for everyone), drawn by the app on top of any
// server. Servers' own tracks are a fallback.
struct SubtitleCue: Equatable {
    let start: Double
    let end: Double
    let text: String
}

struct ExternalSubtitleFile: Equatable {
    let cues: [SubtitleCue]
    let release: String?
    let versions: Int
    let version: Int

    // The line(s) on screen at a given second (cues are sorted by start).
    func text(at time: Double) -> String {
        var low = 0, high = cues.count
        while low < high {
            let mid = (low + high) / 2
            if cues[mid].start <= time { low = mid + 1 } else { high = mid }
        }
        var lines: [String] = []
        var index = low - 1
        while index >= 0, lines.count < 3 {
            let cue = cues[index]
            if cue.end > time { lines.insert(cue.text, at: 0) }
            if time - cue.start > 15 { break }
            index -= 1
        }
        return lines.joined(separator: "\n")
    }
}

enum ExternalSubtitles {
    static func load(_ request: PlayRequest, language: String, version: Int = 0) async -> ExternalSubtitleFile? {
        guard !request.isLive, let tmdbId = request.title.tmdbId, language != "off" else { return nil }
        var components = URLComponents(url: Config.siteURL.appending(path: "api/extras/subtitles"), resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "type", value: request.title.kind == .tvShow ? "tv" : "movie"),
            URLQueryItem(name: "tmdb", value: String(tmdbId)),
            URLQueryItem(name: "lang", value: language),
            URLQueryItem(name: "version", value: String(version)),
        ]
        if request.title.kind == .tvShow {
            items.append(URLQueryItem(name: "season", value: String(request.season ?? 1)))
            items.append(URLQueryItem(name: "episode", value: String(request.episode ?? 1)))
        }
        components.queryItems = items
        var target = components.url
        #if DEBUG
        // -BingeSubtitlesURL http://127.0.0.1:3300/ : a fixed test file.
        if let debug = UserDefaults.standard.string(forKey: "BingeSubtitlesURL") { target = URL(string: debug) }
        #endif
        guard let url = target,
              let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let vtt = json["vtt"] as? String else { return nil }
        let cues = parse(vtt)
        guard !cues.isEmpty else { return nil }
        return ExternalSubtitleFile(cues: cues, release: json["release"] as? String,
                                    versions: (json["versions"] as? NSNumber)?.intValue ?? 1, version: version)
    }

    // WebVTT (and SRT-style comma decimals): blocks of "start --> end" + text.
    static func parse(_ vtt: String) -> [SubtitleCue] {
        let normalized = vtt.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var cues: [SubtitleCue] = []
        for block in normalized.components(separatedBy: "\n\n") {
            let lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            guard let timingIndex = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
            let parts = lines[timingIndex].components(separatedBy: "-->")
            guard parts.count == 2, let start = seconds(parts[0]),
                  let end = seconds(parts[1].trimmingCharacters(in: .whitespaces).components(separatedBy: " ").first ?? "") else { continue }
            let text = lines[(timingIndex + 1)...]
                .joined(separator: "\n")
                .replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\{\\[^}]*\}"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&lt;", with: "<")
                .replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&nbsp;", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty, end > start { cues.append(SubtitleCue(start: start, end: end, text: text)) }
        }
        return cues.sorted { $0.start < $1.start }
    }

    // "01:02:03.456", "02:03.456" or "01:02:03,456".
    static func seconds(_ raw: String) -> Double? {
        let parts = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".").split(separator: ":")
        guard (2...3).contains(parts.count) else { return nil }
        var total = 0.0
        for part in parts {
            guard let value = Double(part) else { return nil }
            total = total * 60 + value
        }
        return total
    }
}
