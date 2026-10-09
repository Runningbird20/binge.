import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var app: AppModel
    @State private var query = ""
    @State private var results: [Title] = []
    @State private var trending: [Title] = []
    @State private var searching = false
    @State private var ai: [(Title, String?)] = []
    @State private var aiSummary: String?
    @State private var aiLoading = false
    @State private var aiError: String?

    private let columns = Array(repeating: GridItem(.fixed(220), spacing: 48), count: 7)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                let showing = query.trimmingCharacters(in: .whitespaces).isEmpty ? trending : results
                if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    askSection
                }
                if !query.isEmpty && !searching && results.isEmpty && ai.isEmpty && !aiLoading {
                    Text("Nothing on binge. matches “\(query)”.")
                        .font(.headline)
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                } else {
                    if query.isEmpty && !trending.isEmpty { SectionTitle(text: "Trending searches") }
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 56) {
                        ForEach(showing) { PosterCard(title: $0) }
                    }
                }
            }
            .padding(.vertical, 30)
        }
        .scrollClipDisabled()
        .searchable(text: $query, prompt: "Movies, series, actors")
        .task(id: query) {
            let text = query.trimmingCharacters(in: .whitespaces)
            guard !text.isEmpty else { results = []; return }
            searching = true
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            let found = (try? await Catalog.search(text, kids: app.isKids)) ?? []
            guard !Task.isCancelled else { return }
            results = found
            searching = false
            ai = []
            aiSummary = nil
            aiError = nil
            if AskBinge.isConversational(text) { await ask(text) }
        }
        .task {
            guard trending.isEmpty else { return }
            async let movies = Catalog.load(RowSpec(id: "s-m", title: "", kind: .movie, path: "trending/movie/week"), kids: app.isKids)
            async let shows = Catalog.load(RowSpec(id: "s-t", title: "", kind: .tvShow, path: "trending/tv/week"), kids: app.isKids)
            let (m, s) = await (movies, shows)
            // Interleave so the grid isn't all movies first.
            let a = m?.items ?? [], b = s?.items ?? []
            trending = (0..<max(a.count, b.count)).flatMap { i in [i < b.count ? b[i] : nil, i < a.count ? a[i] : nil].compactMap { $0 } }
        }
    }

    // MARK: Ask binge.

    @ViewBuilder
    private var askSection: some View {
        if aiLoading {
            HStack(spacing: 20) {
                ProgressView()
                Text("Asking binge.…").font(.headline)
            }
        } else if !ai.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 18) {
                    Label("Ask binge.", systemImage: "sparkles").font(.title3.weight(.bold)).foregroundStyle(Theme.gold)
                    if let aiSummary { Text(aiSummary).font(.callout).foregroundStyle(Theme.muted).lineLimit(1) }
                }
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 40) {
                        ForEach(ai, id: \.0.id) { title, why in
                            VStack(alignment: .leading, spacing: 10) {
                                PosterCard(title: title)
                                if let why {
                                    Text(why).font(.caption2).foregroundStyle(Theme.muted).lineLimit(3)
                                        .frame(width: 220, alignment: .leading)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 34)
                }
                .scrollIndicators(.hidden)
                .scrollClipDisabled()
            }
            .focusSection()
        } else {
            HStack(spacing: 24) {
                Button {
                    Task { await ask(query.trimmingCharacters(in: .whitespaces)) }
                } label: {
                    Label("Ask binge. for “\(query)”", systemImage: "sparkles")
                }
                .buttonStyle(PillButtonStyle(selected: true))
                if let aiError { Text(aiError).font(.callout).foregroundStyle(Color(hex: 0xFFB4A8)) }
                else { Text("Describe a mood: “a cozy mystery under 2 hours”").font(.callout).foregroundStyle(Theme.muted) }
            }
            .focusSection()
        }
    }

    private func ask(_ text: String) async {
        aiLoading = true
        aiError = nil
        do {
            let result = try await AskBinge.ask(text, kids: app.isKids)
            guard text == query.trimmingCharacters(in: .whitespaces) else { aiLoading = false; return }
            ai = result.titles
            aiSummary = result.summary
            if result.titles.isEmpty { aiError = "Nothing on binge. fits that yet. Try saying it another way." }
        } catch {
            aiError = error.localizedDescription
        }
        aiLoading = false
    }
}

struct MeView: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var pip = PiPController.shared

    var body: some View {
        HStack(alignment: .top, spacing: 90) {
            VStack(alignment: .leading, spacing: 30) {
                if let profile = app.profile {
                    ProfileAvatar(profile: profile, size: 180)
                }
                if let email = app.session?.email {
                    Text("Signed in as \(email)").font(.callout).foregroundStyle(Theme.muted)
                } else if app.isDemo {
                    Text("Demo mode (not signed in)").font(.callout).foregroundStyle(Theme.muted)
                }
                if app.profiles.count > 1 {
                    Button { app.switchProfile() } label: { Label("Switch profile", systemImage: "person.2") }
                }
                if app.isSignedIn {
                    Button { Task { await app.signOut() } } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
                }
                Spacer()
                Text("binge. for Apple TV \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
            .focusSection()

            VStack(alignment: .leading, spacing: 26) {
                Text("Your stuff").font(.title3.weight(.bold))
                LazyVGrid(columns: [GridItem(.fixed(500), spacing: 40), GridItem(.fixed(500), spacing: 40)], alignment: .leading, spacing: 40) {
                    tile("History", "clock.arrow.circlepath", "Everything you've started") { HistoryView() }
                    tile("Calendar", "calendar", "Upcoming episodes & releases") { CalendarView() }
                    tile("Wrapped", "sparkles", "Your year on binge.") { WrappedView() }
                    tile("Playback", "captions.bubble", "Audio, subtitles, trailers") { PlaybackSettingsView() }
                }
                if let corner = pip.game {
                    Button { PiPController.shared.close() } label: {
                        Label("Close corner game (\(corner.title))", systemImage: "pip.remove")
                    }
                }
                Text("Books, manga and account settings are on \(Config.siteHost).")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
            .focusSection()
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func tile<Destination: View>(_ title: String, _ icon: String, _ detail: String,
                                         @ViewBuilder destination: @escaping () -> Destination) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 22) {
                Image(systemName: icon).font(.system(size: 40)).foregroundStyle(Theme.gold).frame(width: 60)
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.headline)
                    Text(detail).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .padding(28)
            .frame(width: 500, height: 150)
            .background(Theme.surface)
        }
        .buttonStyle(.card)
    }
}
