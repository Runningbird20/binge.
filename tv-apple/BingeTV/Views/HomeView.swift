import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var app: AppModel
    @State private var continueItems: [ContinueItem] = []
    @State private var myList: [Title] = []
    @State private var personal = Personal.Rows()
    @State private var shared: [Title] = []
    @State private var rows: [LoadedRow] = []
    @State private var loading = true
    @State private var play: PlayRequest?
    @State private var detail: Title?
    // Titles this profile has watched: never recommended (WatchedTitles).
    @State private var watched: Set<String> = []
    @State private var dueReminders: [Reminder] = []
    @ObservedObject private var pip = PiPController.shared

    private var name: String { app.profile?.name ?? "you" }
    // Your own rows: resting on a card preloads it.
    static let preloadRows: Set<String> = ["top-picks", "my-list", "sent-to-you", "new-episodes"]
    // Finished shows leave the row (they stay in New Episodes).
    private var visibleContinue: [ContinueItem] { continueItems.filter { !$0.finished } }
    private var generalRows: [LoadedRow] { WatchedTitles.without(rows, watched) }

    // A different title most visits: one of your top picks or something
    // trending, chosen when the rows load (not always the first pick).
    @State private var spotlightPick: Title?
    private var spotlight: Title? {
        spotlightPick
            ?? (personal.topPicks?.items ?? []).first(where: { $0.backdrop != nil && !watched.contains($0.id) })
            ?? generalRows.first?.items.first(where: { $0.backdrop != nil })
    }

    private func chooseSpotlight() {
        let picks = (personal.topPicks?.items ?? []).prefix(10).filter { $0.backdrop != nil }
        let trending = generalRows.prefix(2).flatMap { $0.items.prefix(6) }.filter { $0.backdrop != nil }
        let pool = WatchedTitles.without(Array(picks) + trending, watched)
        guard !pool.isEmpty else { return }
        spotlightPick = pool.randomElement()
    }

    // Netflix order: your stuff first, then picks, with "Because you…" rows
    // woven between the general ones.
    private var feed: [LoadedRow] {
        var out: [LoadedRow] = []
        if let row = personal.newEpisodes { out.append(row) }
        if !shared.isEmpty { out.append(LoadedRow(id: "sent-to-you", title: "Sent to you", items: shared)) }
        if let row = personal.topPicks, let kept = WatchedTitles.without([row], watched).first { out.append(kept) }
        if !myList.isEmpty { out.append(LoadedRow(id: "my-list", title: "My List", items: myList)) }
        var because = WatchedTitles.without(personal.because, watched)[...]
        for (index, row) in generalRows.enumerated() {
            out.append(row)
            if index % 2 == 0, let next = because.popFirst() { out.append(next) }
        }
        out.append(contentsOf: because)
        return out
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                AnnouncementBanner()
                if let corner = pip.episode { CornerBar(episode: corner) { play = $0 } }
                if !dueReminders.isEmpty {
                    ReminderBanner(reminders: dueReminders, open: { reminder in
                        Task { await openReminder(reminder) }
                    }, dismiss: { reminder in
                        dueReminders.removeAll { $0.id == reminder.id }
                        Task { await app.dismissReminder(reminder.id) }
                    })
                }
                if let spotlight { HeroView(title: spotlight) }
                if !loading || !rows.isEmpty {
                    SurpriseButtons(personal: personal, fallback: generalRows.prefix(2).flatMap(\.items), watched: watched) { detail = $0 }
                }
                if !visibleContinue.isEmpty {
                    ContinueRowView(title: "Continue Watching for \(name)", items: visibleContinue,
                                    play: { item in play = item.playRequest },
                                    details: { detail = $0.title },
                                    remove: { item in
                                        continueItems.removeAll { $0.id == item.id }
                                        Task { await app.removeFromContinue(item.title) }
                                    })
                }
                ForEach(feed) { row in
                    TitleRowView(row: row, preload: Self.preloadRows.contains(row.id) || row.id.hasPrefix("because-"))
                }
                if loading && rows.isEmpty {
                    ForEach(0..<3, id: \.self) { _ in RowSkeleton() }
                } else if !loading && rows.isEmpty && continueItems.isEmpty {
                    ProblemView(message: Connectivity.problemMessage("your rows")) {
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
        .task {
            showSnapshot()
            await openDeepLink()
            await load()
        }
        .onChange(of: app.deepLink) { _, _ in Task { await openDeepLink() } }
        .onChange(of: app.listIds) { _, _ in Task { myList = (try? await app.myList()) ?? myList } }
    }

    // Home as it was last time, at once; the fresh rows replace it.
    private func showSnapshot() {
        guard rows.isEmpty, let id = app.profile?.id, let saved = HomeSnapshot.read(id) else { return }
        continueItems = saved.continueItems
        myList = saved.myList
        personal = saved.personal
        shared = saved.shared
        rows = saved.rows
        watched = WatchedTitles.shared.keys
        chooseSpotlight()
    }

    private func openReminder(_ reminder: Reminder) async {
        guard let kind = MediaKind(rawValue: reminder.mediaType),
              let title = try? await Catalog.titles(kind, ids: [reminder.mediaId])[reminder.mediaId] else { return }
        dueReminders.removeAll { $0.id == reminder.id }
        await app.dismissReminder(reminder.id)
        detail = title
    }

    // A Top Shelf item: play it, or open its title page.
    private func openDeepLink() async {
        guard let link = app.deepLink else { return }
        app.deepLink = nil
        guard let title = try? await Catalog.titles(link.kind, ids: [link.id])[link.id] else { return }
        if link.play {
            play = PlayRequest(title: title, season: link.kind == .tvShow ? (link.season ?? 1) : nil,
                               episode: link.kind == .tvShow ? (link.episode ?? 1) : nil, startAt: link.seconds)
        } else {
            detail = title
        }
    }

    private func refreshContinue() async {
        if let items = try? await app.continueWatching() { continueItems = items }
        watched = await WatchedTitles.shared.load(app)
    }

    private func load() async {
        loading = true
        let maturity = app.maturity
        async let general = Catalog.loadAll(Rows.home(kids: maturity.isChild), maturity: maturity)
        async let cw: [ContinueItem] = (try? await app.continueWatching()) ?? []
        async let list: [Title] = (try? await app.myList()) ?? []
        async let loved = app.lovedTitles()
        async let rated = app.ratedIds()
        async let watchedKeys = WatchedTitles.shared.load(app)
        async let due = app.reminders(dueOnly: true)

        let (items, listTitles) = await (cw, list)
        continueItems = items
        // The first Continue Watching card is the likeliest next play.
        if let first = items.first(where: { !$0.finished }) { Warmup.shared.prepare(first.playRequest) }
        myList = listTitles
        watched = await watchedKeys
        rows = await general
        loading = false
        dueReminders = await due

        let exclude = (await rated).union(items.map(\.id)).union(listTitles.map(\.id)).union(watched)
        personal = await Personal.build(watched: items, loved: await loved, exclude: exclude,
                                        maturity: maturity, name: app.profile?.name)
        chooseSpotlight()
        let showing = items.filter { !$0.finished }
        // Ambient mode's slideshow: what you're watching, then your picks.
        AmbientStore.shared.titles = Array((showing.map(\.title) + (personal.topPicks?.items ?? []) + myList + (generalRows.first?.items ?? []))
            .filter { $0.backdrop != nil }.prefix(20))
        AmbientStore.shared.resume = showing.first
        shared = await app.sharedWithMe()
        TopShelfStore.save(continueItems: showing, picks: personal.topPicks?.items ?? generalRows.first?.items ?? [])
        if let id = app.profile?.id {
            HomeSnapshot(continueItems: items, myList: myList, personal: personal, shared: shared, rows: rows).save(id)
        }
    }
}

// The personalized rows: Top Picks (recommendations shared by several of
// your titles score highest), "Because you watched/liked X", New Episodes.
enum Personal {
    struct Rows: Codable {
        var topPicks: LoadedRow?
        var because: [LoadedRow] = []
        var newEpisodes: LoadedRow?
    }

    struct Seed {
        let title: Title
        let verb: String
        let weight: Double
    }

    static func build(watched: [ContinueItem], loved: [Title], exclude: Set<String>, maturity: Maturity, name: String?) async -> Rows {
        let seeds = seeds(watched: watched, loved: loved)
        let recs: [String: [Title]] = await withTaskGroup(of: (String, [Title]).self) { group in
            for seed in seeds {
                guard let tmdbId = seed.title.tmdbId else { continue }
                let spec = RowSpec(id: "rec-\(seed.title.id)", title: "", kind: seed.title.kind,
                                   path: "\(seed.title.kind.tmdbPath)/\(tmdbId)/recommendations")
                group.addTask { (seed.title.id, await Catalog.load(spec, maturity: maturity)?.items ?? []) }
            }
            var all: [String: [Title]] = [:]
            for await (id, items) in group { all[id] = items }
            return all
        }
        return assemble(watched: watched, loved: loved, recommendations: recs, exclude: exclude, name: name)
    }

    // Up to 4 recent watches and 3 favourites seed the picks.
    static func seeds(watched: [ContinueItem], loved: [Title]) -> [Seed] {
        var seeds: [Seed] = []
        for (i, item) in watched.prefix(4).enumerated() { seeds.append(Seed(title: item.title, verb: "watched", weight: 1.0 - Double(i) * 0.12)) }
        for title in loved where !seeds.contains(where: { $0.title.id == title.id }) && seeds.count < 7 {
            seeds.append(Seed(title: title, verb: "liked", weight: 0.9))
        }
        return seeds
    }

    // The rows, from each seed's TMDB recommendations (keyed by the seed's id).
    static func assemble(watched: [ContinueItem], loved: [Title], recommendations: [String: [Title]],
                         exclude: Set<String>, name: String?) -> Rows {
        var rows = Rows()

        let fresh = watched.filter { $0.newEpisode != nil }.map { item -> Title in
            var title = item.title
            title.badge = "New \(item.newEpisode ?? "")"
            return title
        }
        if !fresh.isEmpty { rows.newEpisodes = LoadedRow(id: "new-episodes", title: "New Episodes", items: fresh) }

        let seeds = seeds(watched: watched, loved: loved)
        guard !seeds.isEmpty else { return rows }
        let seedIds = Set(seeds.map(\.title.id))

        var scores: [String: (title: Title, score: Double)] = [:]
        var usedInBecause = Set<String>()
        var usedFlavours = Set<String>()
        for seed in seeds {
            var seen = Set<String>()
            let candidates = (recommendations[seed.title.id] ?? []).filter {
                !exclude.contains($0.id) && !seedIds.contains($0.id) && seen.insert($0.id).inserted
            }
            for (position, title) in candidates.enumerated() {
                let add = seed.weight * (1 - Double(position) / 25)
                scores[title.id] = (title, (scores[title.id]?.score ?? 0) + add)
            }
            // Seeds that look alike (same language and main genre) share one
            // "Because you…" row, so two recent K-dramas don't fill the page.
            let flavour = "\(seed.title.originalLanguage ?? "")|\(seed.title.genre?.split(separator: ",").first.map(String.init) ?? "")"
            if rows.because.count < 4, candidates.count >= 5, usedFlavours.insert(flavour).inserted {
                // Titles leading an earlier row move to the back, so two rows
                // don't open with the same posters.
                let ordered = candidates.filter { !usedInBecause.contains($0.id) } + candidates.filter { usedInBecause.contains($0.id) }
                rows.because.append(LoadedRow(id: "because-\(seed.title.id)",
                                              title: "Because you \(seed.verb) \(seed.title.name)",
                                              items: ordered))
                ordered.prefix(3).forEach { usedInBecause.insert($0.id) }
            }
        }
        // After 4 titles in one non-English language, further ones are
        // nudged down so Top Picks stays a mix.
        var languageCount: [String: Int] = [:]
        let picks = scores.values.sorted { ($0.score, $1.title.id) > ($1.score, $0.title.id) }
            .map { entry -> (Title, Double) in
                let language = entry.title.originalLanguage ?? "en"
                let seen = languageCount[language, default: 0]
                languageCount[language] = seen + 1
                return (entry.title, entry.score - (language == "en" ? 0 : Double(max(0, seen - 3)) * 0.35))
            }
            .sorted { $0.1 > $1.1 }
            .map(\.0)
            .prefix(24)
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
                AnnouncementBanner()
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
        async let watched: [ContinueItem] = (try? await app.continueWatching()) ?? []
        async let loved = app.lovedTitles()
        async let watchedKeys = WatchedTitles.shared.load(app)
        let loaded = await Catalog.loadAll(Rows.browse(kind, kids: app.isKids), maturity: app.maturity)
        // Watched titles are never recommended (spotlight included).
        rows = WatchedTitles.without(loaded, await watchedKeys)
        loading = false
        // The seasonal row leads with what this profile likes.
        let taste = Seasonal.Taste(history: await watched.map(\.title) + loved)
        if let index = rows.firstIndex(where: { $0.id.hasPrefix("seasonal-") }), !taste.isEmpty {
            let row = rows[index]
            rows[index] = LoadedRow(id: row.id, title: row.title, items: Seasonal.sorted(row.items, for: taste))
        }
    }
}

// The big spotlight at the top of Home / Movies / Series.
struct HeroView: View {
    let title: Title
    @StateObject private var trailer = TrailerPlayer()
    @EnvironmentObject private var app: AppModel
    @FocusState private var infoFocused: Bool
    // The title's logo art as the headline (the title page's own TMDB
    // request, so opening it is instant too). The text shows when there's
    // no logo, or it takes longer than 0.9s.
    @State private var logo: UIImage?
    @State private var headlineReady = false

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            ZStack {
                RemoteImage(url: TMDB.resized(title.backdrop, TMDB.fullScreen)) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    Theme.surface
                }
                // 16:9 trailer scaled to cover the wide spotlight.
                TrailerLayer(player: trailer)
                    .frame(width: 1920 * 1.12, height: 1080 * 1.12)
                    .opacity(trailer.playing ? 1 : 0)
                    .animation(.easeIn(duration: 0.8), value: trailer.playing)
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
                Group {
                    if let logo {
                        Image(uiImage: logo)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 620, maxHeight: 190, alignment: .leading)
                            .accessibilityLabel(title.name)
                            .transition(.opacity)
                    } else {
                        Text(title.name)
                            .font(.system(size: 68, weight: .heavy))
                            .lineLimit(2)
                            .minimumScaleFactor(0.6)
                            .opacity(headlineReady ? 1 : 0)
                    }
                }
                .animation(.easeOut(duration: 0.3), value: logo != nil)
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
                .focused($infoFocused)
                .padding(.top, 8)
            }
            .frame(maxWidth: 860, alignment: .leading)
            .padding(.bottom, 40)
        }
        .focusSection()
        .task(id: title.id) {
            trailer.stop()
            await trailer.start(title)
        }
        .task(id: "logo-\(title.id)") {
            logo = nil
            headlineReady = false
            async let image = HeroLogo.load(title)
            let timeout = Task { try? await Task.sleep(for: .milliseconds(900)); headlineReady = true }
            if let found = await image, !Task.isCancelled { logo = found }
            timeout.cancel()
            headlineReady = true
        }
        .onDisappear { trailer.stop() }
        // Resting on the spotlight preloads it, like a card.
        .task(id: infoFocused ? title.id : "") {
            guard infoFocused else { return }
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { app.preload(title) }
        }
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
                        Text([label, item.seasonNote].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.muted).lineLimit(1)
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
        .buttonStyle(.focusCard)
    }
}

extension ContinueItem {
    var playRequest: PlayRequest {
        PlayRequest(title: title, season: title.kind == .tvShow ? (season ?? 1) : nil,
                    episode: title.kind == .tvShow ? (episode ?? 1) : nil,
                    startAt: ResumeRule.start(position: position, duration: duration))
    }
}

enum HeroLogo {
    // The same request the title page makes (TMDB caches it), then the
    // logo's image, sized for the spotlight.
    static func load(_ title: Title) async -> UIImage? {
        guard let tmdbId = title.tmdbId,
              let details: TMDBDetails = try? await TMDB.shared.get("\(title.kind.tmdbPath)/\(tmdbId)",
                                                                   ["append_to_response": "credits,images", "include_image_language": "en,null"]),
              let url = TMDB.image(details.logoPath, "w780") else { return nil }
        return await ImageStore.shared.load(url, pixels: 1240)
    }
}
