import Foundation
import Testing
import UIKit
@testable import BingeTV

// Live checks against the real services (TMDB, the Supabase catalog, the
// site's /api/extras routes, every embed server, the sports feeds, ESPN).
// Off by default; scripts/run-tests.sh live turns them on. Each check also
// prints a "[matrix] {json}" line, collected into a report.
//
// Subtitle downloads spend the site's shared OpenSubtitles quota (a few
// uncached files a day for everyone), so only a handful are checked unless
// BINGE_LIVE_SUBS=all.
enum Live {
    static let env = ProcessInfo.processInfo.environment
    static let on = env["BINGE_LIVE"] == "1"
    static let allSubtitles = env["BINGE_LIVE_SUBS"] == "all"

    static func report(_ kind: String, _ fields: [String: Any]) {
        var row = fields
        row["check"] = kind
        if let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]),
           let line = String(data: data, encoding: .utf8) {
            print("[matrix] \(line)")
            if let path = env["BINGE_REPORT"], let handle = FileHandle(forWritingAtPath: path) ?? {
                FileManager.default.createFile(atPath: path, contents: nil)
                return FileHandle(forWritingAtPath: path)
            }() {
                handle.seekToEndOfFile()
                handle.write(Data((line + "\n").utf8))
                try? handle.close()
            }
        }
    }
}

struct Sample: Sendable, CustomTestStringConvertible {
    let kind: MediaKind
    let tmdb: Int
    let name: String
    var season = 1
    var episode = 1
    let group: String

    var testDescription: String { "\(name)\(kind == .tvShow ? " S\(season)E\(episode)" : "") [\(group)]" }

    static func m(_ tmdb: Int, _ name: String, _ group: String) -> Sample { Sample(kind: .movie, tmdb: tmdb, name: name, group: group) }
    static func tv(_ tmdb: Int, _ name: String, _ s: Int, _ e: Int, _ group: String) -> Sample {
        Sample(kind: .tvShow, tmdb: tmdb, name: name, season: s, episode: e, group: group)
    }

    static let all: [Sample] = [
        // Well known
        m(550, "Fight Club", "popular"), m(155, "The Dark Knight", "popular"), m(27205, "Inception", "popular"),
        m(693134, "Dune: Part Two", "popular"), m(569094, "Spider-Man: Across the Spider-Verse", "popular"),
        m(1022789, "Inside Out 2", "family"), m(1184918, "The Wild Robot", "family"),
        // New
        m(911430, "F1", "new"), m(1233413, "Sinners", "new"), m(803796, "KPop Demon Hunters", "new"),
        // Old
        m(289, "Casablanca", "old"), m(15, "Citizen Kane", "old"), m(238, "The Godfather", "old"), m(539, "Psycho", "old"),
        m(19, "Metropolis", "old/silent"), m(346, "Seven Samurai", "old/international"),
        // International
        m(496243, "Parasite", "korean"), m(670, "Oldboy", "korean"), m(129, "Spirited Away", "japanese"),
        m(372058, "Your Name.", "japanese"), m(194, "Amélie", "french"), m(598, "City of God", "portuguese"),
        m(1417, "Pan's Labyrinth", "spanish"), m(579974, "RRR", "telugu"), m(20453, "3 Idiots", "hindi"),
        m(94329, "The Raid", "indonesian"), m(1069945, "Manjummel Boys", "malayalam"),
        // Obscure
        m(14337, "Primer", "obscure"), m(220289, "Coherence", "obscure"), m(13363, "The Man from Earth", "obscure"),
        // Series
        tv(1396, "Breaking Bad", 1, 1, "popular"), tv(1399, "Game of Thrones", 8, 6, "popular/finale"),
        tv(2316, "The Office", 2, 1, "comedy"), tv(1668, "Friends", 10, 17, "old/finale"), tv(456, "The Simpsons", 1, 1, "old"),
        tv(6357, "The Twilight Zone", 1, 1, "old/b&w"), tv(1408, "House", 3, 5, "procedural"),
        tv(66732, "Stranger Things", 4, 9, "popular/long episode"), tv(95396, "Severance", 2, 10, "new"),
        tv(100088, "The Last of Us", 2, 1, "new"), tv(126308, "Shōgun", 1, 1, "new"),
        tv(93405, "Squid Game", 2, 1, "korean"), tv(94796, "Crash Landing on You", 1, 1, "korean"),
        tv(70523, "Dark", 1, 1, "german"), tv(71446, "Money Heist", 1, 1, "spanish"), tv(76669, "Elite", 1, 1, "spanish"),
        tv(79352, "Sacred Games", 1, 1, "hindi"), tv(101352, "Panchayat", 1, 1, "hindi"),
        tv(1429, "Attack on Titan", 1, 1, "anime"), tv(209867, "Frieren: Beyond Journey's End", 1, 1, "anime"),
        tv(85937, "Demon Slayer: Kimetsu no Yaiba", 1, 1, "anime"), tv(37854, "One Piece", 1, 1000, "anime/deep episode"),
        tv(61709, "Dragon Ball Z Kai", 1, 1, "anime/old"), tv(82728, "Bluey", 1, 1, "kids"),
    ]
}

