import Foundation

// A title's cast & crew (the Cast row) and a person's work (PersonView),
// from TMDB matched back to the catalog like the rows: the website's
// utils/people.js, same rules.
struct PersonRef: Hashable, Identifiable {
    let id: Int
    let name: String
}

struct CreditPerson: Identifiable, Hashable {
    let id: Int
    let name: String
    let role: String
    let photo: URL?
}

struct PersonPage {
    let name: String
    let photo: URL?
    let department: String?
    let lifeLine: String?
    let biography: String
    let rows: [LoadedRow]
}

private struct PersonDetails: Decodable {
    struct Credit: Decodable {
        let id: Int
        let mediaType: String?
        let title: String?
        let name: String?
        let character: String?
        let job: String?
        let episodeCount: Int?
        let voteCount: Int?
        let genreIds: [Int]?
        let posterPath: String?
        let backdropPath: String?
        let releaseDate: String?
        let firstAirDate: String?
        let originalLanguage: String?

        var item: TMDBItem {
            TMDBItem(id: id, title: title, name: name, overview: nil, posterPath: posterPath, backdropPath: backdropPath,
                     releaseDate: releaseDate, firstAirDate: firstAirDate, voteAverage: nil, mediaType: mediaType,
                     genreIds: genreIds, knownFor: nil, originalLanguage: originalLanguage)
        }
    }
    struct Credits: Decodable { let cast: [Credit]?; let crew: [Credit]? }

    let id: Int
    let name: String
    let biography: String?
    let birthday: String?
    let deathday: String?
    let placeOfBirth: String?
    let profilePath: String?
    let knownForDepartment: String?
    let combinedCredits: Credits?
}

enum People {
    // Directors (movies) or creators (series) first, then the top-billed
    // cast. Each person once.
    static func forTitle(_ details: TMDBDetails?, kind: MediaKind, castLimit: Int = 20) -> [CreditPerson] {
        guard let details else { return [] }
        let crew: [CreditPerson] = kind == .tvShow
            ? (details.createdBy ?? []).compactMap { person in
                person.id.map { CreditPerson(id: $0, name: person.name, role: "Creator", photo: TMDB.image(person.profilePath, "w185")) }
            }
            : (details.credits?.crew ?? []).filter { $0.job == "Director" }.compactMap { person in
                person.id.map { CreditPerson(id: $0, name: person.name, role: "Director", photo: TMDB.image(person.profilePath, "w185")) }
            }
        let cast = (details.credits?.cast ?? [])
            .sorted { ($0.order ?? 999) < ($1.order ?? 999) }
            .prefix(castLimit)
            .compactMap { person in
                person.id.map {
                    CreditPerson(id: $0, name: person.name,
                                 role: (person.character ?? "").components(separatedBy: " / ").first?.trimmingCharacters(in: .whitespaces) ?? "",
                                 photo: TMDB.image(person.profilePath, "w185"))
                }
            }
        var seen = Set<Int>()
        return (crew + cast).filter { !$0.name.isEmpty && seen.insert($0.id).inserted }
    }

