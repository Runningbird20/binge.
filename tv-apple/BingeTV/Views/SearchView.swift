import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var app: AppModel
    @State private var query = ""
    @State private var results: [Title] = []
    @State private var trending: [Title] = []
    @State private var searching = false

    private let columns = Array(repeating: GridItem(.fixed(220), spacing: 48), count: 7)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                let showing = query.trimmingCharacters(in: .whitespaces).isEmpty ? trending : results
                if !query.isEmpty && !searching && results.isEmpty {
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
}

struct SportsView: View {
    @State private var boards: [(League, [Scoreboard.Event])] = []
    @State private var loaded = false
    @State private var handoff: Handoff?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 40) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Live & Upcoming").font(.system(size: 54, weight: .heavy))
                    Spacer()
                    Text("Scores update every 30 seconds").font(.caption).foregroundStyle(Theme.muted)
                }
                if loaded && boards.isEmpty {
                    Text("No games today in the leagues binge. follows.")
                        .font(.headline)
                        .foregroundStyle(Theme.muted)
                        .padding(.top, 40)
                }
                if !loaded { ProgressView().frame(maxWidth: .infinity).padding(.top, 80) }
                ForEach(boards, id: \.0.id) { league, events in
                    VStack(alignment: .leading, spacing: 4) {
                        SectionTitle(text: league.name)
                        ScrollView(.horizontal) {
                            LazyHStack(spacing: 40) {
                                ForEach(events) { event in
                                    GameCard(event: event) {
                                        handoff = Handoff(heading: event.shortName ?? league.name,
                                                          detail: "Opens binge. Sports on your phone.",
                                                          url: Config.siteURL.appending(path: "sports"))
                                    }
                                }
                            }
                            .padding(.vertical, 34)
                        }
                        .scrollIndicators(.hidden)
                        .scrollClipDisabled()
                    }
                    .focusSection()
                }
            }
            .padding(.vertical, 30)
        }
        .scrollClipDisabled()
        .fullScreenCover(item: $handoff) { HandoffView(handoff: $0) }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func load() async {
        let result = await withTaskGroup(of: (Int, [Scoreboard.Event]).self) { group in
            for (index, league) in League.all.enumerated() {
                group.addTask { (index, (try? await Scoreboard.load(league)) ?? []) }
            }
            var found: [(Int, [Scoreboard.Event])] = []
            for await entry in group where !entry.1.isEmpty { found.append(entry) }
            return found
        }
        // Leagues with a live game first, then the usual order.
        boards = result
            .sorted { lhs, rhs in
                let l = lhs.1.contains(where: \.isLive), r = rhs.1.contains(where: \.isLive)
                return l != r ? l : lhs.0 < rhs.0
            }
            .map { (League.all[$0.0], $0.1) }
        loaded = true
    }
}

struct GameCard: View {
    let event: Scoreboard.Event
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    if event.isLive {
                        Label("LIVE", systemImage: "circle.fill")
                            .font(.caption.weight(.heavy))
                            .foregroundStyle(Color(hex: 0xFF5A50))
                    }
                    Text(event.status.type.shortDetail ?? "")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                if let away = event.away { TeamLine(team: away, showScore: event.status.type.state != "pre", dim: event.isFinal && away.winner == false) }
                if let home = event.home { TeamLine(team: home, showScore: event.status.type.state != "pre", dim: event.isFinal && home.winner == false) }
            }
            .padding(26)
            .frame(width: 460, height: 230, alignment: .topLeading)
            .background(Theme.surface)
        }
        .buttonStyle(.card)
    }

    private struct TeamLine: View {
        let team: Scoreboard.Competitor
        let showScore: Bool
        let dim: Bool

        var body: some View {
            HStack(spacing: 16) {
                AsyncImage(url: team.logoURL) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
                    .frame(width: 48, height: 48)
                Text(team.name).font(.headline).lineLimit(1)
                Spacer()
                if showScore, let score = team.score {
                    Text(score).font(.title2.weight(.heavy)).monospacedDigit()
                }
            }
            .opacity(dim ? 0.55 : 1)
        }
    }
}

struct MeView: View {
    @EnvironmentObject private var app: AppModel

    var body: some View {
        HStack(alignment: .top, spacing: 100) {
            VStack(alignment: .leading, spacing: 34) {
                if let profile = app.profile {
                    ProfileAvatar(profile: profile, size: 200)
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

            VStack(alignment: .leading, spacing: 24) {
                Text("Ratings, history, books & settings")
                    .font(.title3.weight(.bold))
                Text("Scan to open binge. on your phone. Ratings, your watch history, books, Wrapped and settings live there, and stay in sync with this TV.")
                    .font(.callout)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: 640, alignment: .leading)
                QRCodeView(url: Config.siteURL.appending(path: "home"), size: 300)
            }
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