private func catalogTitle(_ sample: Sample) async throws -> Title? {
    let rows: [CatalogRow] = try await Supabase.shared.select(sample.kind.table, [
        URLQueryItem(name: "select", value: CatalogRow.columns),
        URLQueryItem(name: "source_key", value: "eq.tmdb:\(sample.kind.tmdbPath):\(sample.tmdb)"),
        URLQueryItem(name: "limit", value: "1"),
    ], auth: .optional)
    return rows.first?.asTitle(sample.kind)
}

private func request(_ sample: Sample, title: Title? = nil) -> PlayRequest {
    // A distinct id per title: runtimes and markers are cached by it.
    var t = title ?? Title(kind: sample.kind, dbId: -sample.tmdb, name: sample.name, year: nil, overview: nil, genre: nil, ageRating: nil)
    t.tmdbId = sample.tmdb
    return PlayRequest(title: t, season: sample.kind == .tvShow ? sample.season : nil, episode: sample.kind == .tvShow ? sample.episode : nil)
}

// MARK: - Catalog, TMDB, runtimes

@Suite(.enabled(if: Live.on), .serialized) struct LiveCatalogTests {
    @Test(arguments: Sample.all)
    func titleIsInTheCatalog(_ sample: Sample) async throws {
        let title = try await catalogTitle(sample)
        let details: TMDBDetails? = try? await TMDB.shared.get("\(sample.kind.tmdbPath)/\(sample.tmdb)")
        Live.report("catalog", ["title": sample.testDescription, "inCatalog": title != nil, "dbId": title?.dbId ?? 0,
                                "catalogLanguage": title?.originalLanguage ?? NSNull(), "tmdbLanguage": details?.originalLanguage ?? NSNull(),
                                "ageRating": title?.ageRating ?? NSNull(), "poster": title?.poster != nil])
        #expect(details != nil, "TMDB knows \(sample.name)")
        #expect(title != nil, "\(sample.testDescription) is missing from the catalog")
        if let title {
            #expect(title.name.isEmpty == false)
            #expect(title.tmdbId == sample.tmdb)
        }
    }

    @MainActor @Test(arguments: Sample.all)
    func runtimeIsKnown(_ sample: Sample) async {
        let seconds = await ExpectedRuntime.seconds(for: request(sample))
        Live.report("runtime", ["title": sample.testDescription, "minutes": seconds.map { $0 / 60 } ?? NSNull()])
        #expect(seconds != nil, "no runtime for \(sample.testDescription): wrong-video checks are off for it")
    }

    @Test func ageRatingsAreClean() async throws {
        struct Row: Decodable { let ageRating: String? }
        for table in ["movies", "tv_shows"] {
            let rows: [Row] = try await Supabase.shared.select(table, [
                URLQueryItem(name: "select", value: "age_rating"), URLQueryItem(name: "limit", value: "1000"),
                URLQueryItem(name: "order", value: "id.desc"),
            ], auth: .optional)
            let values = Dictionary(grouping: rows.compactMap(\.ageRating), by: { $0 }).mapValues(\.count)
            let unclean = values.keys.filter { $0 != $0.trimmingCharacters(in: .whitespacesAndNewlines) || $0 != $0.uppercased() }
            let missing = rows.filter { $0.ageRating == nil }.count
            Live.report("ageRatings", ["table": table, "values": values, "missing": missing, "unclean": unclean])
            #expect(unclean.isEmpty, "\(table) has ratings the kids filter may not read: \(unclean)")
        }
    }
}

