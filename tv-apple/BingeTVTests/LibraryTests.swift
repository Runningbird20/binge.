import Foundation
import Testing
@testable import BingeTV

// Episode marking, Surprise me, recent searches, the saved Home, release
// reminders and person pages: the rules shared with the website.
@Suite(.serialized) @MainActor struct LibraryTests {
    private func title(_ id: Int, _ kind: MediaKind = .movie, soon: Bool = false) -> Title {
        var t = Title(kind: kind, dbId: id, name: "T\(id)", year: 2020, overview: nil, genre: nil, ageRating: nil)
        t.comingSoon = soon
        return t
    }

    private func seasons(_ counts: [Int]) -> [TMDBDetails.Season] {
        counts.enumerated().map { TMDBDetails.Season(seasonNumber: $0.offset + 1, name: nil, episodeCount: $0.element) }
    }

    private func key(_ s: Int, _ e: Int) -> EpisodeKey { EpisodeKey(season: s, episode: e) }

    @Test func watchedUpToHereCoversEarlierSeasons() {
        let marked = EpisodeMarking.upTo(key(2, 3), seasons: seasons([4, 10]), lastAired: key(2, 8))
        #expect(marked.count == 7)
        #expect(marked.first == key(1, 1))
        #expect(marked.last == key(2, 3))
    }

    @Test func unairedEpisodesAreNotMarked() {
        // Season 3 has 8 episodes listed but only 2 have aired.
        let marked = EpisodeMarking.upTo(key(3, 2), seasons: seasons([2, 2, 8]), lastAired: key(3, 2))
        #expect(marked == [key(1, 1), key(1, 2), key(2, 1), key(2, 2), key(3, 1), key(3, 2)])
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let json = #"{"episodes":[{"id":1,"episode_number":1,"season_number":3},{"id":2,"episode_number":2,"season_number":3},{"id":3,"episode_number":3,"season_number":3}]}"#
        let season = try! decoder.decode(TMDBSeason.self, from: Data(json.utf8))
        #expect(EpisodeMarking.season(3, episodes: season.episodes, lastAired: key(3, 2)) == [key(3, 1), key(3, 2)])
    }

    @Test func resumeMovesToTheNextAiredEpisode() {
        let list = seasons([3, 5])
        #expect(EpisodeMarking.next(after: [key(1, 1), key(1, 2)], seasons: list, lastAired: key(2, 5)) == key(1, 3))
        #expect(EpisodeMarking.next(after: [key(1, 3)], seasons: list, lastAired: key(2, 5)) == key(2, 1))
        // Caught up with everything that's aired: nowhere to move.
        #expect(EpisodeMarking.next(after: [key(2, 2)], seasons: list, lastAired: key(2, 2)) == nil)
    }

    @Test func surprisePicksOnlyWatchableTitlesOfTheType() {
        var personal = Personal.Rows()
        personal.topPicks = LoadedRow(id: "top", title: "", items: [title(1), title(2, .tvShow), title(3, soon: true), title(4)])
        personal.because = [LoadedRow(id: "b", title: "", items: [title(5), title(1)])]
        let pool = Surprise.pool(personal, fallback: [title(9)], kind: .movie, exclude: ["movie:4"])
        #expect(pool.map(\.dbId) == [1, 5])
        // No history: trending.
        #expect(Surprise.pool(Personal.Rows(), fallback: [title(9), title(8, .tvShow)], kind: .movie, exclude: []).map(\.dbId) == [9])
        // The last surprises are skipped while there's anything else.
        #expect(Surprise.pick(pool, recent: ["movie:1"], random: { 0 })?.dbId == 5)
        #expect(Surprise.pick([title(1)], recent: ["movie:1"], random: { 0 })?.dbId == 1)
        #expect(Surprise.pick([], recent: []) == nil)
    }

