import Foundation

// The seasonal row on the Movies and Series tabs: what's relevant this time
// of year (horror in October, Christmas after Thanksgiving, romance before
// Valentine's Day…), picked from today's date so the row and its title
// change by themselves. Same calendar as the website's src/utils/seasonal.js
// and Fire TV's data/Seasonal.kt — keep the three in sync.
enum Seasonal {
    struct Season {
        let id: String
        let window: (Int) -> (Date, Date)          // year → first and last day, inclusive
        let title: (Date, MediaKind) -> String
        var movie: [String: String]? = nil
        var tv: [String: String]? = nil
        var kids: [String: String]? = nil
    }

    struct Pick: Equatable {
        let id: String
        let title: String
        let params: [String: String]
    }

    private static var calendar: Calendar { Calendar(identifier: .gregorian) }

    static func day(_ year: Int, _ month: Int, _ day: Int) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day))!
    }

    private static func add(_ date: Date, _ days: Int) -> Date { calendar.date(byAdding: .day, value: days, to: date)! }
    private static func same(_ a: Date, _ b: Date) -> Bool { calendar.isDate(a, inSameDayAs: b) }
    private static func parts(_ date: Date) -> (year: Int, month: Int, day: Int) {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return (c.year!, c.month!, c.day!)
    }

    // The nth `weekday` (1 = Sunday, as Calendar counts) of a month; n = -1 is the last one.
    static func nthWeekday(_ year: Int, _ month: Int, weekday: Int, _ n: Int) -> Date {
        if n > 0 {
            let first = calendar.component(.weekday, from: day(year, month, 1))
            return day(year, month, 1 + (weekday - first + 7) % 7 + (n - 1) * 7)
        }
        let last = add(day(year, month + 1, 1), -1)
        let lastWeekday = calendar.component(.weekday, from: last)
        return add(last, -((lastWeekday - weekday + 7) % 7))
    }

    // Western Easter Sunday (anonymous Gregorian algorithm).
    static func easter(_ year: Int) -> Date {
        let a = year % 19, b = year / 100, c = year % 100, d = b / 4, e = b % 4
        let f = (b + 8) / 25, g = (b - f + 1) / 3, h = (19 * a + b - d - g + 15) % 30
        let i = c / 4, k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451
        let n = h + l - 7 * m + 114
        return day(year, n / 31, n % 31 + 1)
    }

    static func thanksgiving(_ year: Int) -> Date { nthWeekday(year, 11, weekday: 5, 4) }
    static func memorialDay(_ year: Int) -> Date { nthWeekday(year, 5, weekday: 2, -1) }

    private static func any(_ ids: String...) -> String { ids.joined(separator: "|") }

    // TMDB keyword ids, checked against TMDB (2026-10-31).
    private static let spookyTV = ["with_keywords": any("3335", "3358", "12377", "3133", "12564", "616"), "without_genres": "10762,10766", "vote_count.gte": "100"]
    private static let spookyKids = ["with_keywords": any("3335", "3358", "616", "162846")]
    private static let christmas = any("207317", "1991")
    private static let blackHistory = any("4098", "270891", "256015", "190675")
    private static let sports = any("6075", "6496", "579", "1480")
    private static let snow = any("10794", "1442")
    private static let summer = any("13088", "14714", "966")

    // In priority order: the first season holding today (with a query for
    // the tab's type) wins, so short holidays sit above the seasons around them.
    static let seasons: [Season] = [
        Season(id: "halloween-night", window: { y in (day(y, 10, 25), day(y, 10, 31)) },
               title: { date, _ in parts(date).day == 31 ? "Happy Halloween" : "Halloween Week" },
               movie: ["with_keywords": "3335", "vote_count.gte": "100"], tv: spookyTV, kids: spookyKids),
        Season(id: "spooky-season", window: { y in (day(y, 10, 1), day(y, 10, 24)) },
               title: { _, _ in "Spooky Season" },
               movie: ["with_genres": "27", "vote_count.gte": "500"], tv: spookyTV, kids: spookyKids),
        Season(id: "thanksgiving", window: { y in (day(y, 11, 1), thanksgiving(y)) },
               title: { date, kind in
                   let tg = thanksgiving(parts(date).year)
                   if same(date, tg) { return "Happy Thanksgiving" }
                   if kind == .tvShow { return "Comfort TV for Thanksgiving" }
                   return add(tg, -6) <= date ? "Thanksgiving Week" : "Thanksgiving Movies"
               },
               movie: ["with_keywords": "4543", "vote_count.gte": "30"],
               tv: ["with_genres": "35", "without_genres": "16,10762,10764", "vote_count.gte": "500"],
               kids: ["with_keywords": "4543"]),
        Season(id: "christmas", window: { y in (add(thanksgiving(y), 1), day(y, 12, 25)) },
               title: { date, kind in
                   let p = parts(date)
                   if p.month == 11 { return "The Holidays Start Now" }
                   if p.day >= 24 { return "Merry Christmas" }
                   if p.day >= 18 { return "Countdown to Christmas" }
                   return kind == .tvShow ? "Christmas Shows" : "Christmas Movies"
               },
               movie: ["with_keywords": christmas, "without_genres": "27", "vote_count.gte": "100"],
               tv: ["with_keywords": christmas, "vote_count.gte": "10"],
               kids: ["with_keywords": christmas]),
        Season(id: "new-year", window: { y in (day(y, 12, 26), day(y + 1, 1, 1)) },
               title: { date, kind in
                   if parts(date).month == 1 { return "Happy New Year" }
                   return kind == .tvShow ? "Binge a Limited Series" : "Ring In the New Year"
               },
               movie: ["with_keywords": "613", "vote_count.gte": "50"],
               tv: ["with_type": "2", "sort_by": "vote_average.desc", "vote_count.gte": "500"]),
        Season(id: "valentines", window: { y in (day(y, 2, 1), day(y, 2, 14)) },
               title: { date, _ in parts(date).day >= 11 ? "Date Night for Valentine's" : "Valentine's Day Romance" },
               movie: ["with_genres": "10749", "vote_count.gte": "500"],
               tv: ["with_keywords": "9840", "with_genres": "18|35", "vote_count.gte": "100"]),
        Season(id: "black-history-month", window: { y in (day(y, 2, 15), add(day(y, 3, 1), -1)) },
               title: { _, _ in "Celebrating Black History Month" },
               movie: ["with_keywords": blackHistory, "vote_count.gte": "200"],
               tv: ["with_keywords": blackHistory, "vote_count.gte": "10"]),
        Season(id: "winter", window: { y in (day(y, 1, 2), day(y, 1, 31)) },
               title: { _, _ in "Snowed In" },
               movie: ["with_keywords": snow, "vote_count.gte": "300"],
               tv: ["with_keywords": snow, "vote_count.gte": "20"],
               kids: ["with_keywords": snow]),
        Season(id: "easter", window: { y in (add(easter(y), -7), easter(y)) },
               title: { date, _ in same(date, easter(parts(date).year)) ? "Happy Easter" : "Easter Favorites" },
               movie: ["with_keywords": any("9921", "9923"), "vote_count.gte": "20"],
               kids: ["with_keywords": any("9921", "9923")]),
        Season(id: "may-the-4th", window: { y in (day(y, 4, 28), day(y, 5, 4)) },
               title: { _, _ in "May the 4th Be With You" },
               movie: ["with_companies": "1", "vote_count.gte": "500"],
               tv: ["with_companies": "1", "vote_count.gte": "20"]),
        Season(id: "mothers-day", window: { y in (add(nthWeekday(y, 5, weekday: 1, 2), -6), nthWeekday(y, 5, weekday: 1, 2)) },
               title: { _, _ in "Mother's Day Movies" },
               movie: ["with_keywords": "240315", "without_genres": "27,28,53,878", "vote_count.gte": "300"]),
        Season(id: "fathers-day", window: { y in (add(nthWeekday(y, 6, weekday: 1, 3), -6), nthWeekday(y, 6, weekday: 1, 3)) },
               title: { _, _ in "Father's Day Movies" },
               movie: ["with_keywords": any("240119", "240303"), "without_genres": "27,53", "vote_count.gte": "500"]),
        Season(id: "fourth-of-july", window: { y in (day(y, 6, 28), day(y, 7, 4)) },
               title: { _, _ in "Fourth of July Movies" },
               movie: ["with_keywords": any("159743", "235503"), "vote_count.gte": "50"]),
        Season(id: "shark-week", window: { y in (day(y, 7, 20), day(y, 7, 31)) },
               title: { _, _ in "Shark Week" },
               movie: ["with_keywords": "15097", "vote_count.gte": "100"],
               tv: ["with_keywords": "15097", "vote_count.gte": "1"],
               kids: ["with_keywords": "15097"]),
        Season(id: "pride", window: { y in (day(y, 6, 1), day(y, 6, 30)) },
               title: { _, _ in "Pride Month" },
               movie: ["with_keywords": any("158718", "156501"), "vote_count.gte": "500"],
               tv: ["with_keywords": "158718", "vote_count.gte": "20"]),
        Season(id: "march-madness", window: { y in (day(y, 3, 1), day(y, 4, 7)) },
               title: { _, _ in "March Madness" },
               movie: ["with_keywords": sports, "vote_count.gte": "300"],
               tv: ["with_keywords": sports, "vote_count.gte": "20"],
               kids: ["with_keywords": sports]),
        Season(id: "spring", window: { y in (day(y, 4, 8), add(memorialDay(y), -1)) },
               title: { _, kind in kind == .tvShow ? "Feel-Good Comedies for Spring" : "Spring Break Road Trips" },
               movie: ["with_keywords": any("7312", "158054"), "vote_count.gte": "500"],
               tv: ["with_genres": "35", "without_genres": "16,10762,10764", "vote_count.gte": "300"],
               kids: ["with_keywords": "7312"]),
        Season(id: "summer", window: { y in (memorialDay(y), day(y, 8, 14)) },
               title: { _, kind in kind == .tvShow ? "Summer Binge" : "Summer Blockbusters" },
               movie: ["with_genres": "28|12", "vote_count.gte": "3000"],
               tv: ["with_keywords": summer, "vote_count.gte": "20"],
               kids: ["with_keywords": summer]),
        Season(id: "back-to-school", window: { y in (day(y, 8, 15), day(y, 9, 7)) },
               title: { _, _ in "Back to School" },
               movie: ["with_keywords": any("6270", "187282", "3616"), "without_genres": "27", "vote_count.gte": "500"],
               tv: ["with_keywords": any("6270", "3616"), "vote_count.gte": "50"],
               kids: ["with_keywords": any("6270", "187282")]),
        Season(id: "fall", window: { y in (day(y, 9, 8), day(y, 9, 30)) },
               title: { _, _ in "Cozy Fall Mysteries" },
               movie: ["with_genres": "9648", "vote_count.gte": "1000"],
               tv: ["with_genres": "9648", "vote_count.gte": "200"]),
    ]

    static func pick(_ kind: MediaKind, kids: Bool = false, on date: Date = Date()) -> Pick? {
        let today = calendar.startOfDay(for: date)
        let year = parts(today).year
        for season in seasons {
            // A window can cross New Year (Dec 26 – Jan 1), so last year's counts too.
            let holds = [year, year - 1].contains { y in
                let (first, last) = season.window(y)
                return first <= today && today <= last
            }
            guard holds, let params = kids ? season.kids : (kind == .movie ? season.movie : season.tv) else { continue }
            return Pick(id: season.id, title: season.title(today, kind), params: params)
        }
        return nil
    }

    // What a profile watches, as the website's taste summary: genres ranked
    // (top 8) and each language's share of their history.
    struct Taste: Equatable {
        var genres: [String] = []
        var languageShare: [String: Double] = [:]

        // Recent titles count more (history arrives newest first).
        init(history: [Title]) {
            var genreScore: [String: Double] = [:]
            var languageScore: [String: Double] = [:]
            var total = 0.0
            for (index, title) in history.prefix(40).enumerated() {
                let weight = max(0.25, pow(0.9, Double(index)))
                total += weight
                for genre in (title.genre ?? "").split(separator: ",") {
                    let name = genre.trimmingCharacters(in: .whitespaces).lowercased()
                    if !name.isEmpty { genreScore[name, default: 0] += weight }
                }
                if let language = title.originalLanguage, !language.isEmpty { languageScore[language, default: 0] += weight }
            }
            genres = genreScore.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }.prefix(8).map(\.key)
            if total > 0 { languageShare = languageScore.mapValues { $0 / total } }
        }

        init(genres: [String], languageShare: [String: Double]) {
            self.genres = genres.map { $0.lowercased() }
            self.languageShare = languageShare
        }

        var isEmpty: Bool { genres.isEmpty && languageShare.isEmpty }
    }

    // The seasonal row in the profile's taste order: a title in a genre or
    // language they watch moves up; popularity (TMDB's order) breaks ties.
    // Same scoring as the website's sortForTaste.
    static func sorted(_ items: [Title], for taste: Taste) -> [Title] {
        guard !items.isEmpty, !taste.isEmpty else { return items }
        let weight = Dictionary(uniqueKeysWithValues: taste.genres.enumerated().map { ($1, 1 - Double($0) / Double(taste.genres.count)) })
        let scored = items.enumerated().map { index, title -> (Title, Double) in
            let match = (title.genre ?? "").split(separator: ",")
                .map { weight[$0.trimmingCharacters(in: .whitespaces).lowercased()] ?? 0 }.max() ?? 0
            let language = title.originalLanguage ?? "en"
            let languageBonus = language == "en" ? 0 : taste.languageShare[language] ?? 0
            let popularity = 1 - Double(index) / Double(items.count)
            return (title, match + languageBonus + popularity * 0.75)
        }
        return scored.enumerated().sorted { $0.element.1 == $1.element.1 ? $0.offset < $1.offset : $0.element.1 > $1.element.1 }.map(\.element.0)
    }

    // The tab's row: TMDB discover with the season's query, released titles
    // only (the catalog match drops anything outside the release window too).
    static func row(_ kind: MediaKind, kids: Bool, on date: Date = Date()) -> RowSpec? {
        guard let pick = pick(kind, kids: kids, on: date) else { return nil }
        var params = ["sort_by": "popularity.desc", "include_adult": "false"]
        if kids {
            params.merge(kind == .movie
                ? ["with_genres": "10751|16", "certification_country": "US", "certification.lte": "PG", "vote_count.gte": "30"]
                : ["with_genres": "10762|10751", "vote_count.gte": "1"]) { $1 }
        }
        params.merge(pick.params) { $1 }
        return RowSpec(id: "seasonal-\(pick.id)", title: pick.title, kind: kind, path: "discover/\(kind.tmdbPath)", params: params)
    }
}
