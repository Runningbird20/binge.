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
    // Settings › Accessibility "Larger text": every text style one big step up.
    @AppStorage("binge.largeText") private var largeText = false

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
        .dynamicTypeSize(largeText ? .accessibility2 : .large)
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
    @ObservedObject private var ambient = AmbientStore.shared
    @State private var ambientPlay: PlayRequest?

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
        // Ambient mode after a few idle minutes (AmbientStore).
        .fullScreenCover(isPresented: $ambient.showing) {
            AmbientView(titles: ambient.titles,
                        resumeLabel: ambient.resume.map { item in "Resume \(item.title.name)\(item.episodeLabel.map { " · \($0)" } ?? "")" },
                        resume: {
                            let next = ambient.resume?.playRequest
                            ambient.showing = false
                            ambient.touch()
                            if let next { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { ambientPlay = next } }
                        },
                        dismiss: { ambient.showing = false; ambient.touch() })
        }
        .background {
            Color.clear.fullScreenCover(item: $ambientPlay) { PlayerView(request: $0, app: app) }
        }
        .onAppear { AmbientStore.shared.start() }
        // A different profile means different rows, list and history.
        .id(app.profile?.id ?? "none")
    }
}