// MARK: - Every server × every title

@MainActor
enum ServerProbe {
    struct Result {
        var played = false
        var startup: Double?
        var duration = 0.0
        var height = 0
        var audio: [String] = []
        var text: [String] = []
        var cuesLoaded = 0
        var firstCue = ""
        var wrongVideo = false
        var note = ""
    }

    static func window() -> UIWindow? {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
    }

    static func run(_ server: StreamServer, _ sample: Sample, expected: Double?, timeout: Double = 50) async -> Result {
        var result = Result()
        let url = server.build(sample.tmdb, sample.kind, sample.season, sample.episode)
        guard let web = WebEngines.make(allowedHost: url.host) else { result.note = "no web engine"; return result }
        web.view.frame = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        web.view.alpha = 0.02
        window()?.addSubview(web.view)
        defer {
            web.send(.stop)
            web.load(URL(string: "about:blank")!)
            web.view.removeFromSuperview()
        }
        web.load(url)
        let start = Date()
        var last: MediaState?
        while Date().timeIntervalSince(start) < timeout {
            try? await Task.sleep(for: .milliseconds(300))
            var state: MediaState?
            web.poll { state = $0 }
            guard let state else { continue }
            last = state
            web.send(.mute)
            if state.paused, state.ready >= 2 { web.send(.play) }
            if let expected, ExpectedRuntime.isWrong(state.d, expected: expected) { result.wrongVideo = true }
            if state.t > 0.4, !state.paused { result.played = true; result.startup = Date().timeIntervalSince(start); break }
        }
        guard result.played else {
            result.note = last == nil ? "never reported a video" : "video stuck (t=\(last!.t), ready=\(last!.ready), paused=\(last!.paused))"
            result.duration = last?.d ?? 0
            return result
        }
        // Let tracks show up, then try the first English-ish subtitle track.
        try? await Task.sleep(for: .seconds(4))
        var state: MediaState?
        web.poll { state = $0 }
        if let state {
            result.duration = state.d
            result.height = state.height
            result.audio = state.audio.map { "\($0.language)|\($0.label)" }
            result.text = state.text.map { "\($0.language)|\($0.label)" }
            if let expected, ExpectedRuntime.isWrong(state.d, expected: expected) { result.wrongVideo = true }
            let english = state.text.first { PlayerModel.matches($0, "en") } ?? state.text.first
            if let english {
                web.send(.textTrack(english.index))
                web.send(.seekTo(max(60, state.t)))
                for _ in 0..<30 {
                    try? await Task.sleep(for: .milliseconds(300))
                    var s: MediaState?
                    web.poll { s = $0 }
                    if let s, let on = s.text.first(where: { $0.index == english.index }) {
                        result.cuesLoaded = on.cues
                        if !s.cue.isEmpty { result.firstCue = String(s.cue.prefix(60)); break }
                    }
                }
            }
        }
        return result
    }
}

@MainActor @Suite(.enabled(if: Live.on), .serialized) struct LivePlaybackTests {
    @Test(arguments: Sample.all)
    func someServerPlaysTheRightVideo(_ sample: Sample) async throws {
        let expected = await ExpectedRuntime.seconds(for: request(sample))
        // All servers at once, like the app's race.
        let results = await withTaskGroup(of: (String, ServerProbe.Result).self) { group in
            for server in StreamServer.all {
                group.addTask { @MainActor in (server.id, await ServerProbe.run(server, sample, expected: expected)) }
            }
            var all: [String: ServerProbe.Result] = [:]
            for await (id, result) in group { all[id] = result }
            return all
        }
        for server in StreamServer.all {
            let r = results[server.id]!
            Live.report("playback", [
                "title": sample.testDescription, "group": sample.group, "server": server.id, "played": r.played,
                "startup": r.startup.map { (($0 * 10).rounded()) / 10 } ?? NSNull(), "minutes": (r.duration / 6).rounded() / 10,
                "expectedMinutes": expected.map { ($0 / 6).rounded() / 10 } ?? NSNull(), "wrongVideo": r.wrongVideo,
                "height": r.height, "audio": r.audio.prefix(30).map { $0 }, "audioCount": r.audio.count,
                "subtitles": Array(Set(r.text)).sorted().prefix(30).map { $0 }, "subtitleCount": r.text.count,
                "cuesLoaded": r.cuesLoaded, "firstCue": r.firstCue, "note": r.note,
            ])
        }
        let good = results.values.filter { $0.played && !$0.wrongVideo }
        #expect(!good.isEmpty, "no server played \(sample.testDescription)")
        for (id, r) in results where r.played && r.wrongVideo {
            Issue.record("\(id) plays the wrong video for \(sample.testDescription) (\(Int(r.duration / 60)) min, expected \(Int((expected ?? 0) / 60)))")
        }
    }
}

