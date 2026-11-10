import SwiftUI

// Debug-build launch arguments for checking screens in the simulator
// without a remote:  -BingeDemo  -BingeTab sports  -BingeOpen tv_show:123
// (add -BingeHandoff YES to open the phone handoff for that title, or
// -BingePlay 2:3 to start the player at S2:E3 / -BingePlay 0 for a movie).
// -BingeOpen page:library opens My List & Ratings (-BingeLibraryTab 1 = Ratings),
// -BingeOpen person:1245 a person's page.
enum DebugLaunch {
    static var tab: String? {
        #if DEBUG
        return UserDefaults.standard.string(forKey: "BingeTab")
        #else
        return nil
        #endif
    }

    #if DEBUG
    @ViewBuilder
    static func overlay() -> some View {
        if UserDefaults.standard.string(forKey: "BingeOpen") == "page:library" {
            ZStack {
                Theme.background.ignoresSafeArea()
                NavigationStack { LibraryView(tab: UserDefaults.standard.integer(forKey: "BingeLibraryTab")).titleDestinations() }
            }
        } else if let open = UserDefaults.standard.string(forKey: "BingeOpen") {
            DebugTitleLoader(key: open, handoff: UserDefaults.standard.bool(forKey: "BingeHandoff"),
                             play: UserDefaults.standard.string(forKey: "BingePlay"))
        }
    }
    #endif
}

#if DEBUG
private struct DebugTitleLoader: View {
    let key: String
    let handoff: Bool
    let play: String?
    @EnvironmentObject private var app: AppModel
    @State private var title: Title?
    @State private var pressPlay = false
    @State private var person: PersonRef?

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let person {
                NavigationStack { PersonView(person: person).titleDestinations() }
            } else if let title {
                if pressPlay {
                    PlayerView(request: PlayRequest(title: title, season: title.kind == .tvShow ? 1 : nil,
                                                    episode: title.kind == .tvShow ? 1 : nil), app: app)
                } else if let play {
                    let parts = play.split(separator: ":").compactMap { Int($0) }
                    PlayerView(request: PlayRequest(title: title,
                                                    season: parts.count == 2 ? parts[0] : nil,
                                                    episode: parts.count == 2 ? parts[1] : nil), app: app)
                } else if handoff {
                    HandoffView(handoff: Handoff(heading: "Watch \(title.name)", detail: "S1:E1", url: title.watchURL(season: 1, episode: 1)))
                } else {
                    NavigationStack { TitleDetailView(title: title).titleDestinations() }
                }
            }
        }
        .task {
            let parts = key.split(separator: ":")
            if parts.count == 2, parts[0] == "person", let id = Int(parts[1]) { person = PersonRef(id: id, name: "Person \(id)"); return }
            guard parts.count == 2, let kind = MediaKind(rawValue: String(parts[0])), let id = Int(parts[1]) else { return }
            title = try? await Catalog.titles(kind, ids: [id])[id]
            // -BingePlayAfter N: open the title page, wait N seconds (its
            // preload runs), then "press" Play — measures the warm start.
            let wait = UserDefaults.standard.integer(forKey: "BingePlayAfter")
            if wait > 0 {
                try? await Task.sleep(for: .seconds(wait))
                pressPlay = true
            }
        }
    }
}
#endif
