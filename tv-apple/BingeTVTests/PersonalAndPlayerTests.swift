import Foundation
import Testing
@testable import BingeTV

private func t(_ id: Int, _ kind: MediaKind = .movie, lang: String? = "en", genre: String? = "Drama", backdrop: Bool = true) -> Title {
    var title = Title(kind: kind, dbId: id, name: "Title \(id)", year: 2020, overview: nil, genre: genre, ageRating: "PG")
    title.tmdbId = id + 100_000
    title.originalLanguage = lang
    if backdrop { title.backdrop = URL(string: "https://image.tmdb.org/t/p/w1280/\(id).jpg") }
    return title
}

private func watching(_ title: Title, newEpisode: String? = nil) -> ContinueItem {
    var item = ContinueItem(title: title, season: 1, episode: 1, position: 100, duration: 1000)
    item.newEpisode = newEpisode
    return item
}

// Home's personal rows: Top Picks, "Because you watched/liked X", New Episodes.
@Suite struct PersonalAssembleTests {
    private func range(_ ids: ClosedRange<Int>, lang: String = "en") -> [Title] { ids.map { t($0, lang: lang) } }

    @Test func nothingWatchedNothingPersonal() {
        let rows = Personal.assemble(watched: [], loved: [], recommendations: [:], exclude: [], name: "Sam")
        #expect(rows.topPicks == nil)
        #expect(rows.because.isEmpty)
        #expect(rows.newEpisodes == nil)
    }

    @Test func newEpisodesRow() {
        let show = t(1, .tvShow)
        let rows = Personal.assemble(watched: [watching(show, newEpisode: "S2:E3"), watching(t(2, .tvShow))], loved: [],
                                     recommendations: [:], exclude: [], name: nil)
        #expect(rows.newEpisodes?.items.map(\.id) == [show.id])
        #expect(rows.newEpisodes?.items.first?.badge == "New S2:E3")
    }

    @Test func seedsAreFourRecentAndUpToSevenTotal() {
        let watched = (1...6).map { watching(t($0)) }
        let loved = (11...16).map { t($0) }
        let seeds = Personal.seeds(watched: watched, loved: loved)
        #expect(seeds.map(\.title.dbId) == [1, 2, 3, 4, 11, 12, 13])
        #expect(seeds.prefix(4).allSatisfy { $0.verb == "watched" })
        #expect(seeds.dropFirst(4).allSatisfy { $0.verb == "liked" })
        #expect(seeds[0].weight > seeds[3].weight, "recent watches count more")
    }

    @Test func lovedTitleAlreadyWatchedIsNotSeededTwice() {
        let a = t(1)
        let seeds = Personal.seeds(watched: [watching(a)], loved: [a, t(2)])
        #expect(seeds.map(\.title.dbId) == [1, 2])
    }

    @Test func becauseRowsNameTheSeed() {
        let seed = t(1)
        let rows = Personal.assemble(watched: [watching(seed)], loved: [], recommendations: [seed.id: range(100...110)],
                                     exclude: [seed.id], name: "Sam")
        #expect(rows.because.count == 1)
        #expect(rows.because[0].title == "Because you watched Title 1")
        #expect(rows.topPicks?.title == "Top Picks for Sam")
    }

    @Test func becauseRowNeedsFiveTitles() {
        let seed = t(1)
        let rows = Personal.assemble(watched: [watching(seed)], loved: [], recommendations: [seed.id: range(100...103)], exclude: [], name: nil)
        #expect(rows.because.isEmpty)
        #expect(rows.topPicks == nil, "fewer than 5 picks: no Top Picks row")
    }

    @Test func excludedAndSeedTitlesNeverAppear() {
        let a = t(1), b = t(2, genre: "Comedy")
        var recsA = range(100...110); recsA.insert(b, at: 0); recsA.insert(a, at: 3)
        let rows = Personal.assemble(watched: [watching(a), watching(b)], loved: [],
                                     recommendations: [a.id: recsA, b.id: range(105...120)],
                                     exclude: [a.id, b.id, t(104).id], name: nil)
        let shown = (rows.topPicks?.items ?? []) + rows.because.flatMap(\.items)
        #expect(!shown.contains { [a.id, b.id, t(104).id].contains($0.id) })
    }

    @Test func titlesSharedBySeveralSeedsRankFirst() {
        let a = t(1), b = t(2, genre: "Comedy"), c = t(3, genre: "Horror")
        let shared = t(500)
        let rows = Personal.assemble(watched: [watching(a), watching(b), watching(c)], loved: [],
                                     recommendations: [a.id: range(100...110) + [shared], b.id: range(200...210) + [shared],
                                                       c.id: range(300...310) + [shared]],
                                     exclude: [], name: nil)
        #expect(rows.topPicks?.items.first?.id == shared.id)
    }

