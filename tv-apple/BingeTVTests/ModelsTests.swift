import Foundation
import Testing
@testable import BingeTV

// Titles, catalog rows, Continue Watching items, deep links and the TMDB
// image helpers: the small pieces every screen is built from.

private func title(_ kind: MediaKind = .movie, id: Int = 1, name: String = "T", rating: String? = nil,
                   language: String? = nil, genre: String? = nil, tmdb: Int? = 1) -> Title {
    var t = Title(kind: kind, dbId: id, name: name, year: 2020, overview: nil, genre: genre, ageRating: rating)
    t.tmdbId = tmdb
    t.originalLanguage = language
    return t
}

@Suite struct MediaKindTests {
    @Test func movieMapping() {
        #expect(MediaKind.movie.table == "movies")
        #expect(MediaKind.movie.tmdbPath == "movie")
        #expect(MediaKind.movie.sitePath == "movie")
        #expect(MediaKind.movie.rawValue == "movie")
    }

    @Test func showMapping() {
        #expect(MediaKind.tvShow.table == "tv_shows")
        #expect(MediaKind.tvShow.tmdbPath == "tv")
        #expect(MediaKind.tvShow.sitePath == "tv-show")
        #expect(MediaKind.tvShow.rawValue == "tv_show")
        #expect(MediaKind(rawValue: "tv") == nil)
    }
}

@Suite struct TitleTests {
    @Test func idCombinesKindAndRow() {
        #expect(title(.movie, id: 42).id == "movie:42")
        #expect(title(.tvShow, id: 42).id == "tv_show:42")
        #expect(title(.movie, id: 42).id != title(.tvShow, id: 42).id)
    }

    private func query(_ url: URL) -> [String: String] {
        Dictionary((URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") },
                   uniquingKeysWith: { a, _ in a })
    }

    @Test func movieWatchURL() {
        let url = title(.movie, id: 550).watchURL()
        #expect(url.path.hasSuffix("/movie/550"))
        #expect(query(url) == ["play": "1"])
    }

    @Test func movieIgnoresEpisode() {
        let url = title(.movie, id: 550).watchURL(season: 2, episode: 3)
        #expect(query(url) == ["play": "1"])
    }

    @Test func showWatchURL() {
        let url = title(.tvShow, id: 7).watchURL(season: 2, episode: 5)
        #expect(url.path.hasSuffix("/tv-show/7"))
        #expect(query(url) == ["play": "1", "season": "2", "episode": "5"])
    }

    @Test func showWithoutEpisodeHasNoSeason() {
        #expect(query(title(.tvShow, id: 7).watchURL(season: 2)) == ["play": "1"])
    }

    @Test(arguments: [(nil, nil), (0.0, nil), (30.0, nil), (30.9, "30"), (31.0, "31"), (3725.8, "3725")] as [(Double?, String?)])
    func resumeSecondsOnlyAfter30(_ seconds: Double?, _ expected: String?) {
        #expect(query(title().watchURL(seconds: seconds))["t"] == expected)
    }

    @Test func watchURLUsesSiteHost() {
        #expect(title().watchURL().host == Config.siteURL.host)
    }
}

@Suite struct CatalogRowTests {
    private func row(_ key: String?, poster: String? = nil) -> CatalogRow {
        let json: [String: Any?] = ["id": 9, "title": "Name", "year": 2001, "genre": "Drama", "overview": "o",
                                    "poster_url": poster, "source_key": key, "age_rating": "PG", "original_language": "ko"]
        let data = try! JSONSerialization.data(withJSONObject: json.compactMapValues { $0 })
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try! decoder.decode(CatalogRow.self, from: data)
    }

    @Test(arguments: [("tmdb:movie:550", 550), ("tmdb:tv:1399", 1399), ("plex:abc", nil), ("tmdb:movie:", nil), ("", nil)] as [(String, Int?)])
    func tmdbIdFromSourceKey(_ key: String, _ expected: Int?) {
        #expect(row(key).asTitle(.movie).tmdbId == expected)
    }

    @Test func missingSourceKey() {
        #expect(row(nil).asTitle(.movie).tmdbId == nil)
    }

    @Test func fieldsCarryOver() {
        let t = row("tmdb:tv:1", poster: "https://image.tmdb.org/t/p/w500/a.jpg").asTitle(.tvShow)
        #expect(t.kind == .tvShow)
        #expect(t.dbId == 9)
        #expect(t.name == "Name")
        #expect(t.year == 2001)
        #expect(t.ageRating == "PG")
        #expect(t.originalLanguage == "ko")
        #expect(t.poster?.absoluteString == "https://image.tmdb.org/t/p/w500/a.jpg")
        #expect(t.backdrop == nil)
        #expect(!t.comingSoon)
    }

