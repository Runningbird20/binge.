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
    // The longest cue, so a long one (a sign, a song) still shows behind
    // short lines that start after it.
    private let longest: Double

    init(cues: [SubtitleCue], release: String?, versions: Int, version: Int) {
        self.cues = cues
        self.release = release
        self.versions = versions
        self.version = version
        longest = cues.map { $0.end - $0.start }.max() ?? 0
    }

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
            if time - cue.start > longest { break }
            if cue.end > time { lines.insert(cue.text, at: 0) }
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

    // WebVTT (and SRT-style comma decimals): "start --> end" + text lines,
    // until a blank line. Each timing line starts a new cue, so files that
    // separate cues with a line of spaces, or not at all, still parse.
    static func parse(_ vtt: String) -> [SubtitleCue] {
        let normalized = vtt.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var cues: [SubtitleCue] = []
        var timing: (start: Double, end: Double)?
        var text: [String] = []

        func finish() {
            defer { timing = nil; text = [] }
            guard let timing, timing.end > timing.start else { return }
            let clean = clean(text.joined(separator: "\n"))
            if !clean.isEmpty { cues.append(SubtitleCue(start: timing.start, end: timing.end, text: clean)) }
        }

        for raw in normalized.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.contains("-->") {
                // An SRT counter with no blank line before it belongs to the next cue.
                if timing != nil, let last = text.last, !last.isEmpty, last.allSatisfy(\.isNumber) { text.removeLast() }
                finish()
                let parts = line.components(separatedBy: "-->")
                if parts.count == 2, let start = seconds(parts[0]),
                   let end = seconds(parts[1].trimmingCharacters(in: .whitespaces).components(separatedBy: " ").first ?? "") {
                    timing = (start, end)
                }
            } else if line.isEmpty {
                finish()
            } else if timing != nil {
                text.append(raw)
            }
        }
        finish()
        return cues.sorted { $0.start < $1.start }
    }

    // Markup out, entities decoded once (&amp; last, so "&amp;lt;" stays "&lt;").
    private static func clean(_ text: String) -> String {
        text.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\{\\[^}]*\}"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&nbsp;", with: " ").replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'").replacingOccurrences(of: "&amp;", with: "&")
            .trimmingCharacters(in: .whitespacesAndNewlines)
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
