import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var app: AppModel
    @State private var continueItems: [ContinueItem] = []
    @State private var myList: [Title] = []
    @State private var because: LoadedRow?
    @State private var rows: [LoadedRow] = []
    @State private var loading = true

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                if let spotlight = rows.first?.items.first(where: { $0.backdrop != nil }) {
                    HeroView(title: spotlight)
                }
                if !continueItems.isEmpty {
                    ContinueRowView(items: continueItems)
                }
                if !myList.isEmpty {
                    TitleRowView(row: LoadedRow(id: "my-list", title: "My List", items: myList))
                }
                if let because {
                    TitleRowView(row: because)
                }
                ForEach(rows) { TitleRowView(row: $0) }
                if loading && rows.isEmpty {
                    ForEach(0..<3, id: \.self) { _ in RowSkeleton() }
                } else if !loading && rows.isEmpty {
                    ProblemView(message: "Couldn't load your rows. Check the Apple TV's internet connection.") {
                        Task { await load() }
                    }
                }
            }
            .padding(.bottom, 60)
        }
        .scrollClipDisabled()
        .task { await load() }
        .onChange(of: app.listIds) { _, _ in Task { myList = (try? await app.myList()) ?? myList } }
    }

    private func load() async {
        loading = true
        async let rowsTask = Catalog.loadAll(Rows.home(kids: app.isKids), kids: app.isKids)
        async let personal: ([ContinueItem], [Title]) = {
            do {
                return (try await app.continueWatching(), try await app.myList())
            } catch {
                await app.handle(error)
                return ([], [])
            }
        }()
        let (loadedRows, (items, list)) = await (rowsTask, personal)
        rows = loadedRows
        continueItems = items
        myList = list
        loading = false
        because = await becauseYouWatched(items)
    }

    // "Because you watched X": TMDB recommendations for the most recent
    // title in Continue Watching, minus what's already in progress.
    private func becauseYouWatched(_ items: [ContinueItem]) async -> LoadedRow? {
        guard let seed = items.first?.title, let tmdbId = seed.tmdbId else { return nil }
        let spec = RowSpec(id: "because", title: "Because you watched \(seed.name)", kind: seed.kind,
                           path: "\(seed.kind.tmdbPath)/\(tmdbId)/recommendations")
        guard let row = await Catalog.load(spec, kids: app.isKids) else { return nil }
        let inProgress = Set(items.map(\.id))
        let fresh = row.items.filter { !inProgress.contains($0.id) }
        return fresh.isEmpty ? nil : LoadedRow(id: row.id, title: row.title, items: fresh)
    }
}

struct BrowseView: View {
    @EnvironmentObject private var app: AppModel
    let kind: MediaKind
    @State private var rows: [LoadedRow] = []
    @State private var loading = true

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                if let spotlight = rows.first?.items.first(where: { $0.backdrop != nil }) {
                    HeroView(title: spotlight)
                }
                ForEach(rows) { TitleRowView(row: $0) }
                if loading && rows.isEmpty {
                    ForEach(0..<3, id: \.self) { _ in RowSkeleton() }
                } else if !loading && rows.isEmpty {
                    ProblemView(message: "Couldn't load \(kind == .movie ? "movies" : "series") right now.") {
                        Task { await load() }
                    }
                }
            }
            .padding(.bottom, 60)
        }
        .scrollClipDisabled()
        .task { if rows.isEmpty { await load() } }
    }

    private func load() async {
        loading = true
        rows = await Catalog.loadAll(Rows.browse(kind, kids: app.isKids), kids: app.isKids)
        loading = false
    }
}

// The big spotlight at the top of Home / Movies / Series.
struct HeroView: View {
    let title: Title

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: title.backdrop.flatMap { URL(string: $0.absoluteString.replacingOccurrences(of: "/w780/", with: "/w1280/")) }) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                Theme.surface
            }
            .frame(height: 620)
            .frame(maxWidth: .infinity)
            .clipped()
            .overlay {
                LinearGradient(colors: [Theme.background.opacity(0.95), Theme.background.opacity(0.2), .clear],
                               startPoint: .leading, endPoint: .trailing)
            }
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [.clear, Theme.background], startPoint: .center, endPoint: .bottom)
            }
            .padding(.horizontal, -Theme.edge)

            VStack(alignment: .leading, spacing: 20) {
                Text(title.name)
                    .font(.system(size: 68, weight: .heavy))
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                if !title.metaLine.isEmpty {
                    Text(title.metaLine).font(.callout.weight(.semibold)).foregroundStyle(Theme.muted)
                }
                if let overview = title.overview, !overview.isEmpty {
                    Text(overview)
                        .font(.callout)
                        .lineLimit(3)
                        .foregroundStyle(.white.opacity(0.85))
                }
                NavigationLink(value: title) {
                    Label("More info", systemImage: "info.circle")
                }
                .padding(.top, 8)
            }
            .frame(maxWidth: 860, alignment: .leading)
            .padding(.bottom, 40)
        }
        .focusSection()
    }
}

struct ContinueRowView: View {
    let items: [ContinueItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: "Continue Watching")
            ScrollView(.horizontal) {
                LazyHStack(spacing: 40) {
                    ForEach(items) { ContinueCard(item: $0) }
                }
                .padding(.vertical, 34)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
        .focusSection()
    }
}

struct ContinueCard: View {
    let item: ContinueItem

    var body: some View {
        NavigationLink(value: item.title) {
            ZStack(alignment: .bottomLeading) {
                PosterImage(url: item.title.backdrop ?? item.title.poster, name: item.title.name)
                    .frame(width: 420, height: 236)
                    .clipped()
                LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.title.name).font(.headline).lineLimit(1)
                    if let label = item.episodeLabel {
                        Text(label).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                    }
                    if let progress = item.progress {
                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                Capsule().fill(.white.opacity(0.25))
                                Capsule().fill(Theme.gold).frame(width: proxy.size.width * progress)
                            }
                        }
                        .frame(height: 6)
                    }
                }
                .padding(18)
            }
            .frame(width: 420, height: 236)
        }
        .buttonStyle(.card)
    }
}
