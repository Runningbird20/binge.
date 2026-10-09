import SwiftUI

@main
struct BingeTVApp: App {
    @StateObject private var app = AppModel()

    init() {
        // Posters and backdrops go through URLSession.shared; give it room.
        URLCache.shared = URLCache(memoryCapacity: 96 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024)
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "BingeCheckEngines") { EngineCheck.run() }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .preferredColorScheme(.dark)
                .tint(Theme.gold)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var app: AppModel

    var body: some View {
        ZStack {
            WarmHost().ignoresSafeArea()
            Theme.background.ignoresSafeArea()
            switch app.phase {
            case .loading:
                ProgressView()
            case .signedOut:
                SignInView()
            case .choosingProfile:
                ProfilePickerView()
            case .ready:
                MainTabs()
            }
            #if DEBUG
            if let probe = UserDefaults.standard.string(forKey: "BingeProbe").flatMap(URL.init(string:)) {
                DebugProbeView(url: probe).ignoresSafeArea()
            }
            #endif
        }
        .animation(.easeInOut(duration: 0.25), value: app.phase)
        .task {
            OverlayWindow.install()
            await app.start()
        }
        .onOpenURL { url in app.deepLink = DeepLink(url) }
        .onChange(of: app.phase) { _, phase in
            if phase == .ready, app.isSignedIn { TeamCenter.shared.start(app: app) }
            if phase == .signedOut { TeamCenter.shared.stop(); PiPController.shared.close() }
        }
    }
}

struct MainTabs: View {
    @EnvironmentObject private var app: AppModel
    @State private var tab = DebugLaunch.tab ?? "home"

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { HomeView().titleDestinations() }
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag("home")
            NavigationStack { BrowseView(kind: .movie).titleDestinations() }
                .tabItem { Label("Movies", systemImage: "film") }
                .tag("movies")
            NavigationStack { BrowseView(kind: .tvShow).titleDestinations() }
                .tabItem { Label("Series", systemImage: "tv") }
                .tag("series")
            if !app.isKids {
                NavigationStack { SportsView() }
                    .tabItem { Label("Sports", systemImage: "sportscourt") }
                    .tag("sports")
            }
            NavigationStack { SearchView().titleDestinations() }
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag("search")
            NavigationStack { MeView() }
                .tabItem { Label(app.profile?.name ?? "Me", systemImage: "person.crop.circle") }
                .tag("me")
        }
        #if DEBUG
        .overlay { DebugLaunch.overlay() }
        #endif
        .onChange(of: app.deepLink) { _, link in if link != nil { tab = "home" } }
        // A different profile means different rows, list and history.
        .id(app.profile?.id ?? "none")
    }
}
