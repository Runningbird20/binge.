import Foundation
import Testing
@testable import BingeTV

// The collections list the website and the app share (public/collections.json).
@Suite struct CollectionsTests {
    @Test func dateTokensUseTheLocalDate() {
        let today = Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: 19))!
        let filled = Collections.fill(["a": "{today}", "b": "{today+30}", "c": "{today-365}", "d": "x"], today: today)
        #expect(filled == ["a": "2026-11-19", "b": "2026-12-19", "c": "2025-11-19", "d": "x"])
    }

    @Test func restrictedProfilesLoseMatureSets() throws {
        let json = """
        {"groups":[{"id":"f","title":"Franchises"},{"id":"h","title":"Horror"}],
         "collections":[
          {"id":"toy","group":"f","title":"Toy Story","subtitle":"s","sources":[{"type":"collection","media":"movie","ids":[10194]}],"order":"release"},
          {"id":"saw","group":"h","title":"Saw","subtitle":"s","mature":true,"sources":[{"type":"collection","media":"movie","ids":[656]}]},
          {"id":"top","group":"f","title":"Top","subtitle":"s","limit":100,"sources":[{"type":"discover","media":"movie","params":{"sort_by":"vote_average.desc"}}]}]}
        """
        let file = try JSONDecoder().decode(CollectionsFile.self, from: Data(json.utf8))
        #expect(file.visible(restricted: false).map(\.group.id) == ["f", "h"])
        let kids = file.visible(restricted: true)
        #expect(kids.map(\.group.id) == ["f"])
        #expect(kids[0].sets.map(\.id) == ["toy", "top"])
        #expect(file.collections[2].limit == 100)
    }
}