    @Test func recentSearchesPerProfile() {
        let profile = "test-\(UUID().uuidString)"
        defer { RecentSearches.clear(profile) }
        RecentSearches.add("dune", profile: profile)
        RecentSearches.add("Severance", profile: profile)
        RecentSearches.add("Dune", profile: profile)
        RecentSearches.add("x", profile: profile) // too short
        #expect(RecentSearches.list(profile) == ["Dune", "Severance"])
        #expect(RecentSearches.list("someone-else").contains("Severance") == false)
        for n in 0..<12 { RecentSearches.add("query \(n)", profile: profile) }
        #expect(RecentSearches.list(profile).count == RecentSearches.limit)
    }

    @Test func homeSnapshotRoundTripAndExpiry() {
        let profile = "test-\(UUID().uuidString)"
        var personal = Personal.Rows()
        personal.topPicks = LoadedRow(id: "top", title: "Top Picks", items: [title(1)])
        let item = ContinueItem(title: title(2, .tvShow), season: 1, episode: 3, position: 120, duration: 2400)
        HomeSnapshot(continueItems: [item], myList: [title(3)], personal: personal, shared: [], rows: [
            LoadedRow(id: "trending", title: "Trending", items: [title(4)]),
        ]).save(profile)
        let back = HomeSnapshot.read(profile)
        #expect(back?.continueItems.first?.episode == 3)
        #expect(back?.personal.topPicks?.items.first?.dbId == 1)
        #expect(back?.rows.first?.title == "Trending")
        #expect(HomeSnapshot.read(profile, now: Date().addingTimeInterval(HomeSnapshot.maxAge + 60)) == nil)
    }

    @Test func watchedTitlesLeaveRows() {
        let rows = [LoadedRow(id: "a", title: "A", items: [title(1), title(2)]), LoadedRow(id: "b", title: "B", items: [title(3)])]
        let kept = WatchedTitles.without(rows, ["movie:1", "movie:3"])
        #expect(kept.map(\.id) == ["a"])
        #expect(kept.first?.items.map(\.dbId) == [2])
    }

    @Test func remindersOnlyForWhatsComing() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let future = formatter.string(from: Date().addingTimeInterval(10 * 86_400))
        let past = formatter.string(from: Date().addingTimeInterval(-10 * 86_400))
        let movie = try decoder.decode(TMDBDetails.self, from: Data(#"{"id":1,"release_date":"\#(future)"}"#.utf8))
        let out = try decoder.decode(TMDBDetails.self, from: Data(#"{"id":1,"release_date":"\#(past)"}"#.utf8))
        let show = try decoder.decode(TMDBDetails.self, from: Data(#"{"id":2,"next_episode_to_air":{"air_date":"\#(future)","season_number":2,"episode_number":4}}"#.utf8))
        let upcoming = ReleaseReminder.upcoming(title(1), details: movie)
        #expect(upcoming?.label == "Remind me when it's out")
        #expect(upcoming.map { Calendar.current.component(.hour, from: $0.at) } == 9)
        #expect(ReleaseReminder.upcoming(title(1), details: out) == nil)
        #expect(ReleaseReminder.upcoming(title(2, .tvShow), details: show)?.label == "Remind me about S2:E4")
    }

    @Test func castRowPutsDirectorsFirst() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let json = #"""
        {"id":1,"credits":{"cast":[{"id":2,"name":"B","character":"Hero / Narrator","order":1},{"id":3,"name":"A","character":"Lead","order":0},{"id":9,"name":"Dir","order":5}],
         "crew":[{"id":9,"name":"Dir","job":"Director"},{"id":8,"name":"Writer","job":"Screenplay"}]}}
        """#
        let details = try decoder.decode(TMDBDetails.self, from: Data(json.utf8))
        let people = People.forTitle(details, kind: .movie)
        #expect(people.map(\.name) == ["Dir", "A", "B"])
        #expect(people.first?.role == "Director")
        #expect(people.last?.role == "Hero")
    }

    @Test func lifeLines() {
        #expect(People.lifeLine(born: "1934-01-02", died: "2020-03-04", place: nil) == "1934 – 2020")
        #expect(People.lifeLine(born: nil, died: nil, place: "Seoul") == "Born in Seoul")
        #expect(People.lifeLine(born: "1980-05-01", died: nil, place: "Paris")?.hasSuffix("in Paris") == true)
        #expect(People.department("Acting") == "Actor")
    }
}
