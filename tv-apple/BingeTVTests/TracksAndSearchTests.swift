import Foundation
import Testing
@testable import BingeTV

// Picking the right audio dub / subtitle track out of what a server lists:
// servers use 2-letter codes, ISO 639-2 codes (both the "B" and "T"
// spellings), regions, bare labels, or nothing at all.
@MainActor @Suite struct TrackMatchingTests {
    private func track(_ language: String, _ label: String = "") -> MediaTrack {
        MediaTrack(index: 0, label: label, language: language, on: false)
    }

    @Test(arguments: [
        ("en", "en"), ("eng", "en"), ("en-US", "en"), ("EN", "en"), ("en-GB", "en"),
        ("ko", "ko"), ("kor", "ko"), ("ko-KR", "ko"),
        ("ja", "ja"), ("jpn", "ja"), ("ja-JP", "ja"),
        ("es", "es"), ("spa", "es"), ("es-419", "es"), ("es-MX", "es"),
        ("fr", "fr"), ("fra", "fr"), ("fre", "fr"), ("fr-CA", "fr"),
        ("de", "de"), ("deu", "de"), ("ger", "de"),
        ("pt", "pt"), ("por", "pt"), ("pt-BR", "pt"),
        ("hi", "hi"), ("hin", "hi"),
        ("ar", "ar"), ("ara", "ar"),
    ] as [(String, String)])
    func codeMatches(_ language: String, _ wanted: String) {
        #expect(PlayerModel.matches(track(language), wanted), "\(language) should match \(wanted)")
    }

    @Test(arguments: [
        ("est", "es"),  // Estonian is not Spanish
        ("jav", "ja"),  // Javanese is not Japanese
        ("arm", "ar"),  // Armenian is not Arabic
        ("kon", "ko"),  // Kongo is not Korean
        ("fin", "fi_"), // nonsense wanted code
        ("enm", "en"),  // Middle English
        ("hun", "hi"),
        ("ger", "ge"),
        ("de", "en"), ("ko", "ja"), ("pt", "es"), ("", "en"),
    ] as [(String, String)])
    func codeDoesNotMatch(_ language: String, _ wanted: String) {
        #expect(!PlayerModel.matches(track(language), wanted), "\(language) must not match \(wanted)")
    }

    @Test(arguments: [
        ("English", "en"), ("English [CC]", "en"), ("14. Korean", "ko"), ("Japanese (Original)", "ja"),
        ("Spanish (Latin America)", "es"), ("French - Forced", "fr"), ("Hindi Dub", "hi"),
    ] as [(String, String)])
    func labelMatchesWhenCodeIsMissing(_ label: String, _ wanted: String) {
        #expect(PlayerModel.matches(track("", label), wanted))
    }

    @Test func labelDoesNotOverrideAClearCode() {
        // "English" in the label of a Korean track ("Korean (English subs burned in)")
        // isn't English audio... but codes win only when they disagree clearly.
        #expect(PlayerModel.matches(track("ko", "Korean"), "ko"))
        #expect(!PlayerModel.matches(track("ko", "Korean"), "en"))
    }

    @Test func displayNames() {
        #expect(PlayerModel.displayName(MediaTrack(index: 3, label: "14. Korean", language: "ko", on: false)) == "Korean")
        #expect(PlayerModel.displayName(MediaTrack(index: 3, label: "", language: "fr", on: false)) == "French")
        #expect(PlayerModel.displayName(MediaTrack(index: 3, label: "", language: "fra", on: false)) == "French")
        #expect(PlayerModel.displayName(MediaTrack(index: 3, label: "", language: "", on: false)) == "Track 4")
        #expect(PlayerModel.displayName(MediaTrack(index: 0, label: "1. ", language: "", on: false)) == "Track 1")
    }

    @Test func everyPreferenceHasAName() {
        for (code, name) in PlaybackPrefs.audioChoices + PlaybackPrefs.subtitleChoices where code != "original" && code != "off" {
            #expect(PlaybackPrefs.languageName(code) == name, "\(code)")
        }
    }

