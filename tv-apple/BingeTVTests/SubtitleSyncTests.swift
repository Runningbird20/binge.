import Foundation
import Testing
@testable import BingeTV

// Subtitle timing: which way a shift moves the lines, and that a shift is
// remembered for the file and server it was made on.
@Suite(.serialized) struct SubtitleSyncTests {
    private let file = ExternalSubtitleFile(cues: [SubtitleCue(start: 10, end: 12, text: "Hello")], release: "R", versions: 1, version: 0)

    @Test func laterMeansLater() {
        // "Later (0.5s)" adds +0.5: the line must appear after its own time.
        #expect(file.text(at: 10.2, shift: 0) == "Hello")
        #expect(file.text(at: 10.2, shift: 0.5) == "")
        #expect(file.text(at: 10.6, shift: 0.5) == "Hello")
        // "Earlier" (-2): on screen two seconds before the file's time.
        #expect(file.text(at: 8.1, shift: -2) == "Hello")
        #expect(file.text(at: 11.5, shift: -2) == "")
    }

    @Test func rememberedPerFileAndServer() async {
        let key = SubtitleSync.Key(kind: .tvShow, mediaId: 900_000_000 + Int.random(in: 0..<1000), season: 1, episode: 2,
                                   lang: "en", release: "Show.S01E02.WEB", server: "vidy")
        SubtitleSync.remember(key, offset: 1.5)
        let found = await SubtitleSync.start(key)
        #expect(found?.offset == 1.5)
        #expect(found?.source == .mine)
        #expect(key.show == "show:tv_show:\(key.mediaId):en:vidy")
    }
}
