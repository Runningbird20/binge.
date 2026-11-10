import Foundation
import Testing
@testable import BingeTV

// Saved streams: kept a few hours per server page, dropped when they fail,
// and never more than the limit.
@Suite(.serialized) struct StreamCacheTests {
    private let key = "binge.streams"
    private func page(_ n: Int) -> URL { URL(string: "https://cinesrc.st/embed/tv/\(n)?s=1&e=1")! }
    private func source(_ n: Int) -> (stream: URL, page: String, agent: String) {
        (URL(string: "https://cdn.example/\(n)/master.m3u8")!, "https://cinesrc.st/embed/tv/\(n)", "UA")
    }

    @Test func savesExpiresAndForgets() {
        let saved = UserDefaults.standard.object(forKey: key)
        defer { UserDefaults.standard.set(saved, forKey: key) }
        UserDefaults.standard.removeObject(forKey: key)

        let now = Date()
        StreamCache.save(source(1), for: page(1), now: now)
        #expect(StreamCache.stream(for: page(1), now: now)?.stream == source(1).stream)
        #expect(StreamCache.stream(for: page(1), now: now)?.agent == "UA")
        #expect(StreamCache.stream(for: page(2), now: now) == nil)
        // The token in the address runs out: past the lifetime it's gone.
        #expect(StreamCache.stream(for: page(1), now: now.addingTimeInterval(StreamCache.lifetime + 1)) == nil)
        StreamCache.forget(page(1))
        #expect(StreamCache.stream(for: page(1), now: now) == nil)
    }

    @Test func keepsTheNewest() {
        let saved = UserDefaults.standard.object(forKey: key)
        defer { UserDefaults.standard.set(saved, forKey: key) }
        UserDefaults.standard.removeObject(forKey: key)

        let start = Date()
        for n in 0..<(StreamCache.limit + 5) {
            StreamCache.save(source(n), for: page(n), now: start.addingTimeInterval(Double(n)))
        }
        let last = start.addingTimeInterval(Double(StreamCache.limit + 5))
        #expect(StreamCache.stream(for: page(0), now: last) == nil)
        #expect(StreamCache.stream(for: page(StreamCache.limit + 4), now: last) != nil)
        #expect((UserDefaults.standard.dictionary(forKey: key) ?? [:]).count == StreamCache.limit)
    }
}

// A measured frame rate counts only when it's a real video rate.
@MainActor struct FrameRateTests {
    @Test func snapsToStandardRates() {
        #expect(NativeEngine.standardRate(23.98) == 23.976)
        #expect(NativeEngine.standardRate(25.1) == 25)
        #expect(NativeEngine.standardRate(59.9) == 59.94)
        // Readings while the video starts up.
        #expect(NativeEngine.standardRate(1) == nil)
        #expect(NativeEngine.standardRate(9) == nil)
        #expect(NativeEngine.standardRate(27) == nil)
    }
}