    // Not real roles (guest spots as themselves, hosting, narration) and
    // unscripted shows (talk, news, reality) aren't someone's work.
    private static let nonRoles = try! NSRegularExpression(pattern: #"\b(self|himself|herself|themselves|host|narrator|presenter|guest)\b"#, options: .caseInsensitive)
    private static let unscripted: Set<Int> = [10767, 10763, 10764]

    // Acting: real scripted roles, series with 3+ episodes. Crew: directing
    // films and creating series. Most widely known first, each title once.
    fileprivate static func work(_ credits: PersonDetails.Credits?) -> (acting: [PersonDetails.Credit], directing: [PersonDetails.Credit]) {
        func keep(_ list: [PersonDetails.Credit]) -> [PersonDetails.Credit] {
            var seen = Set<String>()
            return list.filter { $0.mediaType == "movie" || $0.mediaType == "tv" }
                .sorted { ($0.voteCount ?? 0) > ($1.voteCount ?? 0) }
                .filter { seen.insert("\($0.mediaType ?? ""):\($0.id)").inserted }
        }
        let acting = keep((credits?.cast ?? []).filter { credit in
            let role = credit.character ?? ""
            let isRole = nonRoles.firstMatch(in: role, range: NSRange(role.startIndex..., in: role)) == nil
            let scripted = !(credit.genreIds ?? []).contains(where: unscripted.contains)
            return isRole && scripted && (credit.mediaType != "tv" || (credit.episodeCount ?? 0) >= 3)
        })
        let directing = keep((credits?.crew ?? []).filter { ($0.job == "Director" && $0.mediaType == "movie") || $0.job == "Creator" })
        return (acting, directing)
    }

    static func load(_ id: Int, maturity: Maturity) async -> PersonPage? {
        guard let data: PersonDetails = try? await TMDB.shared.get("person/\(id)", ["append_to_response": "combined_credits"]) else { return nil }
        let (acting, directing) = work(data.combinedCredits)
        func onBinge(_ credits: ArraySlice<PersonDetails.Credit>) async -> (movies: [Title], shows: [Title], all: [Title]) {
            let items = credits.map(\.item)
            async let movies = (try? Catalog.match(items.filter { $0.mediaType == "movie" }, kind: .movie, maturity: maturity)) ?? []
            async let shows = (try? Catalog.match(items.filter { $0.mediaType == "tv" }, kind: .tvShow, maturity: maturity)) ?? []
            let (m, s) = await (movies, shows)
            let rank = Dictionary(items.enumerated().map { ("\($0.element.mediaType == "tv" ? "tv_show" : "movie"):\($0.element.id)", $0.offset) },
                                  uniquingKeysWith: { a, _ in a })
            let all = (m + s).sorted { (rank["\($0.kind.rawValue):\($0.tmdbId ?? 0)"] ?? .max) < (rank["\($1.kind.rawValue):\($1.tmdbId ?? 0)"] ?? .max) }
            return (m, s, all)
        }
        async let actedTask = onBinge(acting.prefix(80))
        async let directedTask = onBinge(directing.prefix(40))
        let (acted, directed) = await (actedTask, directedTask)
        let madeTitle = !directed.movies.isEmpty && !directed.shows.isEmpty ? "Directed and created by \(data.name)"
            : !directed.shows.isEmpty ? "Created by \(data.name)" : "Directed by \(data.name)"
        let crewRow = LoadedRow(id: "directed", title: madeTitle, items: directed.all)
        let actingRows = [
            LoadedRow(id: "movies", title: "Movies with \(data.name)", items: acted.movies),
            LoadedRow(id: "series", title: "Series with \(data.name)", items: acted.shows),
        ]
        let directs = data.knownForDepartment == "Directing" || data.knownForDepartment == "Writing"
        let rows = (directs ? [crewRow] + actingRows : actingRows + [crewRow]).filter { !$0.items.isEmpty }
        return PersonPage(name: data.name, photo: TMDB.image(data.profilePath, "h632"),
                          department: department(data.knownForDepartment),
                          lifeLine: lifeLine(born: data.birthday, died: data.deathday, place: data.placeOfBirth),
                          biography: data.biography ?? "", rows: rows)
    }

    static func department(_ value: String?) -> String? {
        switch value {
        case "Acting": return "Actor"
        case "Directing": return "Director"
        case "Writing": return "Writer"
        case "Production": return "Producer"
        case .some(let other) where !other.isEmpty: return other
        default: return nil
        }
    }

    // "Born March 4, 1965 in New York City" / "1934 – 2020".
    static func lifeLine(born: String?, died: String?, place: String?) -> String? {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.dateFormat = "yyyy-MM-dd"
        let output = DateFormatter()
        output.dateStyle = .long
        let birth = born.flatMap { input.date(from: $0) }
        let death = died.flatMap { input.date(from: $0) }
        let year = { (date: Date) in String(Calendar.current.component(.year, from: date)) }
        if let birth, let death { return "\(year(birth)) – \(year(death))" + (place.map { " · Born in \($0)" } ?? "") }
        if let birth { return "Born \(output.string(from: birth))" + (place.map { " in \($0)" } ?? "") }
        return place.map { "Born in \($0)" }
    }
}