    @Test func atMostFourBecauseRowsWithDistinctFlavours() {
        let seeds = [t(1, genre: "Drama"), t(2, genre: "Drama"), t(3, genre: "Comedy"), t(4, genre: "Horror")]
        let loved = [t(5, genre: "Action"), t(6, genre: "Romance"), t(7, genre: "Sci-Fi")]
        var recs: [String: [Title]] = [:]
        for (i, seed) in (seeds + loved).enumerated() { recs[seed.id] = range((1000 + i * 50)...(1020 + i * 50)) }
        let rows = Personal.assemble(watched: seeds.map { watching($0) }, loved: loved, recommendations: recs, exclude: [], name: nil)
        #expect(rows.because.count == 4)
        #expect(!rows.because.contains { $0.title.contains("Title 2") }, "two English dramas share one row")
        #expect(Set(rows.because.map(\.id)).count == rows.because.count)
    }

    @Test func becauseRowsDontLeadWithTheSameTitles() {
        // Two different-looking seeds whose TMDB recommendations overlap a lot:
        // the second row shouldn't open with the same three posters.
        let a = t(1, genre: "Drama"), b = t(2, genre: "Comedy")
        let overlap = range(100...112)
        let rows = Personal.assemble(watched: [watching(a), watching(b)], loved: [],
                                     recommendations: [a.id: overlap, b.id: overlap.reversed().reversed() + range(200...203)],
                                     exclude: [], name: nil)
        #expect(rows.because.count == 2)
        let first = Set(rows.because[0].items.prefix(3).map(\.id))
        let second = Set(rows.because[1].items.prefix(3).map(\.id))
        #expect(first.isDisjoint(with: second))
        #expect(rows.because[1].items.count == overlap.count + 4, "titles move back, they aren't dropped")
    }

    @Test func topPicksMixLanguages() {
        let a = t(1, lang: "ko", genre: "Drama"), b = t(2, lang: "en", genre: "Comedy")
        let korean = range(100...120, lang: "ko")
        let english = range(200...210)
        let rows = Personal.assemble(watched: [watching(a), watching(b)], loved: [],
                                     recommendations: [a.id: korean, b.id: english], exclude: [], name: nil)
        let top = rows.topPicks?.items.prefix(12) ?? []
        #expect(top.filter { $0.originalLanguage == "en" }.count >= 4, "English titles get a fair share of the first 12")
        #expect((rows.topPicks?.items.count ?? 0) <= 24)
    }

    @Test func picksHaveNoDuplicates() {
        let a = t(1), b = t(2, genre: "Comedy")
        let rows = Personal.assemble(watched: [watching(a), watching(b)], loved: [],
                                     recommendations: [a.id: range(100...130), b.id: range(110...140)], exclude: [], name: nil)
        let ids = rows.topPicks?.items.map(\.id) ?? []
        #expect(Set(ids).count == ids.count)
        #expect(ids.count == 24)
    }
}

// Up Next counts down 10 real seconds, however often the player polls.
@Suite struct UpNextCountdownTests {
    @Test(arguments: [0.25, 0.4, 1.0])
    func countsRealSeconds(_ pollEvery: Double) {
        var countdown = UpNextCountdown()
        let start = Date()
        var finishedAt: Double?
        var shown: [Int] = []
        for step in 0..<200 {
            let now = start.addingTimeInterval(Double(step) * pollEvery)
            let value = countdown.tick(now: now)
            if shown.last != value { shown.append(value) }
            if value == 0 { finishedAt = Double(step) * pollEvery; break }
        }
        #expect(shown.first == 10)
        #expect(shown == Array((0...10).reversed()), "every number shows once, in order")
        let total = try! #require(finishedAt)
        #expect(total >= 9.9 && total <= 11, "took \(total)s")
    }

    @Test func cancelStops() {
        var countdown = UpNextCountdown()
        _ = countdown.tick(now: Date())
        countdown.cancel()
        #expect(countdown.isCancelled)
        #expect(countdown.tick(now: Date().addingTimeInterval(30)) == -1)
        countdown.reset()
        #expect(!countdown.isCancelled)
        #expect(countdown.tick(now: Date()) == 10)
    }
}

@Suite struct NextEpisodeTests {
    private func seasons(_ counts: [(Int, Int?)]) -> [TMDBDetails.Season] {
        counts.map { TMDBDetails.Season(seasonNumber: $0.0, name: nil, episodeCount: $0.1) }
    }

    @Test func withinSeason() {
        #expect(EpisodeOrder.next(season: 1, episode: 3, seasons: seasons([(1, 10), (2, 8)]))! == (1, 4))
    }

    @Test func seasonFinaleGoesToNextSeason() {
        #expect(EpisodeOrder.next(season: 1, episode: 10, seasons: seasons([(1, 10), (2, 8)]))! == (2, 1))
    }

    @Test func seriesFinaleHasNoNext() {
        #expect(EpisodeOrder.next(season: 2, episode: 8, seasons: seasons([(1, 10), (2, 8)])) == nil)
    }

    @Test func announcedSeasonWithNoEpisodesIsSkipped() {
        #expect(EpisodeOrder.next(season: 2, episode: 8, seasons: seasons([(1, 10), (2, 8), (3, 0)])) == nil)
        #expect(EpisodeOrder.next(season: 2, episode: 8, seasons: seasons([(1, 10), (2, 8), (3, nil)])) == nil)
    }

    @Test func unknownSeasonsMeansNoNext() {
        #expect(EpisodeOrder.next(season: 1, episode: 1, seasons: []) == nil)
    }
}
