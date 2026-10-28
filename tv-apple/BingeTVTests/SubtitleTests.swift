import Foundation
import Testing
@testable import BingeTV

// OpenSubtitles files arrive as WebVTT (sometimes SRT-flavoured), are parsed
// by the app and drawn on top of any server. Every timestamp style, markup
// style and overlap pattern seen in the wild.
@Suite struct SubtitleTimestampTests {
    @Test(arguments: [
        ("00:00:01.000", 1.0), ("00:01:02.500", 62.5), ("01:02:03.456", 3723.456), ("02:03.456", 123.456),
        ("00:00:01,250", 1.25), ("1:02:03.4", 3723.4), ("  00:00:05.000  ", 5.0), ("10:00:00.000", 36000),
        ("00:00:00.000", 0),
    ] as [(String, Double)])
    func parses(_ raw: String, _ expected: Double) throws {
        let value = try #require(ExternalSubtitles.seconds(raw))
        #expect(abs(value - expected) < 0.0005)
    }

    @Test(arguments: ["", "5", "abc", "00:xx:01.000", "1:2:3:4", "00:00:01.000 align:start"])
    func rejects(_ raw: String) {
        #expect(ExternalSubtitles.seconds(raw) == nil)
    }
}

@Suite struct SubtitleParseTests {
    @Test func basicVTT() {
        let cues = ExternalSubtitles.parse("""
        WEBVTT

        1
        00:00:01.000 --> 00:00:03.000
        Hello there.

        2
        00:00:04.000 --> 00:00:06.500
        General Kenobi!
        """)
        #expect(cues == [SubtitleCue(start: 1, end: 3, text: "Hello there."), SubtitleCue(start: 4, end: 6.5, text: "General Kenobi!")])
    }

    @Test func srtWithCommasAndCRLF() {
        let srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nLine one\r\nLine two\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nNext\r\n"
        let cues = ExternalSubtitles.parse(srt)
        #expect(cues.count == 2)
        #expect(cues[0].text == "Line one\nLine two")
        #expect(cues[1].start == 3)
    }

    @Test func oldMacLineEndings() {
        #expect(ExternalSubtitles.parse("WEBVTT\r\r00:01.000 --> 00:02.000\rHi").count == 1)
    }

    @Test func cueSettingsAfterEndTimeAreIgnored() {
        let cues = ExternalSubtitles.parse("WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start position:10% line:0\nTop")
        #expect(cues == [SubtitleCue(start: 1, end: 2, text: "Top")])
    }

    @Test func noSpacesAroundArrow() {
        #expect(ExternalSubtitles.parse("00:00:01.000-->00:00:02.000\nTight").first?.text == "Tight")
    }

    @Test func markupIsStripped() {
        let cues = ExternalSubtitles.parse("""
        WEBVTT

        00:00:01.000 --> 00:00:02.000
        <i>Italic</i> and <b>bold</b> and <c.yellow>class</c> and <v Roger>voice</v>

        00:00:03.000 --> 00:00:04.000
        {\\an8}Top of screen

        00:00:05.000 --> 00:00:06.000
        <font color="#ffff00">Coloured</font>
        """)
        #expect(cues.map(\.text) == ["Italic and bold and class and voice", "Top of screen", "Coloured"])
    }

    @Test func entitiesAreDecoded() {
        let cues = ExternalSubtitles.parse("00:00:01.000 --> 00:00:02.000\nTom &amp; Jerry &lt;3 &gt; all&nbsp;day")
        #expect(cues.first?.text == "Tom & Jerry <3 > all day")
    }

    @Test func entitiesAreDecodedOnce() {
        // "&amp;lt;" is the text "&lt;" — decoding it twice would show "<".
        let cues = ExternalSubtitles.parse("00:00:01.000 --> 00:00:02.000\nWrite &amp;lt; for a less-than sign")
        #expect(cues.first?.text == "Write &lt; for a less-than sign")
    }

    @Test func notesStylesAndHeadersAreSkipped() {
        let cues = ExternalSubtitles.parse("""
        WEBVTT - Some title
        Kind: captions
        Language: en

        NOTE This is a comment
        spanning lines

        STYLE
        ::cue { color: yellow }

        REGION
        id:fred width:40%

        00:00:01.000 --> 00:00:02.000
        Only line
        """)
        #expect(cues.map(\.text) == ["Only line"])
    }

    @Test func emptyAndBackwardsCuesAreDropped() {
        let cues = ExternalSubtitles.parse("""
        00:00:01.000 --> 00:00:02.000

        00:00:05.000 --> 00:00:04.000
        Backwards

        00:00:06.000 --> 00:00:06.000
        Zero length

        00:00:07.000 --> 00:00:08.000
        <i></i>

        00:00:09.000 --> 00:00:10.000
        Kept
        """)
        #expect(cues.map(\.text) == ["Kept"])
    }

