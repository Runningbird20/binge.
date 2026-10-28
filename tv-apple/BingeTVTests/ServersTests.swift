import Foundation
import Testing
@testable import BingeTV

// The embed URLs each server is opened with, for every kind of title and
// every subtitle preference, plus the "last server that worked" memory.
@Suite(.serialized) struct ServersTests {
    private func server(_ id: String) -> StreamServer { StreamServer.all.first { $0.id == id }! }

    private func items(_ url: URL) -> [String: String] {
        Dictionary((URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") },
                   uniquingKeysWith: { a, _ in a })
    }

    @Test func idsAreUniqueAndKnown() {
        let ids = StreamServer.all.map(\.id)
        #expect(Set(ids).count == ids.count)
        #expect(ids == ["vidrift", "vidy", "cinesrc"])
    }

    @Test(arguments: StreamServer.all)
    func everyServerBuildsHTTPSForBothKinds(_ server: StreamServer) {
        for kind in [MediaKind.movie, .tvShow] {
            let url = server.build(550, kind, 2, 7)
            #expect(url.scheme == "https")
            #expect(url.host?.isEmpty == false)
            #expect(url.absoluteString.contains("550"))
        }
    }

    @Test func vidrift() {
        let movie = server("vidrift").build(550, .movie, 1, 1)
        #expect(movie.host == "embed.vidrift.net")
        #expect(movie.path == "/embed/movie/550")
        let tv = server("vidrift").build(1399, .tvShow, 3, 9)
        #expect(tv.path == "/embed/tv/1399/3/9")
        #expect(items(tv)["brand"] == "binge.")
    }

    @Test func vidy() {
        #expect(server("vidy").build(550, .movie, 1, 1).path == "/movie/550")
        let tv = server("vidy").build(1399, .tvShow, 10, 12)
        #expect(tv.path == "/tv/1399/10/12")
        #expect(items(tv)["autoplay"] == "true")
    }

    @Test func cinesrcEpisodesGoInTheQuery() {
        let tv = server("cinesrc").build(1399, .tvShow, 2, 4)
        #expect(tv.path == "/embed/tv/1399")
        #expect(items(tv)["s"] == "2")
        #expect(items(tv)["e"] == "4")
        #expect(items(tv)["autonext"] == "false")
        let movie = server("cinesrc").build(550, .movie, 2, 4)
        #expect(movie.path == "/embed/movie/550")
        #expect(items(movie)["s"] == nil)
    }

    @Test(arguments: PlaybackPrefs.subtitleChoices.map(\.0))
    func cinesrcSubtitleLanguage(_ code: String) {
        let saved = PlaybackPrefs.subtitle
        defer { PlaybackPrefs.subtitle = saved }
        PlaybackPrefs.subtitle = code
        let query = items(server("cinesrc").build(550, .movie, 1, 1))
        if code == "off" {
            #expect(query["subtitles"] == nil)
            #expect(query["subtitlelang"] == nil)
        } else {
            #expect(query["subtitles"] == "auto")
            #expect(query["subtitlelang"] == PlaybackPrefs.languageName(code))
            #expect(query["subtitlelang"] != code, "a language name, not the code")
        }
    }

    @Test func colorIsEncoded() {
        // "#" must be percent-encoded or it starts a fragment.
        let url = server("cinesrc").build(550, .movie, 1, 1)
        #expect(url.fragment == nil)
        #expect(items(url)["color"] == "#f4f6f8")
    }

    @Test func rankedPutsLastWorkingFirst() {
        var t = Title(kind: .tvShow, dbId: 987_654_321, name: "Test", year: nil, overview: nil, genre: nil, ageRating: nil)
        t.tmdbId = 1
        UserDefaults.standard.removeObject(forKey: "binge.server.\(t.id)") // a run cut short may have left one
        defer { UserDefaults.standard.removeObject(forKey: "binge.server.\(t.id)") }
        #expect(StreamServer.ranked(for: t).map(\.id) == ["vidrift", "vidy", "cinesrc"])
        StreamServer.rememberWorking(server("cinesrc"), for: t)
        #expect(StreamServer.ranked(for: t).map(\.id) == ["cinesrc", "vidrift", "vidy"])
        StreamServer.rememberWorking(server("vidy"), for: t)
        #expect(StreamServer.ranked(for: t).map(\.id) == ["vidy", "vidrift", "cinesrc"])
        // A server that no longer exists is ignored.
        UserDefaults.standard.set("gone", forKey: "binge.server.\(t.id)")
        #expect(StreamServer.ranked(for: t).map(\.id) == ["vidrift", "vidy", "cinesrc"])
    }

    @Test func memoryIsPerTitle() {
        let a = Title(kind: .movie, dbId: 987_000_001, name: "A", year: nil, overview: nil, genre: nil, ageRating: nil)
        let b = Title(kind: .movie, dbId: 987_000_002, name: "B", year: nil, overview: nil, genre: nil, ageRating: nil)
        defer { [a, b].forEach { UserDefaults.standard.removeObject(forKey: "binge.server.\($0.id)") } }
        StreamServer.rememberWorking(server("vidy"), for: a)
        #expect(StreamServer.ranked(for: b).first?.id == "vidrift")
    }

    @Test func equalityIsById() {
        let a = StreamServer(id: "x", name: "One") { _, _, _, _ in URL(string: "https://a")! }
        let b = StreamServer(id: "x", name: "Two") { _, _, _, _ in URL(string: "https://b")! }
        #expect(a == b)
        #expect(Set([a, b]).count == 1)
    }
}

@Suite(.serialized) struct QualityTests {
    private func server(_ id: String, _ name: String) -> StreamServer {
        StreamServer(id: id, name: name) { _, _, _, _ in URL(string: "https://example.com")! }
    }

