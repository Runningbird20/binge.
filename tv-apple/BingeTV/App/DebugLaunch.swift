import SwiftUI

// Debug-build launch arguments for checking screens in the simulator
// without a remote:  -BingeDemo  -BingeTab sports  -BingeOpen tv_show:123
// (add -BingeHandoff YES to open the phone handoff for that title, or
// -BingePlay 2:3 to start the player at S2:E3 / -BingePlay 0 for a movie).
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
        if let open = UserDefaults.standard.string(forKey: "BingeOpen") {
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

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let title {
                if let play {
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
            guard parts.count == 2, let kind = MediaKind(rawValue: String(parts[0])), let id = Int(parts[1]) else { return }
            title = try? await Catalog.titles(kind, ids: [id])[id]
        }
    }
}
#endif