// MARK: - Subtitles (OpenSubtitles through the site)

@Suite(.enabled(if: Live.on), .serialized) struct LiveSubtitleTests {
    static let quick: [(Sample, String)] = [
        (Sample.all.first { $0.tmdb == 550 }!, "en"), (Sample.all.first { $0.tmdb == 1396 }!, "en"),
        (Sample.all.first { $0.tmdb == 496243 }!, "en"), (Sample.all.first { $0.tmdb == 93405 }!, "en"),
        (Sample.all.first { $0.tmdb == 71446 }!, "es"), (Sample.all.first { $0.tmdb == 194 }!, "fr"),
    ]

    static var cases: [String] {
        let pairs = Live.allSubtitles ? Sample.all.flatMap { s in ["en", "es", "fr", "pt", "de", "ar"].map { (s, $0) } } : quick
        return pairs.map { "\($0.0.kind.rawValue)|\($0.0.tmdb)|\($0.0.season)|\($0.0.episode)|\($0.1)" }
    }

    @MainActor @Test(arguments: cases)
    func subtitleFileIsUsable(_ key: String) async throws {
        let parts = key.split(separator: "|").map(String.init)
        let sample = Sample.all.first { $0.kind.rawValue == parts[0] && String($0.tmdb) == parts[1] && String($0.season) == parts[2] && String($0.episode) == parts[3] }!
        let language = parts[4]
        let req = request(sample)
        let started = Date()
        let file = await ExternalSubtitles.load(req, language: language)
        let runtime = await ExpectedRuntime.seconds(for: req)
        let last = file?.cues.last?.end ?? 0
        let first = file?.cues.first?.start ?? 0
        Live.report("subtitles", ["title": sample.testDescription, "language": language, "found": file != nil,
                                  "lines": file?.cues.count ?? 0, "release": file?.release ?? NSNull(), "versions": file?.versions ?? 0,
                                  "firstCue": first, "lastCueMinutes": (last / 6).rounded() / 10,
                                  "runtimeMinutes": runtime.map { ($0 / 6).rounded() / 10 } ?? NSNull(),
                                  "seconds": (Date().timeIntervalSince(started) * 10).rounded() / 10])
        guard let file else {
            Issue.record("no \(language) subtitles for \(sample.testDescription)")
            return
        }
        #expect(file.cues.count > 50, "suspiciously few lines")
        #expect(first < 900, "first line after 15 minutes: wrong file or offset")
        if let runtime {
            #expect(last <= runtime + 180, "subtitles run past the end (\(Int(last / 60)) vs \(Int(runtime / 60)) min): wrong cut or framerate")
            #expect(last >= runtime * 0.6, "subtitles stop early (\(Int(last / 60)) vs \(Int(runtime / 60)) min)")
        }
        #expect(file.cues.allSatisfy { $0.end > $0.start })
        #expect(file.cues.allSatisfy { !$0.text.contains("<") || $0.text.contains("<3") }, "markup left in the text")
    }
}

// MARK: - Search