    @Test func captionChoicesAreSane() {
        #expect(PlaybackPrefs.captionSizes.map(\.0) == PlaybackPrefs.captionSizes.map(\.0).sorted())
        #expect(PlaybackPrefs.captionBackgrounds.contains { $0.0 == PlaybackPrefs.captionBackground }, "default background is a choice")
    }
}

@Suite struct AskBingeTests {
    @Test(arguments: [
        "something like Severance but funnier", "show me a scary movie", "find me korean thrillers", "I want a comedy",
        "i'm in the mood for anime", "recommend a documentary", "what should i watch tonight", "give me 90s action",
        "movies about space", "funny shows for kids", "a long slow-burn mystery series", "play something relaxing",
    ])
    func conversational(_ query: String) {
        #expect(AskBinge.isConversational(query))
    }

    @Test(arguments: ["Breaking Bad", "the office", "Squid Game", "Up", "Dune Part Two", "Love Island"])
    func shortTitlesAreNotConversational(_ query: String) {
        #expect(!AskBinge.isConversational(query))
    }

    // Long titles read like sentences; when the search already found that
    // exact title, Ask binge. waits for the button instead of running.
    @Test(arguments: ["Spider-Man: Across the Spider-Verse", "Everything Everywhere All at Once", "Lord of the Rings",
                      "How I Met Your Mother", "the lord of the rings", "Spider-Man Across the Spider Verse"])
    func exactTitleHitDoesNotAutoAsk(_ query: String) {
        let names = ["Spider-Man: Across the Spider-Verse", "Everything Everywhere All at Once", "The Lord of the Rings",
                     "How I Met Your Mother"]
        let results = names.enumerated().map { Title(kind: .movie, dbId: $0.offset, name: $0.element, year: nil, overview: nil, genre: nil, ageRating: nil) }
        #expect(!AskBinge.shouldAutoAsk(query, results: results), "\(query)")
    }

    @Test func sentencesStillAutoAsk() {
        let results = [Title(kind: .movie, dbId: 1, name: "Severance", year: nil, overview: nil, genre: nil, ageRating: nil)]
        #expect(AskBinge.shouldAutoAsk("something like Severance but funnier", results: results))
        #expect(AskBinge.shouldAutoAsk("show me a scary movie", results: []))
        #expect(!AskBinge.shouldAutoAsk("Severance", results: results))
    }

    @Test func nothingFoundAsksBinge() {
        // TMDB doesn't forgive typos; Ask binge. does.
        #expect(AskBinge.shouldAutoAsk("Breking Bad", results: []))
        #expect(AskBinge.shouldAutoAsk("Stranger Thngs", results: []))
        #expect(!AskBinge.shouldAutoAsk("Up", results: []), "too short to guess at")
        #expect(!AskBinge.shouldAutoAsk("%%", results: []))
    }
}

@Suite struct FranchiseDataTests {
    @Test(arguments: Franchises.curated.map(\.name))
    func curatedListsAreConsistent(_ name: String) {
        let franchise = Franchises.curated.first { $0.name == name }!
        #expect(Set(franchise.release).count == franchise.release.count, "no repeats in release order")
        #expect(Set(franchise.story).count == franchise.story.count, "no repeats in story order")
        #expect(Set(franchise.release) == Set(franchise.story), "both orders hold the same films")
    }

    @Test func noFilmIsInTwoFranchises() {
        var seen = Set<Int>()
        for franchise in Franchises.curated {
            for id in franchise.release { #expect(seen.insert(id).inserted, "\(id) in two lists") }
        }
    }
}

@Suite struct RowSpecTests {
    private var all: [RowSpec] {
        Rows.home(kids: false) + Rows.home(kids: true) + Rows.browse(.movie, kids: false) + Rows.browse(.tvShow, kids: false)
            + Rows.browse(.movie, kids: true) + Rows.browse(.tvShow, kids: true)
    }