    @Test func malformedTimingIsSkippedNotFatal() {
        let cues = ExternalSubtitles.parse("""
        00:00:xx.000 --> 00:00:02.000
        Bad

        00:00:03.000 --> 00:00:04.000
        Good
        """)
        #expect(cues.map(\.text) == ["Good"])
    }

    @Test func outOfOrderCuesAreSorted() {
        let cues = ExternalSubtitles.parse("00:00:09.000 --> 00:00:10.000\nB\n\n00:00:01.000 --> 00:00:02.000\nA")
        #expect(cues.map(\.text) == ["A", "B"])
    }

    @Test func extraBlankLinesBetweenBlocks() {
        #expect(ExternalSubtitles.parse("WEBVTT\n\n\n\n00:00:01.000 --> 00:00:02.000\nA\n\n\n\n00:00:03.000 --> 00:00:04.000\nB\n\n\n").count == 2)
    }

    @Test func whitespaceOnlySeparatorLines() {
        // Some files separate cues with a line holding only spaces.
        let cues = ExternalSubtitles.parse("00:00:01.000 --> 00:00:02.000\nA\n \n00:00:03.000 --> 00:00:04.000\nB")
        #expect(cues.map(\.text) == ["A", "B"])
    }

    @Test func byteOrderMark() {
        #expect(ExternalSubtitles.parse("\u{FEFF}WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA").count == 1)
    }

    @Test func nonLatinText() {
        let cues = ExternalSubtitles.parse("00:00:01.000 --> 00:00:02.000\n안녕하세요\n\n00:00:03.000 --> 00:00:04.000\nمرحبا\n\n00:00:05.000 --> 00:00:06.000\nこんにちは")
        #expect(cues.map(\.text) == ["안녕하세요", "مرحبا", "こんにちは"])
    }

    @Test func largeFileParsesQuickly() {
        var text = "WEBVTT\n\n"
        for i in 0..<3000 {
            let s = Double(i) * 2
            text += "\(i)\n\(stamp(s)) --> \(stamp(s + 1.5))\nLine \(i)\n\n"
        }
        let start = Date()
        let cues = ExternalSubtitles.parse(text)
        #expect(cues.count == 3000)
        #expect(Date().timeIntervalSince(start) < 2)
    }

    private func stamp(_ s: Double) -> String {
        String(format: "%02d:%02d:%06.3f", Int(s) / 3600, (Int(s) % 3600) / 60, s.truncatingRemainder(dividingBy: 60))
    }
}

@Suite struct SubtitleLookupTests {
    private func file(_ cues: [(Double, Double, String)]) -> ExternalSubtitleFile {
        ExternalSubtitleFile(cues: cues.map { SubtitleCue(start: $0.0, end: $0.1, text: $0.2) }, release: nil, versions: 1, version: 0)
    }

    @Test func lineAtTime() {
        let f = file([(1, 3, "A"), (4, 6, "B"), (10, 12, "C")])
        #expect(f.text(at: 0) == "")
        #expect(f.text(at: 1) == "A")
        #expect(f.text(at: 2.999) == "A")
        #expect(f.text(at: 3) == "", "end is exclusive")
        #expect(f.text(at: 3.5) == "")
        #expect(f.text(at: 5) == "B")
        #expect(f.text(at: 11) == "C")
        #expect(f.text(at: 99) == "")
        #expect(f.text(at: -5) == "")
    }

    @Test func overlappingCuesStackInOrder() {
        let f = file([(1, 10, "Speaker one"), (2, 5, "Speaker two")])
        #expect(f.text(at: 3) == "Speaker one\nSpeaker two")
        #expect(f.text(at: 6) == "Speaker one")
    }

    @Test func atMostThreeLines() {
        let f = file([(1, 10, "1"), (1.5, 10, "2"), (2, 10, "3"), (2.5, 10, "4")])
        #expect(f.text(at: 5).split(separator: "\n").count == 3)
        #expect(f.text(at: 5) == "2\n3\n4")
    }

    @Test func longCueBehindAShortOneStillShows() {
        // A sign translation that stays up for 20s while dialogue comes and goes.
        let f = file([(0, 30, "[SIGN: Hospital]"), (5, 6, "a"), (8, 9, "b"), (12, 13, "c"), (16, 17, "d"), (20, 21, "e")])
        #expect(f.text(at: 20.5) == "[SIGN: Hospital]\ne")
        #expect(f.text(at: 25) == "[SIGN: Hospital]")
    }

    @Test func emptyFile() {
        #expect(file([]).text(at: 5) == "")
    }

