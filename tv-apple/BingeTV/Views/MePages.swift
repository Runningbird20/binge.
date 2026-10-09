import SwiftUI

// The website's History, Calendar and Wrapped pages, plus playback
// settings, under the Me tab.

// MARK: - History

struct HistoryView: View {
    @EnvironmentObject private var app: AppModel
    @State private var items: [(ContinueItem, Date?)] = []
    @State private var loaded = false
    @State private var playing: PlayRequest?
    @State private var detail: Title?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                Text("History").font(.system(size: 54, weight: .heavy))
                Text("Everything you've started, newest first. Press and hold to remove something.")
                    .font(.callout).foregroundStyle(Theme.muted)
                if !loaded {
                    HStack(spacing: 40) {
                        ForEach(0..<4, id: \.self) { _ in RoundedRectangle(cornerRadius: 12).fill(Theme.surface).frame(width: 420, height: 236) }
                    }
                    .accessibilityHidden(true)
                }
                if loaded && items.isEmpty {
                    Text("Nothing here yet. Anything you start playing on the TV, phone or web shows up here.").foregroundStyle(Theme.muted)
                }
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(420), spacing: 40), count: 4), alignment: .leading, spacing: 50) {
                    ForEach(items, id: \.0.id) { item, date in
                        VStack(alignment: .leading, spacing: 10) {
                            ContinueCard(item: item) { playing = item.playRequest }
                                .contextMenu {
                                    Button { detail = item.title } label: { Label("Details", systemImage: "info.circle") }
                                    Button(role: .destructive) { remove(item) } label: { Label("Remove from history", systemImage: "trash") }
                                }
                            if let date {
                                Text(date.formatted(.relative(presentation: .named)))
                                    .font(.caption).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
            }
            .padding(.vertical, 30)
        }
        .scrollClipDisabled()
        .navigationDestination(item: $detail) { TitleDetailView(title: $0) }
        .fullScreenCover(item: $playing) { PlayerView(request: $0, app: app) }
        .task { await load() }
    }

    private func load() async {
        let rows: [ContinueRow] = (try? await Supabase.shared.select("continue_watching", [
            URLQueryItem(name: "select", value: ContinueRow.columns),
            URLQueryItem(name: "media_type", value: "in.(movie,tv_show)"),
            URLQueryItem(name: "order", value: "updated_at.desc"),
            URLQueryItem(name: "limit", value: "120"),
        ] + app.ownerQuery)) ?? []
        async let movies = Catalog.titles(.movie, ids: rows.filter { $0.mediaType == "movie" }.map(\.mediaId))
        async let shows = Catalog.titles(.tvShow, ids: rows.filter { $0.mediaType == "tv_show" }.map(\.mediaId))
        let (m, t) = ((try? await movies) ?? [:], (try? await shows) ?? [:])
        var seen = Set<String>()
        items = rows.compactMap { row in
            guard let title = row.mediaType == "movie" ? m[row.mediaId] : t[row.mediaId], seen.insert(title.id).inserted else { return nil }
            return (ContinueItem(title: title, season: row.currentSeason, episode: row.currentEpisode,
                                 position: row.positionSeconds, duration: row.durationSeconds), row.updatedDate)
        }
        loaded = true
    }

    // Same as the site: removes the progress and the watched episodes.
    private func remove(_ item: ContinueItem) {
        items.removeAll { $0.0.id == item.id }
        Task {
            await app.removeFromContinue(item.title)
            if item.title.kind == .tvShow {
                try? await Supabase.shared.delete("episode_progress", [
                    URLQueryItem(name: "media_id", value: "eq.\(item.title.dbId)"),
                ] + app.ownerQuery)
            }
        }
    }
}

// MARK: - Calendar

