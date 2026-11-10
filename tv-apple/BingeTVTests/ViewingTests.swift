import Foundation
import Testing
@testable import BingeTV

// Scrubbing, auto-skipped intros and the server numbers shared between
// Apple TVs.
@Suite(.serialized) @MainActor struct ViewingTests {
    private func show(_ id: Int) -> Title {
        Title(kind: .tvShow, dbId: id, name: "Show \(id)", year: nil, overview: nil, genre: nil, ageRating: nil)
    }

    @Test func scrubbingStaysInsideTheVideo() {
        // A 2-hour film: 1.5s a point, so a 1000-point swipe is 25 minutes.
        #expect(ScrubMath.secondsPerPoint(duration: 7200) == 1.5)
        #expect(ScrubMath.target(base: 600, translation: 1000, duration: 7200) == 2100)
        #expect(ScrubMath.target(base: 600, translation: -1000, duration: 7200) == 0)
        #expect(ScrubMath.target(base: 7000, translation: 1000, duration: 7200) == 7199)
        // A 22-minute episode moves slower, never under 0.1s a point.
        #expect(abs(ScrubMath.secondsPerPoint(duration: 1320) - 0.33) < 0.001)
        #expect(ScrubMath.secondsPerPoint(duration: 60) == 0.1)
        #expect(ScrubMath.clock(3725) == "1:02:05")
        #expect(ScrubMath.clock(65) == "1:05")
    }

    @Test func autoSkipIsOfferedOnceAfterTwoEpisodes() {
        let title = show(800_000_000 + Int.random(in: 0..<100_000))
        #expect(IntroSkips.shouldOffer(title, skips: IntroSkips.recordManual(title, season: 1, episode: 1)) == false)
        // The same episode again doesn't count twice.
        #expect(IntroSkips.recordManual(title, season: 1, episode: 1) == 1)
        let skips = IntroSkips.recordManual(title, season: 1, episode: 2)
        #expect(skips == 2)
        #expect(IntroSkips.shouldOffer(title, skips: skips))
        #expect(IntroSkips.shouldOffer(title, skips: 3) == false)
        IntroSkips.set(title, on: true)
        #expect(IntroSkips.isOn(title))
        IntroSkips.set(title, on: false)
    }

    @Test func sharedNumbersOnlyFillGaps() {
        let ids = StreamServer.all.map(\.id)
        let keys = ids.flatMap { ["binge.speed.\($0)", "binge.q.\($0)"] }
        let saved = keys.map { UserDefaults.standard.object(forKey: $0) }
        defer { for (key, value) in zip(keys, saved) { UserDefaults.standard.set(value, forKey: key) } }
        keys.forEach { UserDefaults.standard.removeObject(forKey: $0) }

        let mine = StreamServer.all[0], other = StreamServer.all[1]
        UserDefaults.standard.set(4.0, forKey: "binge.speed.\(mine.id)")
        SharedServerStats.apply([(mine.id, 20, 720), (other.id, 3, 1080), ("not-a-server", 1, 2160)])
        // This Apple TV's own timing stays; what it hasn't measured is filled in.
        #expect(ServerSpeed.of(mine) == 4)
        #expect(QualityMemory.learned(mine) == 720)
        #expect(ServerSpeed.of(other) == 3)
        #expect(QualityMemory.learned(other) == 1080)
        #expect(UserDefaults.standard.object(forKey: "binge.speed.not-a-server") == nil)
    }
}