    @Test func manyCuesBinarySearch() {
        let f = file((0..<10_000).map { (Double($0) * 2, Double($0) * 2 + 1, "L\($0)") })
        #expect(f.text(at: 9_000.5) == "L4500")
        #expect(f.text(at: 9_001.5) == "")
    }
}

@Suite struct EpisodeMarkerRuleTests {
    @Test(arguments: [
        (60.0, 150.0, 2700.0, true),      // a normal 90s skip early on
        (0, 15, 2700, true),              // from the very start, exactly 15s
        (0, 14.9, 2700, false),           // too short to be an intro
        (30, 240, 2700, true),            // 210s, the longest allowed
        (30, 241, 2700, false),
        (900, 990, 2700, false),          // past 10 minutes
        (500, 590, 1200, false),          // past 35% of a short episode
        (400, 490, 1200, true),
        (100, 50, 2700, false),           // backwards
        (-1, 80, 2700, false),
        (100, 190, 0, true),              // unknown duration: first 10 min
    ] as [(Double, Double, Double, Bool)])
    func introSkip(_ from: Double, _ to: Double, _ duration: Double, _ expected: Bool) {
        #expect(EpisodeMarkers.looksLikeIntroSkip(from: from, to: to, duration: duration) == expected)
    }

    @Test(arguments: [
        (2300.0, 2700.0, true), (2295, 2700, true), (2290, 2700, false), (2681, 2700, false), (2680, 2700, true),
        (250, 299, false), (0, 2700, false), (2700, 2700, false),
    ] as [(Double, Double, Bool)])
    func credits(_ time: Double, _ duration: Double, _ expected: Bool) {
        #expect(EpisodeMarkers.looksLikeCredits(time: time, duration: duration) == expected)
    }
}

@Suite struct SeasonStatusTests {
    private static let now: Date = {
        var c = DateComponents(); c.year = 2026; c.month = 10; c.day = 21; c.hour = 12 // a Wednesday
        return Calendar.current.date(from: c)!
    }()