@Suite(.enabled(if: Live.on), .serialized) struct LiveSearchTests {
    // query, expected "kind:tmdb" in the first N results
    static let cases: [(String, String, Int)] = [
        ("Breaking Bad", "tv_show:1396", 3), ("breaking bad", "tv_show:1396", 3), ("BREAKING BAD", "tv_show:1396", 3),
        ("Parasite", "movie:496243", 5), ("기생충", "movie:496243", 5), ("Amélie", "movie:194", 5), ("Amelie", "movie:194", 5),
        ("Spider-Man: Across the Spider-Verse", "movie:569094", 3), ("spider man across the spider verse", "movie:569094", 5),
        ("Up", "movie:14160", 10), ("It", "movie:346364", 10), ("2001", "movie:62", 10), ("The Office", "tv_show:2316", 5),
        ("Squid Game", "tv_show:93405", 3), ("La Casa de Papel", "tv_show:71446", 5), ("Money Heist", "tv_show:71446", 3),
        ("3 Idiots", "movie:20453", 3), ("RRR", "movie:579974", 3), ("Frieren", "tv_show:209867", 5), ("Shogun", "tv_show:126308", 5),
        ("Tom Hanks", "movie:13", 15), ("Christopher Nolan", "movie:27205", 20), ("Bryan Cranston", "tv_show:1396", 15),
        ("Pedro Pascal", "tv_show:100088", 20), ("Song Kang-ho", "movie:496243", 20), ("Hayao Miyazaki", "movie:129", 20),
        ("the dark knight", "movie:155", 3), ("Godfather", "movie:238", 5), ("Breking Bad", "tv_show:1396", 5),
        ("Stranger Thngs", "tv_show:66732", 5), ("Dune Part Two", "movie:693134", 3), ("Dune 2", "movie:693134", 5),
    ]

    @Test(arguments: cases.map { "\($0.0)|\($0.1)|\($0.2)" })
    func findsTheTitle(_ key: String) async throws {
        let parts = key.split(separator: "|").map(String.init)
        let (query, wanted, within) = (parts[0], parts[1], Int(parts[2])!)
        var results = try await Catalog.search(query, kids: false)
        // What the Search page shows: Ask binge. runs when the search alone finds nothing.
        if AskBinge.shouldAutoAsk(query, results: results), results.isEmpty {
            results = (try? await AskBinge.ask(query, kids: false).titles.map(\.0)) ?? []
        }
        let keys = results.map { "\($0.kind.rawValue):\($0.tmdbId ?? 0)" }
        let rank = keys.firstIndex(of: wanted)
        Live.report("search", ["query": query, "wanted": wanted, "rank": rank.map { $0 + 1 } ?? NSNull(), "results": results.count,
                               "top": results.prefix(5).map(\.name)])
        #expect(rank != nil && rank! < within, "“\(query)” should find \(wanted) in the top \(within); got \(results.prefix(5).map(\.name))")
        #expect(Set(results.map(\.id)).count == results.count, "duplicate results")
    }

    @Test(arguments: ["The Dark Knight", "Oppenheimer", "Breaking Bad", "Squid Game", "Deadpool", "The Exorcist"])
    func kidsProfilesDontSeeGrownUpTitles(_ query: String) async throws {
        let results = try await Catalog.search(query, kids: true)
        Live.report("kidsSearch", ["query": query, "results": results.map { "\($0.name) [\($0.ageRating ?? "nil")]" }])
        #expect(results.allSatisfy { KidsFilter.allows($0.ageRating) })
    }

    @Test(arguments: ["Bluey", "Toy Story", "Frozen", "Paw Patrol", "Moana"])
    func kidsProfilesFindKidsTitles(_ query: String) async throws {
        let results = try await Catalog.search(query, kids: true)
        Live.report("kidsSearch", ["query": query, "results": results.prefix(5).map { "\($0.name) [\($0.ageRating ?? "nil")]" }])
        #expect(!results.isEmpty, "a kids profile can't find \(query)")
    }

    @Test(arguments: ["", " ", "zzzzqqqqxxxx", "%", "'; drop table movies;--", String(repeating: "a", count: 300), "🙂"])
    func oddQueriesDontBreak(_ query: String) async {
        let results = try? await Catalog.search(query, kids: false)
        Live.report("oddSearch", ["query": String(query.prefix(30)), "ok": results != nil, "results": results?.count ?? 0])
        if query.trimmingCharacters(in: .whitespaces).isEmpty { return } // the view never searches these
        #expect(results != nil, "search threw for \(query.prefix(30))")
    }
}

// MARK: - Rows, recommendations, Ask binge.