    @Test func idsAreUniquePerPage() {
        for page in [Rows.home(kids: false), Rows.home(kids: true), Rows.browse(.movie, kids: false), Rows.browse(.tvShow, kids: false)] {
            #expect(Set(page.map(\.id)).count == page.count)
            #expect(!page.isEmpty)
        }
    }

    @Test func kindMatchesPath() {
        for spec in all {
            let path = spec.path
            if path.contains("/movie") || path.hasPrefix("movie/") { #expect(spec.kind == .movie, "\(spec.id)") }
            if path.contains("/tv") || path.hasPrefix("tv/") { #expect(spec.kind == .tvShow, "\(spec.id)") }
        }
    }

    @Test func browsePagesOnlyHoldTheirKind() {
        #expect(Rows.browse(.movie, kids: false).allSatisfy { $0.kind == .movie })
        #expect(Rows.browse(.tvShow, kids: false).allSatisfy { $0.kind == .tvShow })
        #expect(Rows.browse(.movie, kids: true).allSatisfy { $0.kind == .movie })
        #expect(Rows.browse(.tvShow, kids: true).allSatisfy { $0.kind == .tvShow })
        #expect(!Rows.browse(.movie, kids: true).isEmpty)
        #expect(!Rows.browse(.tvShow, kids: true).isEmpty)
    }

    @Test func kidsRowsAreKidsContent() {
        for spec in Rows.home(kids: true) {
            let genres = spec.params["with_genres"] ?? ""
            let capped = spec.params["certification.lte"] == "PG"
            #expect(capped || genres.contains("10762") || genres.contains("10751"), "\(spec.id) isn't limited to kids")
        }
    }

    @Test func titlesAreNotEmpty() {
        for spec in all { #expect(!spec.title.isEmpty) }
    }

    @Test func hiddenGemsAreFeatureLength() {
        let gems = Rows.home(kids: false).first { $0.id == "gems" }
        #expect(Int(gems?.params["with_runtime.gte"] ?? "0") ?? 0 >= 60)
    }
}

@Suite struct SupabaseMessageTests {
    private func message(_ json: String, _ status: Int) -> String {
        Supabase.message(from: Data(json.utf8), status: status)
    }

    @Test func friendlyAuthErrors() {
        #expect(message(#"{"error_code":"invalid_credentials","msg":"Invalid login credentials"}"#, 400) == "That email and password don't match a binge. account.")
        #expect(message(#"{"error":"invalid_grant","error_description":"Invalid login credentials"}"#, 400) == "That email and password don't match a binge. account.")
        #expect(message(#"{"error_code":"email_not_confirmed"}"#, 400).hasPrefix("Confirm your email"))
    }

    @Test func passesServerMessages() {
        #expect(message(#"{"message":"duplicate key value"}"#, 409) == "duplicate key value")
        #expect(message(#"{"msg":"Rate limit exceeded"}"#, 429) == "Rate limit exceeded")
    }

    @Test func fallbacks() {
        #expect(message("<html>Bad gateway</html>", 502) == "binge. is having trouble right now. Try again in a moment.")
        #expect(message("", 404) == "Something went wrong (404).")
        #expect(message(#"{"message":""}"#, 400) == "Something went wrong (400).")
    }

    @Test func errorDescriptions() {
        #expect(BingeError.signedOut.errorDescription?.contains("Sign in") == true)
        #expect(BingeError.notConfigured.errorDescription?.contains("make-secrets") == true)
        #expect(BingeError.http(500, "x").errorDescription == "x")
    }
}

@MainActor @Suite struct SpokenTrackNameTests {
    @Test func unlabeledTracksHaveNoName() {
        #expect(PlayerModel.spokenName(MediaTrack(index: 0, label: "", language: "", on: true)) == nil)
        #expect(PlayerModel.spokenName(MediaTrack(index: 0, label: "1. ", language: "", on: true)) == nil)
        #expect(PlayerModel.spokenName(MediaTrack(index: 0, label: "", language: "kor", on: true)) == "Korean")
        #expect(PlayerModel.spokenName(MediaTrack(index: 0, label: "KOREAN 5.1", language: "ko", on: true)) == "KOREAN 5.1")
    }
}