    @Test(arguments: [("StreamFree 4K", 2160), ("Feed 2160p", 2160), ("StreamFree 1080p", 1080), ("Streamed · admin 1 HD", 720),
                      ("PPV 720p", 720), ("SD 480p", 480), ("PPV · ESPN", 0), ("VidRift", 0), ("HDTV", 0)] as [(String, Int)])
    func nominal(_ name: String, _ expected: Int) {
        #expect(QualityMemory.nominal(name) == expected)
    }

    @Test func recordRisesAtOnceAndEasesDown() {
        let s = server("test-quality-\(UUID().uuidString)", "X")
        defer { UserDefaults.standard.removeObject(forKey: "binge.q.\(s.id)") }
        #expect(QualityMemory.learned(s) == 0)
        QualityMemory.record(s, height: 0)
        #expect(QualityMemory.learned(s) == 0)
        QualityMemory.record(s, height: 1080)
        #expect(QualityMemory.learned(s) == 1080)
        QualityMemory.record(s, height: 720)
        #expect(QualityMemory.learned(s) == (1080 * 3 + 720) / 4)
        QualityMemory.record(s, height: 2160)
        #expect(QualityMemory.learned(s) == 2160)
    }

    @Test func liveStreamsAreKeyedByLabel() {
        let a = server("https://embed.example/1", "StreamFree Test \(UUID().uuidString)")
        let b = server("https://embed.example/2", a.name)
        defer { UserDefaults.standard.removeObject(forKey: "binge.q." + a.name) }
        QualityMemory.record(a, height: 1080)
        #expect(QualityMemory.learned(b) == 1080)
    }

    @Test func sortedIsStableForTies() {
        let ids = (0..<5).map { "test-sort-\($0)-\(UUID().uuidString)" }
        let list = ids.map { server($0, "N") }
        defer { ids.forEach { UserDefaults.standard.removeObject(forKey: "binge.q.\($0)") } }
        #expect(QualityMemory.sorted(list).map(\.id) == ids)
        QualityMemory.record(list[3], height: 1080)
        QualityMemory.record(list[1], height: 720)
        #expect(QualityMemory.sorted(list).map(\.id) == [ids[3], ids[1], ids[0], ids[2], ids[4]])
    }