    @Test func columnsMatchDecodedFields() {
        // Every column selected must exist in the struct (and vice versa),
        // or PostgREST rows silently decode with nils.
        let columns = Set(CatalogRow.columns.split(separator: ",").map(String.init))
        #expect(columns == ["id", "title", "year", "genre", "overview", "poster_url", "source_key", "age_rating", "original_language"])
    }
}

@Suite struct ContinueItemTests {
    private func item(_ kind: MediaKind = .tvShow, s: Int? = 1, e: Int? = 2, p: Double? = nil, d: Double? = nil) -> ContinueItem {
        ContinueItem(title: title(kind), season: s, episode: e, position: p, duration: d)
    }

    @Test(arguments: [(nil, nil, nil), (10, nil, nil), (nil, 100, nil), (10, 0, nil), (50, 100, 0.5),
                      (150, 100, 1.0), (-5, 100, 0.0), (0, 100, 0.0)] as [(Double?, Double?, Double?)])
    func progress(_ position: Double?, _ duration: Double?, _ expected: Double?) {
        #expect(item(p: position, d: duration).progress == expected)
    }

    @Test func episodeLabel() {
        #expect(item(s: 3, e: 12).episodeLabel == "S3:E12")
        #expect(item(s: nil, e: 2).episodeLabel == nil)
        #expect(item(s: 1, e: nil).episodeLabel == nil)
        #expect(item(.movie, s: 1, e: 1).episodeLabel == nil)
    }

    @Test func idIsTitleId() {
        #expect(item().id == "tv_show:1")
    }
}

@Suite struct ISODateTests {
    @Test(arguments: ["2026-10-27T12:30:00Z", "2026-10-27T12:30:00.123Z", "2026-10-27T12:30:00.123456+00:00", "2026-10-27T08:30:00-04:00"])
    func parsesSupabaseTimestamps(_ text: String) throws {
        let date = try #require(ISODate.parse(text))
        let utc = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "UTC")!, from: date)
        #expect(utc.hour == 12)
        #expect(utc.minute == 30)
    }

    @Test(arguments: ["", "yesterday", "2026-10-27", "27/10/2026 12:00"])
    func rejectsOthers(_ text: String) {
        #expect(ISODate.parse(text) == nil)
    }

    @Test func continueRowDate() throws {
        let data = Data(#"{"id":1,"media_type":"movie","media_id":2,"updated_at":"2026-01-02T03:04:05.678+00:00"}"#.utf8)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let row = try decoder.decode(ContinueRow.self, from: data)
        #expect(row.updatedDate != nil)
        #expect(row.currentSeason == nil)
        #expect(row.positionSeconds == nil)
    }
}

@Suite struct ReleaseWindowTests {
    private static func day(_ offset: Int) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Calendar.current.date(byAdding: .day, value: offset, to: Date())!)
    }

    @Test(arguments: [-3650, -365, -1, 0, 1, 15, 29, 30])
    func visibleWithin30Days(_ offset: Int) {
        #expect(ReleaseWindow.isVisible(Self.day(offset)))
    }

    @Test(arguments: [32, 60, 365])
    func hiddenAfter30Days(_ offset: Int) {
        #expect(!ReleaseWindow.isVisible(Self.day(offset)))
    }

    @Test(arguments: [1, 2, 29])
    func comingSoonBetweenTomorrowAnd30(_ offset: Int) {
        #expect(ReleaseWindow.isComingSoon(Self.day(offset)))
    }

    @Test(arguments: [-400, -1, 0, 32])
    func notComingSoon(_ offset: Int) {
        #expect(!ReleaseWindow.isComingSoon(Self.day(offset)))
    }

    @Test func unknownDateIsVisibleNotComingSoon() {
        for value in [nil, "", "TBA", "2026"] as [String?] {
            #expect(ReleaseWindow.isVisible(value))
            #expect(!ReleaseWindow.isComingSoon(value))
            #expect(!ReleaseWindow.isRecent(value, days: 14))
        }
    }

    @Test func acceptsTimestamps() {
        #expect(!ReleaseWindow.isVisible(Self.day(90) + "T00:00:00Z"))
        #expect(ReleaseWindow.isComingSoon(Self.day(5) + "T12:00:00.000Z"))
    }

    @Test func recent() {
        #expect(ReleaseWindow.isRecent(Self.day(-3), days: 14))
        #expect(ReleaseWindow.isRecent(Self.day(-13), days: 14))
        #expect(!ReleaseWindow.isRecent(Self.day(-20), days: 14))
        #expect(!ReleaseWindow.isRecent(Self.day(2), days: 14))
    }
}

