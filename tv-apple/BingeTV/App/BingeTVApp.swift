import AVFoundation
import SwiftUI

@main
struct BingeTVApp: App {
    @StateObject private var app = AppModel()

    init() {
        // Posters and backdrops go through URLSession.shared; give it room.
        URLCache.shared = URLCache(memoryCapacity: 96 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024)
        _ = Connectivity.shared // knows whether we're online before anything fails
        CrashReporter.install()
        // Long-form video: multichannel (5.1 / Atmos) goes to the receiver as
        // is, and long-form routing keeps it on the TV's chosen speakers.
        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playback, mode: .moviePlayback, policy: .longFormAudio)
        try? audio.setSupportsMultichannelContent(true)
        try? audio.setActive(true)
        #if DEBUG
        // Logs line by line, in order (the timing checks read them).
        setvbuf(stdout, nil, _IOLBF, 0)
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
        // Another profile: its own followed teams.
        .onChange(of: app.profile?.id) { _, _ in
            if app.phase == .ready, app.isSignedIn { TeamCenter.shared.start(app: app) }
        }
    }
}

struct MainTabs: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = DebugLaunch.tab ?? "home"
    @ObservedObject private var ambient = AmbientStore.shared
    @ObservedObject private var inbox = InboxStore.shared
    @State private var ambientPlay: PlayRequest?

    // The Me tab says how many notifications are unread, like the dot on the
    // website's bell: "Sam (2)". tvOS tab bars have no badges (.badge isn't
    // available there) and mostly show just the tab's name.
    private var meTabTitle: String {
        let name = app.profile?.name ?? "Me"
        let unread = inbox.unreadIds.count
        return unread > 0 ? "\(name) (\(unread))" : name
    }

    // "Resume Severance · S2:E5" on the ambient screen. Its own property: inline
    // in the long modifier chain below, the compiler gave up type-checking body.
    private var ambientResumeLabel: String? {
        guard let item = ambient.resume else { return nil }
        let episode = item.episodeLabel.map { " · \($0)" } ?? ""
        return "Resume \(item.title.name)\(episode)"
    }

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
                .tabItem { Label(meTabTitle, systemImage: "person.crop.circle") }
                .tag("me")
        }
        #if DEBUG
        .overlay { DebugLaunch.overlay() }
        #endif
        .onChange(of: app.deepLink) { _, link in if link != nil { tab = "home" } }
        .onChange(of: app.openTab) { _, next in
            guard let next else { return }
            app.openTab = nil
            if next != "sports" || !app.isKids { tab = next }
        }
        // The inbox: now, every 5 minutes, and when the app comes back.
        .task {
            while !Task.isCancelled {
                await inbox.refresh(app)
                try? await Task.sleep(for: .seconds(300))
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await inbox.refresh(app) } }
        }
        // Ambient mode after a few idle minutes (AmbientStore).
        .fullScreenCover(isPresented: $ambient.showing) {
            AmbientView(titles: ambient.titles,
                        resumeLabel: ambientResumeLabel,
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