@Suite(.enabled(if: Live.on), .serialized) struct LiveRowsTests {
    static var pages: [String] { ["home", "home-kids", "movies", "series", "movies-kids", "series-kids"] }

    static func specs(_ page: String) -> ([RowSpec], Bool) {
        switch page {
        case "home": return (Rows.home(kids: false), false)
        case "home-kids": return (Rows.home(kids: true), true)
        case "movies": return (Rows.browse(.movie, kids: false), false)
        case "series": return (Rows.browse(.tvShow, kids: false), false)
        case "movies-kids": return (Rows.browse(.movie, kids: true), true)
        default: return (Rows.browse(.tvShow, kids: true), true)
        }
    }

    @Test(arguments: pages)
    func everyRowFills(_ page: String) async {
        let (specs, kids) = Self.specs(page)
        let loaded = await Catalog.loadAll(specs, kids: kids)
        for spec in specs {
            let row = loaded.first { $0.id == spec.id }
            let items = row?.items ?? []
            Live.report("row", ["page": page, "row": spec.title, "items": items.count,
                                "withBackdrop": items.filter { $0.backdrop != nil }.count, "comingSoon": items.filter(\.comingSoon).count,
                                "first": items.prefix(3).map(\.name)])
            #expect(items.count >= 6, "\(page) › \(spec.title) has \(items.count) titles")
            #expect(Set(items.map(\.id)).count == items.count, "\(spec.title) repeats a title")
            #expect(items.allSatisfy { $0.poster != nil }, "\(spec.title) has titles without posters")
            #expect(items.allSatisfy { $0.kind == spec.kind })
            if kids { #expect(items.allSatisfy { KidsFilter.allows($0.ageRating) }, "\(spec.title) shows a non-kids title") }
        }
        #expect(loaded.first?.items.contains { $0.backdrop != nil } == true, "\(page) has no spotlight")
    }

    @Test func recommendationsFromRealTitles() async throws {
        let watched = try await [Sample.all[0], Sample.all.first { $0.tmdb == 93405 }!, Sample.all.first { $0.tmdb == 209867 }!]
            .asyncMap { try await catalogTitle($0) }.compactMap { $0 }
        let loved = try await [Sample.all.first { $0.tmdb == 496243 }!].asyncMap { try await catalogTitle($0) }.compactMap { $0 }
        #expect(watched.count == 3)
        let items = watched.map { ContinueItem(title: $0, season: 1, episode: 1, position: 100, duration: 1000) }
        let exclude = Set(watched.map(\.id) + loved.map(\.id))
        let rows = await Personal.build(watched: items, loved: loved, exclude: exclude, kids: false, name: "Test")
        Live.report("recs", ["topPicks": rows.topPicks?.items.prefix(12).map(\.name) ?? [], "because": rows.because.map(\.title)])
        #expect((rows.topPicks?.items.count ?? 0) >= 12)
        #expect(rows.because.count >= 2)
        let shown = (rows.topPicks?.items ?? []) + rows.because.flatMap(\.items)
        #expect(!shown.contains { exclude.contains($0.id) })
        #expect(rows.because.allSatisfy { Set($0.items.map(\.id)).count == $0.items.count })
    }

    @Test(arguments: ["something like Severance but funnier", "a cozy mystery under 2 hours", "korean thrillers from the last few years",
                      "anime for someone who loved Attack on Titan", "a feel-good movie for a family night"])
    func askBingeFindsCatalogTitles(_ query: String) async throws {
        let started = Date()
        let result = try await AskBinge.ask(query, kids: false)
        Live.report("ask", ["query": query, "summary": result.summary ?? "", "titles": result.titles.map(\.0.name),
                            "seconds": (Date().timeIntervalSince(started) * 10).rounded() / 10])
        #expect(result.titles.count >= 3, "Ask binge. found \(result.titles.count) catalog titles")
        #expect(result.titles.allSatisfy { $0.0.tmdbId != nil })
        #expect(Set(result.titles.map(\.0.id)).count == result.titles.count)
    }

    @Test func outsideRatings() async throws {
        for sample in [Sample.all[0], Sample.all.first { $0.tmdb == 1396 }!, Sample.all.first { $0.tmdb == 496243 }!] {
            var title = Title(kind: sample.kind, dbId: 0, name: sample.name, year: nil, overview: nil, genre: nil, ageRating: nil)
            title.tmdbId = sample.tmdb
            let ratings = await OutsideRatings.load(title)
            Live.report("outsideRatings", ["title": sample.name, "imdb": ratings?.imdbRating ?? NSNull(), "rt": ratings?.rottenTomatoes ?? NSNull()])
            #expect(ratings?.imdbRating != nil, "no IMDb rating for \(sample.name)")
        }
    }

    @Test(arguments: [(299534, "Marvel Cinematic Universe", 20), (385687, "Fast & Furious", 8), (11, "Star Wars", 8), (671, "Harry Potter", 6), (120, "The Lord of the Rings", 3)])
    func franchises(_ tmdb: Int, _ name: String, _ minimum: Int) async {
        var title = Title(kind: .movie, dbId: 0, name: "", year: nil, overview: nil, genre: nil, ageRating: nil)
        title.tmdbId = tmdb
        let order = await Franchises.find(for: title, kids: false)
        Live.report("franchise", ["seed": tmdb, "name": order?.name ?? NSNull(), "release": order?.release.count ?? 0, "story": order?.story?.count ?? NSNull()])
        #expect(order?.name.hasPrefix(name) == true, "got \(order?.name ?? "nothing")")
        #expect((order?.release.count ?? 0) >= minimum, "only \(order?.release.count ?? 0) films matched the catalog")
    }

    @MainActor @Test(arguments: [(209867, "Frieren: Beyond Journey's End", 1, 2), (85937, "Demon Slayer: Kimetsu no Yaiba", 1, 3), (1429, "Attack on Titan", 1, 2)])
    func animeIntroMarkers(_ tmdb: Int, _ name: String, _ season: Int, _ episode: Int) async {
        var title = Title(kind: .tvShow, dbId: -tmdb, name: name, year: nil, overview: nil, genre: "Animation", ageRating: nil)
        title.tmdbId = tmdb
        let markers = await EpisodeMarkerStore.markers(for: title, season: season, episode: episode)
        Live.report("markers", ["title": name, "intro": markers.intro.map { "\($0.start)-\($0.end) \($0.source)" } ?? NSNull(),
                                "credits": markers.credits ?? NSNull()])
        #expect(markers.intro != nil, "no intro timing for \(name)")
        if let intro = markers.intro { #expect(intro.end - intro.start > 30 && intro.end - intro.start < 200) }
    }

    @Test func publicTablesAndRPCs() async throws {
        struct Config: Decodable { let provider: String; let enabled: Bool }
        let config: [Config] = try await Supabase.shared.select("server_config", [URLQueryItem(name: "select", value: "provider,enabled")], auth: .optional)
        // Signed-in only (granted to authenticated); the TV always has a session.
        let reports: [ServerPlan.Report] = (try? await Supabase.shared.rpc("stream_report_summary", ["p_media_type": "movie", "p_media_id": 1])) ?? []
        struct Marker: Decodable { let kind: String }
        let markers: [Marker] = try await Supabase.shared.rpc("episode_marker_summary", ["p_media_id": 1, "p_season": 1, "p_episode": 1])
        Live.report("rpc", ["serverConfig": config.map { "\($0.provider)=\($0.enabled)" }, "reports": reports.count, "markers": markers.count])
        let known = Set(StreamServer.all.map(\.id))
        let off = config.filter { !$0.enabled && known.contains($0.provider) }.map(\.provider)
        #expect(off.count < known.count, "every TV server is switched off in the admin panel: \(off)")
    }
}

// MARK: - Sports

@MainActor @Suite(.enabled(if: Live.on), .serialized) struct LiveSportsTests {
    @Test func feedsLoadAndMerge() async {
        let first = await SportsFeed.load()
        let second = await SportsFeed.load()
        let live = first.filter(\.isLive)
        let byFeed = Dictionary(grouping: first.flatMap(\.streams), by: { SportsMemory.family($0.label).components(separatedBy: " · ").first ?? "" }).mapValues(\.count)
        Live.report("sports", ["games": first.count, "live": live.count, "channels": first.filter(\.is247).count, "streamsByFeed": byFeed,
                               "leagues": Dictionary(grouping: first, by: \.league).mapValues(\.count)])
        #expect(!first.isEmpty, "no games from any feed")
        #expect(Set(first.map(\.id)).count == first.count, "duplicate game ids")
        #expect(first.allSatisfy { !$0.streams.isEmpty })
        // Ids stay put between refreshes (the player re-finds its game by id).
        let stable = Set(first.filter { !$0.is247 }.map(\.id)).intersection(second.map(\.id)).count
        let total = first.filter { !$0.is247 }.count
        #expect(total == 0 || Double(stable) / Double(total) > 0.9, "only \(stable) of \(total) game ids were stable")
        // The same matchup shouldn't be listed twice.
        let matchups = first.compactMap { g in g.teamTokens.map { "\($0.sorted())@\(Int((g.startsAt?.timeIntervalSince1970 ?? 0) / 10800))" } }
        let repeated = Dictionary(grouping: matchups, by: { $0 }).filter { $0.value.count > 1 }.keys
        #expect(repeated.isEmpty, "games listed twice: \(Array(repeated))")
    }

    @Test(arguments: League.all.map(\.id))
    func scoreboardDecodes(_ id: String) async throws {
        let league = League.all.first { $0.id == id }!
        let events = try await Scoreboard.load(league)
        Live.report("scoreboard", ["league": league.name, "events": events.count, "live": events.filter(\.isLive).count])
        for event in events {
            #expect(event.away != nil && event.home != nil)
        }
    }

    @Test func liveGamesResolveAndPlay() async {
        let games = await SportsFeed.load().filter { $0.isLive && !$0.is247 }.prefix(3)
        for game in games {
            let servers = await SportsFeed.servers(for: game, limit: 4)
            var played: [String] = []
            for server in servers.prefix(3) {
                let url = server.build(0, .movie, 1, 1)
                guard let web = WebEngines.make(allowedHost: url.host) else { continue }
                web.view.frame = CGRect(x: 0, y: 0, width: 1920, height: 1080)
                web.view.alpha = 0.02
                ServerProbe.window()?.addSubview(web.view)
                web.load(url)
                let start = Date()
                var ok = false
                while Date().timeIntervalSince(start) < 25 {
                    try? await Task.sleep(for: .milliseconds(400))
                    var s: MediaState?
                    web.poll { s = $0 }
                    if let s { web.send(.mute); if s.paused, s.ready >= 2 { web.send(.play) }; if s.t > 0.4, !s.paused { ok = true; break } }
                }
                web.send(.stop)
                web.load(URL(string: "about:blank")!)
                web.view.removeFromSuperview()
                Live.report("livePlayback", ["game": game.title, "server": server.name, "played": ok,
                                             "seconds": ok ? (Date().timeIntervalSince(start) * 10).rounded() / 10 : NSNull()])
                if ok { played.append(server.name) }
            }
            #expect(!servers.isEmpty, "no streams resolved for \(game.title)")
        }
    }
}

// MARK: - Signed in (BINGE_EMAIL / BINGE_PASSWORD; changes are undone)

@MainActor @Suite(.enabled(if: Live.on && Live.env["BINGE_EMAIL"] != nil), .serialized) struct LiveAccountTests {
    @Test func accountRoundTrip() async throws {
        let app = AppModel()
        try await app.signIn(email: Live.env["BINGE_EMAIL"]!, password: Live.env["BINGE_PASSWORD"] ?? "")
        defer { Task { await app.signOut() } }
        if app.phase == .choosingProfile, let first = app.profiles.first { await app.pick(first) }
        await app.refreshList()
        let cw = try await app.continueWatching()
        let list = try await app.myList()
        Live.report("account", ["profiles": app.profiles.count, "continue": cw.count, "list": list.count,
                                "notes": cw.prefix(8).compactMap(\.seasonNote)])
        #expect(Set(cw.map(\.id)).count == cw.count)

        // A title that's in neither list: add, check, remove.
        let candidate = try #require(try await catalogTitle(Sample.all.first { $0.tmdb == 13363 }!))
        guard !app.isInList(candidate), !cw.contains(where: { $0.title.id == candidate.id }) else { return }
        try await app.toggleList(candidate)
        #expect(app.isInList(candidate))
        #expect(try await app.myList().contains { $0.id == candidate.id })
        try await app.toggleList(candidate)
        #expect(!app.isInList(candidate))

        // Progress saves to continue_watching, resumes, and can be removed.
        await app.saveProgress(title: candidate, season: nil, episode: nil, position: 600, duration: 5200)
        let resume = await app.resumePoint(for: candidate)
        #expect(resume?.positionSeconds == 600)
        await app.removeFromContinue(candidate)
        #expect(await app.resumePoint(for: candidate) == nil)
    }
}

extension Array {
    func asyncMap<T>(_ transform: (Element) async throws -> T) async rethrows -> [T] {
        var out: [T] = []
        for element in self { out.append(try await transform(element)) }
        return out
    }
}
