import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var app: AppModel
    @State private var continueItems: [ContinueItem] = []
    @State private var myList: [Title] = []
    @State private var personal = Personal.Rows()
    @State private var rows: [LoadedRow] = []
    @State private var loading = true
    @State private var play: PlayRequest?
    @State private var detail: Title?

    private var name: String { app.profile?.name ?? "you" }

    private var spotlight: Title? {
        (personal.topPicks?.items ?? []).first(where: { $0.backdrop != nil })
            ?? rows.first?.items.first(where: { $0.backdrop != nil })
    }

    // Netflix order: your stuff first, then picks, with "Because you…" rows
    // woven between the general ones.
    private var feed: [LoadedRow] {
        var out: [LoadedRow] = []
        if let row = personal.newEpisodes { out.append(row) }
        if let row = personal.topPicks { out.append(row) }
        if !myList.isEmpty { out.append(LoadedRow(id: "my-list", title: "My List", items: myList)) }
        var because = personal.because[...]
        for (index, row) in rows.enumerated() {
            out.append(row)
            if index % 2 == 0, let next = because.popFirst() { out.append(next) }
        }
        out.append(contentsOf: because)
        return out
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                if let spotlight { HeroView(title: spotlight) }
                if !continueItems.isEmpty {
                    ContinueRowView(title: "Continue Watching for \(name)", items: continueItems,
                                    play: { item in play = item.playRequest },
                                    details: { detail = $0.title },
                                    remove: { item in
                                        continueItems.removeAll { $0.id == item.id }
                                        Task { await app.removeFromContinue(item.title) }
                                    })
                }
                ForEach(feed) { TitleRowView(row: $0) }
                if loading && rows.isEmpty {
                    ForEach(0..<3, id: \.self) { _ in RowSkeleton() }
                } else if !loading && rows.isEmpty && continueItems.isEmpty {
                    ProblemView(message: "Couldn't load your rows. Check the Apple TV's internet connection.") {
                        Task { await load() }
                    }
                }
            }
            .padding(.bottom, 60)
        }
        .scrollClipDisabled()
        .navigationDestination(item: $detail) { TitleDetailView(title: $0) }
        .fullScreenCover(item: $play, onDismiss: { Task { await refreshContinue() } }) { request in
            PlayerView(request: request, app: app)
        }
        .task { await load() }
        .onChange(of: app.listIds) { _, _ in Task { myList = (try? await app.myList()) ?? myList } }
    }

    private func refreshContinue() async {
        if let items = try? await app.continueWatching() { continueItems = items }
    }

    private func load() async {
        loading = true
        let kids = app.isKids
        async let general = Catalog.loadAll(Rows.home(kids: kids), kids: kids)
        async let cw: [ContinueItem] = (try? await app.continueWatching()) ?? []
        async let list: [Title] = (try? await app.myList()) ?? []
        async let loved = app.lovedTitles()
        async let rated = app.ratedIds()

        let (items, listTitles) = await (cw, list)
        continueItems = items
        // The first Continue Watching card is the likeliest next play.
        if let first = items.first { Warmup.shared.prepare(first.playRequest) }
        myList = listTitles
        rows = await general
        loading = false

        let exclude = (await rated).union(items.map(\.id)).union(listTitles.map(\.id))
        personal = await Personal.build(watched: items, loved: await loved, exclude: exclude,
                                        kids: kids, name: app.profile?.name)
    }
}

// The personalized rows: Top Picks (recommendations shared by several of
// your titles score highest), "Because you watched/liked X", New Episodes.
enum Personal {
    struct Rows {
        var topPicks: LoadedRow?
        var because: [LoadedRow] = []
        var newEpisodes: LoadedRow?
    }