struct CalendarView: View {
    @EnvironmentObject private var app: AppModel
    @State private var days: [(Date, [(Title, String)])] = []
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 34) {
                Text("Release calendar").font(.system(size: 54, weight: .heavy))
                Text("New episodes of what you watch and your list, and movies you're waiting for.")
                    .font(.callout).foregroundStyle(Theme.muted)
                if !loaded { RowSkeleton(); RowSkeleton() }
                if loaded && days.isEmpty {
                    Text("Nothing scheduled yet. Add shows to My List to see their next episodes here.").foregroundStyle(Theme.muted)
                }
                ForEach(days, id: \.0) { day, entries in
                    VStack(alignment: .leading, spacing: 4) {
                        SectionTitle(text: Self.dayLabel(day))
                        ScrollView(.horizontal) {
                            LazyHStack(alignment: .top, spacing: 40) {
                                ForEach(entries, id: \.0.id) { title, label in
                                    VStack(alignment: .leading, spacing: 10) {
                                        PosterCard(title: title)
                                        Text(label).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                                            .frame(width: 220, alignment: .leading)
                                    }
                                }
                            }
                            .padding(.vertical, 30)
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
        .titleDestinations()
        .task { await load() }
    }

    static func dayLabel(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        return date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }

    private func load() async {
        let continuing = ((try? await app.continueWatching()) ?? []).map(\.title)
        let list = (try? await app.myList()) ?? []
        var seen = Set<String>()
        let titles = (continuing + list).filter { seen.insert($0.id).inserted && $0.tmdbId != nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let today = Calendar.current.startOfDay(for: Date())

        let found: [(Date, Title, String)] = await withTaskGroup(of: (Date, Title, String)?.self) { group in
            for title in titles {
                group.addTask {
                    guard let tmdbId = title.tmdbId,
                          let details: TMDBDetails = try? await TMDB.shared.get("\(title.kind.tmdbPath)/\(tmdbId)") else { return nil }
                    if title.kind == .tvShow, let next = details.nextEpisodeToAir, let date = next.airDate.flatMap(formatter.date) {
                        return (date, title, "S\(next.seasonNumber):E\(next.episodeNumber)" + (next.name.map { " · \($0)" } ?? ""))
                    }
                    if title.kind == .movie, let date = details.releaseDate.flatMap(formatter.date), date >= today {
                        return (date, title, "In theaters / out")
                    }
                    return nil
                }
            }
            var out: [(Date, Title, String)] = []
            for await entry in group { if let entry, entry.0 >= today { out.append(entry) } }
            return out
        }
        let grouped = Dictionary(grouping: found, by: { Calendar.current.startOfDay(for: $0.0) })
        days = grouped.keys.sorted().prefix(30).map { day in (day, grouped[day]!.map { ($0.1, $0.2) }) }
        loaded = true
    }
}

// MARK: - Wrapped

struct WrappedView: View {
    @EnvironmentObject private var app: AppModel
    @State private var stats: Stats?
    private let year = Calendar.current.component(.year, from: Date())

    struct Stats {
        var titles = 0, episodes = 0, movies = 0, minutes = 0, ratings = 0
        var genres: [String] = []
        var topShow: Title?
        var topShowEpisodes = 0
        var favorite: (Title, Double)?
    }

    // A story is one sentence with its fact in bold: no labels, no giant
    // numbers (same rewrite as the website's Wrapped).
    private struct Story: Identifiable {
        let id: String
        let sentence: Text
        var detail: String?
        var poster: URL?
    }

    private func bold(_ text: String) -> Text { Text(text).fontWeight(.heavy).foregroundColor(.white) }

    private var stories: [Story] {
        guard let stats else { return [] }
        let name = app.profile?.name ?? "Hey"
        var list = [
            Story(id: "intro", sentence: Text("\(name), here’s ") + bold("your year") + Text(" on binge.")),
            Story(id: "time", sentence: Text("You spent ") + bold("\(stats.minutes / 60) hours") + Text(" watching this year."),
                  detail: "\(stats.episodes) episodes and \(stats.movies) movies, across \(stats.titles) titles."),
        ]
        if let show = stats.topShow {
            list.append(Story(id: "show", sentence: bold(show.name) + Text(" was your show."),
                              detail: "You watched \(stats.topShowEpisodes) episodes of it.", poster: show.poster))
        }
        if let favorite = stats.favorite {
            list.append(Story(id: "fav", sentence: bold(favorite.0.name) + Text(" got your best rating."),
                              detail: "Rated \(Int(favorite.1.rounded())) out of 5.", poster: favorite.0.poster))
        }
        let genres = Array(stats.genres.prefix(3))
        if !genres.isEmpty {
            var sentence = Text("You kept coming back to ")
            for (index, genre) in genres.enumerated() {
                if index > 0 { sentence = sentence + Text(index == genres.count - 1 ? " and " : ", ") }
                sentence = sentence + bold(genre)
            }
            list.append(Story(id: "genres", sentence: sentence + Text(".")))
        }
        if stats.ratings > 0 {
            list.append(Story(id: "ratings", sentence: Text("You rated ") + bold("\(stats.ratings) titles") + Text(", and binge. learned from every one.")))
        }
        return list
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                Text("Your \(String(year)) on binge.").font(.system(size: 54, weight: .heavy))
                ScrollView(.horizontal) {
                    HStack(spacing: 40) {
                        if stats == nil {
                            ForEach(0..<3, id: \.self) { _ in
                                RoundedRectangle(cornerRadius: 16).fill(Theme.surface).frame(width: 640, height: 480)
                            }
                        } else if stats?.titles == 0 {
                            storyCard(Story(id: "empty", sentence: Text("Your story starts with ") + bold("one show") + Text("."),
                                            detail: "Watch or rate a few things this year and your recap builds itself here."))
                        } else {
                            ForEach(stories) { storyCard($0) }
                        }
                    }
                    .padding(.vertical, 30)
                }
                .scrollClipDisabled()
                Text("Watch time is estimated (45 min an episode, 110 a movie), like the website.")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
            .padding(.vertical, 30)
        }
        .scrollClipDisabled()
        .task { await load() }
    }

    private func storyCard(_ story: Story) -> some View {
        Button {} label: {
            ZStack(alignment: .bottomLeading) {
                Theme.surface
                if let poster = story.poster {
                    AsyncImage(url: poster) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color.clear }
                        .opacity(0.28)
                }
                VStack(alignment: .leading, spacing: 18) {
                    story.sentence
                        .font(.system(size: 46, weight: .medium))
                        .foregroundColor(.white.opacity(0.78))
                        .lineLimit(5)
                        .minimumScaleFactor(0.7)
                    if let detail = story.detail {
                        Text(detail).font(.callout).foregroundStyle(.white.opacity(0.8))
                    }
                }
                .padding(40)
            }
            .frame(width: 640, height: 480)
            .clipped()
        }
        .buttonStyle(.card)
    }

    private func load() async {
        let start = ISO8601DateFormatter().string(from: Calendar.current.date(from: DateComponents(year: year, month: 1, day: 1))!)
        struct Progress: Decodable { let mediaId: Int }
        struct Cw: Decodable { let mediaType: String; let mediaId: Int }
        struct Rating: Decodable {
            let mediaId: Int
            let acting, writing, originality, pacing, cinematography, premise, resonance: Double?
            var average: Double { let v = [acting, writing, originality, pacing, cinematography, premise, resonance].compactMap { $0 }; return v.isEmpty ? 0 : v.reduce(0, +) / Double(v.count) }
        }
        async let progressRows: [Progress]? = try? Supabase.shared.select("episode_progress", [
            URLQueryItem(name: "select", value: "media_id"), URLQueryItem(name: "watched_at", value: "gte.\(start)"),
            URLQueryItem(name: "limit", value: "5000"),
        ] + app.ownerQuery)
        async let cwRows: [Cw]? = try? Supabase.shared.select("continue_watching", [
            URLQueryItem(name: "select", value: "media_type,media_id"), URLQueryItem(name: "updated_at", value: "gte.\(start)"),
            URLQueryItem(name: "media_type", value: "in.(movie,tv_show)"),
        ] + app.ownerQuery)
        async let movieRatings: [Rating]? = try? Supabase.shared.select("movie_ratings", [
            URLQueryItem(name: "select", value: "media_id,acting,writing,originality,pacing,cinematography"),
            URLQueryItem(name: "created_at", value: "gte.\(start)"),
        ] + app.ownerQuery)
        async let showRatings: [Rating]? = try? Supabase.shared.select("tv_show_ratings", [
            URLQueryItem(name: "select", value: "media_id,premise,originality,acting,cinematography,writing,pacing,resonance"),
            URLQueryItem(name: "created_at", value: "gte.\(start)"),
        ] + app.ownerQuery)
        let (progress, cw, mr, sr) = await (progressRows ?? [], cwRows ?? [], movieRatings ?? [], showRatings ?? [])

        var stats = Stats()
        let movieIds = Set(cw.filter { $0.mediaType == "movie" }.map(\.mediaId)).union(mr.map(\.mediaId))
        let showIds = Set(cw.filter { $0.mediaType == "tv_show" }.map(\.mediaId)).union(progress.map(\.mediaId)).union(sr.map(\.mediaId))
        stats.episodes = progress.count
        stats.movies = movieIds.count
        stats.titles = movieIds.count + showIds.count
        stats.ratings = mr.count + sr.count
        stats.minutes = stats.episodes * 45 + stats.movies * 110

        let movies = (try? await Catalog.titles(.movie, ids: Array(movieIds))) ?? [:]
        let shows = (try? await Catalog.titles(.tvShow, ids: Array(showIds))) ?? [:]
        let counts = Dictionary(grouping: progress, by: \.mediaId).mapValues(\.count)
        if let top = counts.max(by: { $0.value < $1.value }), let show = shows[top.key] {
            stats.topShow = show
            stats.topShowEpisodes = top.value
        }
        let rated = mr.compactMap { r in movies[r.mediaId].map { ($0, r.average) } } + sr.compactMap { r in shows[r.mediaId].map { ($0, r.average) } }
        stats.favorite = rated.max { $0.1 < $1.1 }
        var genreCounts: [String: Int] = [:]
        for title in Array(movies.values) + Array(shows.values) {
            for genre in (title.genre ?? "").split(separator: ",") {
                genreCounts[genre.trimmingCharacters(in: .whitespaces), default: 0] += 1
            }
        }
        stats.genres = genreCounts.sorted { $0.value > $1.value }.map(\.key).filter { !$0.isEmpty }
        self.stats = stats
    }
}

// MARK: - Playback settings

struct PlaybackSettingsView: View {
    @EnvironmentObject private var app: AppModel
    @AppStorage("binge.trailers") private var trailers = true
    @State private var audio = PlaybackPrefs.audio
    @State private var subtitle = PlaybackPrefs.subtitle

    var body: some View {
        VStack(alignment: .leading, spacing: 40) {
            Text("Playback").font(.system(size: 54, weight: .heavy))
            group("Audio language", "Servers viewers reported in this language are tried first.") {
                ForEach(PlaybackPrefs.audioChoices, id: \.0) { code, label in
                    Button(label) {
                        audio = code
                        Task { await app.savePrefs(audio: code) }
                    }
                    .buttonStyle(PillButtonStyle(selected: audio == code))
                }
            }
            group("Subtitles", "Requested from servers that support it (CineSrc).") {
                ForEach(PlaybackPrefs.subtitleChoices, id: \.0) { code, label in
                    Button(label) {
                        subtitle = code
                        Task { await app.savePrefs(subtitle: code) }
                    }
                    .buttonStyle(PillButtonStyle(selected: subtitle == code))
                }
            }
            group("Trailers", "Muted trailers in the Home spotlight.") {
                Button("On") { trailers = true }.buttonStyle(PillButtonStyle(selected: trailers))
                Button("Off") { trailers = false }.buttonStyle(PillButtonStyle(selected: !trailers))
            }
            Text("Saved to your profile, so the website uses them too.").font(.caption).foregroundStyle(Theme.muted)
        }
        .padding(.vertical, 30)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func group<Content: View>(_ title: String, _ note: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 18) {
                Text(title).font(.title3.weight(.bold))
                Text(note).font(.caption).foregroundStyle(Theme.muted)
            }
            ScrollView(.horizontal) {
                HStack(spacing: 20) { content() }.padding(.vertical, 14)
            }
            .scrollClipDisabled()
        }
        .focusSection()
    }
}
