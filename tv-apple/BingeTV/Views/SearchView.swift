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