    static func build(watched: [ContinueItem], loved: [Title], exclude: Set<String>, kids: Bool, name: String?) async -> Rows {
        var rows = Rows()

        let fresh = watched.filter { $0.newEpisode != nil }.map { item -> Title in
            var title = item.title
            title.badge = "New \(item.newEpisode ?? "")"
            return title
        }
        if !fresh.isEmpty { rows.newEpisodes = LoadedRow(id: "new-episodes", title: "New Episodes", items: fresh) }

        // Up to 4 recent watches and 3 favourites seed the picks.
        var seeds: [(title: Title, verb: String, weight: Double)] = []
        for (i, item) in watched.prefix(4).enumerated() { seeds.append((item.title, "watched", 1.0 - Double(i) * 0.12)) }
        for title in loved where !seeds.contains(where: { $0.title.id == title.id }) && seeds.count < 7 {
            seeds.append((title, "liked", 0.9))
        }
        guard !seeds.isEmpty else { return rows }

        let recs: [(Int, [Title])] = await withTaskGroup(of: (Int, [Title]).self) { group in
            for (index, seed) in seeds.enumerated() {
                guard let tmdbId = seed.title.tmdbId else { continue }
                let spec = RowSpec(id: "rec-\(seed.title.id)", title: "", kind: seed.title.kind,
                                   path: "\(seed.title.kind.tmdbPath)/\(tmdbId)/recommendations")
                group.addTask { (index, await Catalog.load(spec, kids: kids)?.items ?? []) }
            }
            var all: [(Int, [Title])] = []
            for await entry in group { all.append(entry) }
            return all.sorted { $0.0 < $1.0 }
        }

        var scores: [String: (title: Title, score: Double)] = [:]
        var usedInBecause = Set<String>()
        for (index, items) in recs {
            let seed = seeds[index]
            let candidates = items.filter { !exclude.contains($0.id) && $0.id != seed.title.id }
            for (position, title) in candidates.enumerated() {
                let add = seed.weight * (1 - Double(position) / 25)
                scores[title.id] = (title, (scores[title.id]?.score ?? 0) + add)
            }
            if rows.because.count < 4, candidates.count >= 5 {
                rows.because.append(LoadedRow(id: "because-\(seed.title.id)",
                                              title: "Because you \(seed.verb) \(seed.title.name)",
                                              items: candidates))
                candidates.prefix(3).forEach { usedInBecause.insert($0.id) }
            }
        }
        let picks = scores.values.sorted { $0.score > $1.score }.map(\.title).prefix(24)
        if picks.count >= 5 {
            rows.topPicks = LoadedRow(id: "top-picks", title: "Top Picks for \(name ?? "You")", items: Array(picks))
        }
        return rows
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
    let title: String
    let items: [ContinueItem]
    let play: (ContinueItem) -> Void
    let details: (ContinueItem) -> Void
    let remove: (ContinueItem) -> Void
    @FocusState private var focused: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: title)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 40) {
                    ForEach(items) { item in
                        ContinueCard(item: item) { play(item) }
                            .focused($focused, equals: item.id)
                            .contextMenu {
                                Button { play(item) } label: { Label("Resume", systemImage: "play.fill") }
                                Button { details(item) } label: { Label("Details & episodes", systemImage: "info.circle") }
                                Button(role: .destructive) { remove(item) } label: { Label("Remove from row", systemImage: "xmark") }
                            }
                    }
                }
                .padding(.vertical, 34)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .task(id: focused) {
                // Resting on a card for a moment preloads it.
                guard let id = focused, let item = items.first(where: { $0.id == id }) else { return }
                try? await Task.sleep(for: .milliseconds(700))
                guard !Task.isCancelled else { return }
                Warmup.shared.prepare(item.playRequest)
            }
            Text("Click to resume · press and hold for details")
                .font(.caption2)
                .foregroundStyle(Theme.muted)
        }
        .focusSection()
    }
}

struct ContinueCard: View {
    let item: ContinueItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
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
            .overlay(alignment: .topTrailing) {
                if let fresh = item.newEpisode { Badge(text: "New \(fresh)").padding(12) }
            }
        }
        .buttonStyle(.card)
    }
}

extension ContinueItem {
    var playRequest: PlayRequest {
        PlayRequest(title: title, season: title.kind == .tvShow ? (season ?? 1) : nil,
                    episode: title.kind == .tvShow ? (episode ?? 1) : nil, startAt: position)
    }
}