@Suite struct KidsFilterTests {
    @Test(arguments: ["G", "PG", "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG", "pg", "tv-y7"])
    func allows(_ rating: String) { #expect(KidsFilter.allows(rating)) }

    @Test(arguments: ["PG-13", "R", "NC-17", "TV-14", "TV-MA", "NR", "Unrated", "", "18", "M"])
    func blocks(_ rating: String) { #expect(!KidsFilter.allows(rating)) }

    @Test func unknownIsBlocked() { #expect(!KidsFilter.allows(nil)) }

    @Test func surroundingSpaceStillMatches() {
        // Catalog imports occasionally carry stray whitespace.
        #expect(KidsFilter.allows(" PG "))
        #expect(KidsFilter.allows("TV-G\n"))
    }
}

@Suite struct AccountProfileTests {
    private func profile(_ avatar: String?) -> AccountProfile {
        let json: [String: Any] = ["id": "p", "name": "N", "is_kids": false, "is_default": true].merging(avatar.map { ["avatar_url": $0] } ?? [:]) { a, _ in a }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try! decoder.decode(AccountProfile.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test func siteRelativeAvatar() {
        let url = profile("/avatars/fox.png").avatarImageURL
        #expect(url?.host == Config.siteURL.host)
        #expect(url?.path == "/avatars/fox.png")
    }

    @Test func absoluteAvatar() {
        #expect(profile("https://cdn.example.com/a.png").avatarImageURL?.absoluteString == "https://cdn.example.com/a.png")
    }

    @Test func noAvatar() {
        #expect(profile(nil).avatarImageURL == nil)
        #expect(profile("").avatarImageURL == nil)
    }

    @Test func columnsNeverIncludePin() {
        #expect(!AccountProfile.columns.contains("pin"))
    }
}

@Suite struct DeepLinkTests {
    @Test func playEpisode() throws {
        let link = try #require(DeepLink(URL(string: "binge://play?kind=tv_show&id=58132&s=1&e=2&t=300")!))
        #expect(link.play)
        #expect(link.kind == .tvShow)
        #expect(link.id == 58132)
        #expect(link.season == 1)
        #expect(link.episode == 2)
        #expect(link.seconds == 300)
    }

    @Test func titlePage() throws {
        let link = try #require(DeepLink(URL(string: "binge://title?kind=movie&id=197851")!))
        #expect(!link.play)
        #expect(link.kind == .movie)
        #expect(link.season == nil)
        #expect(link.seconds == nil)
    }

    @Test(arguments: ["https://play?kind=movie&id=1", "binge://other?kind=movie&id=1", "binge://play?kind=tv&id=1",
                      "binge://play?kind=movie", "binge://play?id=1", "binge://play", "binge://play?kind=movie&id=abc"])
    func rejects(_ text: String) {
        #expect(DeepLink(URL(string: text)!) == nil)
    }
}

@Suite struct TMDBImageTests {
    @Test func image() {
        #expect(TMDB.image("/abc.jpg")?.absoluteString == "https://image.tmdb.org/t/p/w500/abc.jpg")
        #expect(TMDB.image("/abc.jpg", TMDB.poster)?.absoluteString == "https://image.tmdb.org/t/p/w780/abc.jpg")
        #expect(TMDB.image(nil) == nil)
        #expect(TMDB.image("") == nil)
    }

    @Test(arguments: ["w92", "w185", "w500", "w780", "w1280", "original"])
    func resizesAnySize(_ from: String) {
        let url = URL(string: "https://image.tmdb.org/t/p/\(from)/abc.jpg")
        #expect(TMDB.resized(url, TMDB.fullScreen)?.absoluteString == "https://image.tmdb.org/t/p/original/abc.jpg")
        #expect(TMDB.resized(url, TMDB.wide)?.absoluteString == "https://image.tmdb.org/t/p/w1280/abc.jpg")
    }

    @Test func leavesOtherHostsAlone() {
        let other = URL(string: "https://covers.openlibrary.org/b/id/1-L.jpg")
        #expect(TMDB.resized(other, TMDB.fullScreen) == other)
        #expect(TMDB.resized(nil, TMDB.wide) == nil)
    }

    @Test func detailsLogoPrefersEnglish() throws {
        let json = #"{"id":1,"images":{"logos":[{"file_path":"/ja.png","iso_639_1":"ja"},{"file_path":"/en.png","iso_639_1":"en"}]}}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let details = try decoder.decode(TMDBDetails.self, from: Data(json.utf8))
        #expect(details.logoPath == "/en.png")
        let only = try decoder.decode(TMDBDetails.self, from: Data(#"{"id":1,"images":{"logos":[{"file_path":"/x.png","iso_639_1":null}]}}"#.utf8))
        #expect(only.logoPath == "/x.png")
        let none = try decoder.decode(TMDBDetails.self, from: Data(#"{"id":1}"#.utf8))
        #expect(none.logoPath == nil)
    }

    @Test func itemDatePrefersRelease() {
        let a = TMDBItem(id: 1, title: nil, name: nil, overview: nil, posterPath: nil, backdropPath: nil, releaseDate: "2020-01-01",
                         firstAirDate: "2019-01-01", voteAverage: nil, mediaType: nil, genreIds: nil, knownFor: nil)
        #expect(a.date == "2020-01-01")
    }
}

@Suite struct TMDBListDecodingTests {
    @Test func listItemsCarryOriginalLanguage() throws {
        let json = #"{"results":[{"id":496243,"title":"Parasite","original_language":"ko","release_date":"2019-05-30","media_type":"movie"},{"id":1,"name":"X"}]}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let page = try decoder.decode(TMDBPage.self, from: Data(json.utf8))
        #expect(page.results[0].originalLanguage == "ko")
        #expect(page.results[1].originalLanguage == nil)
    }
}

@Suite struct ResumeRuleTests {
    @Test(arguments: [
        (nil, nil, nil), (0, 5400, nil), (30, 5400, nil), (31, 5400, 31), (2700, 5400, 2700), (5280, 5400, 5280),
        (5281, 5400, nil), (5399, 5400, nil), (6000, 5400, nil), (600, nil, 600), (600, 0, 600),
    ] as [(Double?, Double?, Double?)])
    func matchesTheWebsite(_ position: Double?, _ duration: Double?, _ expected: Double?) {
        #expect(ResumeRule.start(position: position, duration: duration) == expected)
    }

    @Test func continueCardsDontResumeIntoTheCredits() {
        var t = Title(kind: .movie, dbId: 1, name: "M", year: nil, overview: nil, genre: nil, ageRating: nil)
        t.tmdbId = 1
        #expect(ContinueItem(title: t, season: nil, episode: nil, position: 5350, duration: 5400).playRequest.startAt == nil)
        #expect(ContinueItem(title: t, season: nil, episode: nil, position: 1200, duration: 5400).playRequest.startAt == 1200)
    }
}

// The catalog is read from Neon through the site; everything else (and every
// write) stays on Supabase.
@Suite struct DatabaseSplitTests {
    @Test func catalogReadsGoToNeon() {
        for table in ["movies", "tv_shows", "books", "title_ratings", "subtitle_cache"] {
            #expect(Supabase.isMediaRead("GET", table: table))
        }
    }

    @Test func userDataAndWritesStayOnSupabase() {
        for table in ["watchlist", "continue_watching", "movie_ratings", "account_profiles", "profile_shares", "rpc/stream_report_summary"] {
            #expect(!Supabase.isMediaRead("GET", table: table))
        }
        #expect(!Supabase.isMediaRead("POST", table: "title_ratings"))
        #expect(!Supabase.isMediaRead("PATCH", table: "movies"))
    }
}

@Suite struct PinEntryTests {
    @Test func takesFourDigitsThenStops() {
        var entry = PinEntry()
        for digit in [1, 2, 3, 4, 5] { entry.type(digit) }
        #expect(entry.digits == "1234")
        #expect(entry.isComplete)
    }

    @Test func deleteAndClear() {
        var entry = PinEntry()
        entry.type(7); entry.type(0)
        entry.deleteLast()
        #expect(entry.digits == "7")
        entry.deleteLast(); entry.deleteLast()
        #expect(entry.digits.isEmpty)
        entry.type(9); entry.clear()
        #expect(entry.digits.isEmpty && !entry.isComplete)
    }

    @Test func ignoresNonDigits() {
        var entry = PinEntry()
        entry.type(10); entry.type(-1)
        #expect(entry.digits.isEmpty)
    }
}