    @Test func preferenceDefaultsToBest() {
        let saved = UserDefaults.standard.string(forKey: "binge.quality")
        defer { UserDefaults.standard.set(saved, forKey: "binge.quality") }
        UserDefaults.standard.removeObject(forKey: "binge.quality")
        #expect(QualityPreference.current == .best)
        UserDefaults.standard.set("fastest", forKey: "binge.quality")
        #expect(QualityPreference.current == .fastest)
        UserDefaults.standard.set("nonsense", forKey: "binge.quality")
        #expect(QualityPreference.current == .best)
        #expect(QualityPreference.best.label == "Best quality")
        #expect(QualityPreference.fastest.label == "Fastest start")
    }
}

@MainActor @Suite struct ExpectedRuntimeTests {
    @Test(arguments: [
        // duration, expected, wrong?
        (0.0, 7200.0, false), (59, 7200, false), (7200, 0, false),
        (7200, 7200, false), (7000, 7200, false), (5800, 7200, false), (5700, 7200, true),
        (8700, 7200, true), (8600, 7200, false),
        (98 * 60, 156 * 60, true),             // Vidy's wrong Demon Slayer
        (47 * 60, 21 * 60, true),              // a different show under the same id
        (24 * 60, 21 * 60, false),             // a little longer, same episode
        (25 * 60 + 13, 21 * 60, true),         // 20% (252s) + 1s off on a 21 min episode
        (61, 21 * 60, true),
    ] as [(Double, Double, Bool)])
    func isWrong(_ duration: Double, _ expected: Double, _ wrong: Bool) {
        #expect(ExpectedRuntime.isWrong(duration, expected: expected) == wrong)
    }
}

@Suite struct MediaCommandTests {
    @Test func scripts() {
        let cases: [(MediaCommand, String)] = [
            (.play, "play"), (.pause, "pause"), (.toggle, "toggle"), (.mute, "mute"), (.unmute, "unmute"),
            (.seekBy(10), "seekBy:10.0"), (.seekBy(-10), "seekBy:-10.0"), (.seekTo(85.5), "seekTo:85.5"), (.stop, "stop"),
            (.fill, "fill"), (.unfill, "unfill"), (.audioTrack(3), "audio:3"), (.textTrack(-1), "text:-1"),
            (.captionStyle(size: 135, background: "rgba(0,0,0,0.6)"), "cue:135:rgba(0,0,0,0.6)"),
            (.trim, "trim"), (.edge, "edge"), (.cushionStart, "cushion:start"), (.cushionOn, "cushion:on"),
        ]
        for (command, js) in cases { #expect(command.js == js) }
    }

    @Test func commandsNeverBreakOutOfTheQuotedCall() {
        // send() wraps js in '…'; no command may contain a quote or newline.
        let all: [MediaCommand] = [.play, .seekTo(1), .captionStyle(size: 100, background: "transparent")]
            + PlaybackPrefs.captionBackgrounds.map { .captionStyle(size: 175, background: $0.0) }
        for command in all {
            #expect(!command.js.contains("'"))
            #expect(!command.js.contains("\n"))
            #expect(!command.js.contains("\\"))
        }
    }

    @Test func bridgeStateParsing() {
        let state = BridgeProxy.parse([
            "t": 12.5, "d": 3600, "paused": false, "ended": false, "ready": 4, "h": 1080, "fr": 900, "dr": 3, "cb": 1,
            "at": [["i": 0, "l": "English", "g": "en", "on": true], ["i": 1, "l": "Korean", "g": "ko", "on": false]],
            "tt": [["i": 2, "l": "English", "g": "en", "on": true, "n": 512]],
            "cue": "Hello\nthere",
        ])
        #expect(state.t == 12.5)
        #expect(state.d == 3600)
        #expect(!state.paused)
        #expect(state.ready == 4)
        #expect(state.video)
        #expect(state.height == 1080)
        #expect(state.frames == 900)
        #expect(state.dropped == 3)
        #expect(state.cushion)
        #expect(state.audio.count == 2)
        #expect(state.audio[1].language == "ko")
        #expect(state.text == [MediaTrack(index: 2, label: "English", language: "en", on: true, cues: 512)])
        #expect(state.cue == "Hello\nthere")
    }

    @Test func bridgeStateDefaults() {
        let state = BridgeProxy.parse([:])
        #expect(state.t == 0)
        #expect(state.paused)
        #expect(state.frames == -1)
        #expect(!state.cushion)
        #expect(state.audio.isEmpty)
        // A track without an index is dropped, not crashed on.
        #expect(BridgeProxy.parse(["at": [["l": "x"]]]).audio.isEmpty)
    }
}

@MainActor @Suite struct RuntimeAgreementTests {
    @Test func serversAgreeingBeatTMDB() {
        // Money Heist S1E1 (2026-10-27): Vidy 47.5 min, CineSrc 48.6, TMDB 90.
        #expect(ExpectedRuntime.agree(48.6 * 60, [47.5 * 60]))
        #expect(!ExpectedRuntime.agree(48.6 * 60, []))
        #expect(!ExpectedRuntime.agree(98 * 60, [47 * 60]), "two different wrong videos don't agree")
        #expect(ExpectedRuntime.agree(5400, [5440]))
    }
}