    private func day(_ offset: Int) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Calendar.current.date(byAdding: .day, value: offset, to: Self.now)!)
    }

    private func details(seasons: [(Int, Int, Int?)], next: (Int, Int, Int)? = nil, status: String? = "Returning Series") -> TMDBDetails {
        var json: [String: Any] = ["id": 1, "status": status as Any,
                                   "seasons": seasons.map { s -> [String: Any] in
                                       var d: [String: Any] = ["season_number": s.0, "episode_count": s.1]
                                       if let offset = s.2 { d["air_date"] = day(offset) }
                                       return d
                                   }]
        if let next { json["next_episode_to_air"] = ["season_number": next.0, "episode_number": next.1, "air_date": day(next.2)] }
        if status == nil { json["status"] = nil }
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try! decoder.decode(TMDBDetails.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test func friendlyDays() {
        #expect(SeasonStatus.friendlyDay(day(0), now: Self.now) == "today")
        #expect(SeasonStatus.friendlyDay(day(1), now: Self.now) == "tomorrow")
        #expect(SeasonStatus.friendlyDay(day(2), now: Self.now) == "Friday")
        #expect(SeasonStatus.friendlyDay(day(6), now: Self.now) == "Tuesday")
        #expect(SeasonStatus.friendlyDay(day(7), now: Self.now)?.contains("28") == true)
        #expect(SeasonStatus.friendlyDay(day(-1), now: Self.now) == nil)
        #expect(SeasonStatus.friendlyDay(nil, now: Self.now) == nil)
        #expect(SeasonStatus.friendlyDay("soon", now: Self.now) == nil)
    }

    @Test func episodesLeft() {
        let d = details(seasons: [(1, 10, -400), (2, 8, -100), (3, 10, -30)], status: "Ended")
        #expect(SeasonStatus.note(d, season: 3, episode: 2, now: Self.now) == "8 episodes left in Season 3")
        #expect(SeasonStatus.note(d, season: 3, episode: 8, now: Self.now) == "2 episodes left in Season 3")
        #expect(SeasonStatus.note(d, season: 3, episode: 9, now: Self.now) == "Season finale next")
        #expect(SeasonStatus.note(d, season: 3, episode: 10, now: Self.now) == "Series finale")
    }

    @Test func airingSeasonCountsOnlyAiredEpisodes() {
        // Season 2 has 10 episodes listed, episode 6 airs Friday: 5 are out.
        let d = details(seasons: [(1, 10, -400), (2, 10, -30)], next: (2, 6, 2))
        #expect(SeasonStatus.note(d, season: 2, episode: 2, now: Self.now) == "3 episodes left in Season 2")
        #expect(SeasonStatus.note(d, season: 2, episode: 4, now: Self.now) == "1 episode left so far")
        #expect(SeasonStatus.note(d, season: 2, episode: 5, now: Self.now) == "Next episode Friday")
    }

    @Test func nextSeasonAnnounced() {
        let d = details(seasons: [(1, 8, -400), (2, 8, 3)], next: (2, 1, 3))
        #expect(SeasonStatus.note(d, season: 1, episode: 8, now: Self.now) == "Season 2 starts Saturday")
        #expect(SeasonStatus.note(d, season: 1, episode: 7, now: Self.now) == "Season finale next")
    }

    @Test func laterSeasonAlreadyOut() {
        let d = details(seasons: [(1, 8, -800), (2, 8, -400)], status: "Ended")
        #expect(SeasonStatus.note(d, season: 1, episode: 8, now: Self.now) == "Season 2 is out")
    }

    @Test func specialsAreIgnored() {
        let d = details(seasons: [(0, 30, -900), (1, 6, -400)], status: "Ended")
        #expect(SeasonStatus.note(d, season: 1, episode: 6, now: Self.now) == "Series finale")
    }

    @Test func invalidPositions() {
        let d = details(seasons: [(1, 8, -400)])
        #expect(SeasonStatus.note(d, season: 0, episode: 1, now: Self.now) == nil)
        #expect(SeasonStatus.note(d, season: 1, episode: 0, now: Self.now) == nil)
        // Watching past what TMDB lists (a stale season count) says nothing.
        #expect(SeasonStatus.note(d, season: 1, episode: 12, now: Self.now) == nil)
        // A season TMDB doesn't know.
        #expect(SeasonStatus.note(d, season: 5, episode: 1, now: Self.now) == nil)
    }

    @Test func canceledShow() {
        let d = details(seasons: [(1, 10, -400)], status: "Canceled")
        #expect(SeasonStatus.note(d, season: 1, episode: 10, now: Self.now) == "Series finale")
    }

    @Test func midSeasonEpisodeInAFewWeeks() {
        let d = details(seasons: [(1, 10, -60)], next: (1, 6, 20))
        #expect(SeasonStatus.note(d, season: 1, episode: 5, now: Self.now)?.hasPrefix("Next episode ") == true)
    }
}

@Suite struct AniListPickTests {
    private func media(_ mal: Int, english: String?, romaji: String, synonyms: [String] = [], episodes: Int? = 28, country: String = "JP") -> [String: Any] {
        var title: [String: Any] = ["romaji": romaji]
        if let english { title["english"] = english }
        var m: [String: Any] = ["idMal": mal, "countryOfOrigin": country, "synonyms": synonyms, "title": title]
        if let episodes { m["episodes"] = episodes }
        return m
    }

    @Test func skipsSpinOffsThatAniListRanksFirst() {
        // What AniList really returned for "Frieren: Beyond Journey's End" (2026-10-27).
        let candidates = [
            media(56885, english: nil, romaji: "Sousou no Frieren: ●● no Mahou", synonyms: ["Frieren: Beyond Journey's End: Magic of ??"], episodes: 12),
            media(52991, english: "Frieren: Beyond Journey's End", romaji: "Sousou no Frieren"),
        ]
        #expect(AniSkip.pickMalId(candidates, name: "Frieren: Beyond Journey's End", season: 1, episode: 2) == 52991)
    }

    @Test func rules() {
        let show = media(1, english: "Attack on Titan", romaji: "Shingeki no Kyojin", episodes: 25)
        #expect(AniSkip.pickMalId([show], name: "Attack on Titan", season: 1, episode: 25) == 1)
        #expect(AniSkip.pickMalId([show], name: "Attack on Titan", season: 1, episode: 26) == nil, "past the last episode")
        #expect(AniSkip.pickMalId([show], name: "Shingeki no Kyojin", season: 1, episode: 1) == 1, "romaji name")
        #expect(AniSkip.pickMalId([show], name: "Attack", season: 1, episode: 1) == nil, "season 1 needs the exact name")
        let s2 = media(2, english: "Attack on Titan Season 2", romaji: "Shingeki no Kyojin Season 2", episodes: 12)
        #expect(AniSkip.pickMalId([s2], name: "Attack on Titan", season: 2, episode: 3) == 2)
        #expect(AniSkip.pickMalId([media(3, english: "Attack on Titan", romaji: "x", country: "CN")], name: "Attack on Titan", season: 1, episode: 1) == nil)
        #expect(AniSkip.pickMalId([media(4, english: "Ongoing", romaji: "y", episodes: nil)], name: "Ongoing", season: 1, episode: 500) == 4,
                "unknown episode count (still airing) is fine")
    }
}
