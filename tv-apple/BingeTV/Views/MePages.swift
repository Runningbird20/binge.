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

// MARK: - Playback settings

struct PlaybackSettingsView: View {
    @EnvironmentObject private var app: AppModel
    @AppStorage("binge.trailers") private var trailers = true
    @AppStorage("binge.quality") private var quality = QualityPreference.best.rawValue
    @AppStorage("binge.captionSize") private var captionSize = 100
    @AppStorage("binge.captionBackground") private var captionBackground = "rgba(0,0,0,0.6)"
    @AppStorage("binge.audioDescription") private var audioDescription = false
    @AppStorage("binge.largeText") private var largeText = false
    @State private var audio = PlaybackPrefs.audio
    @State private var subtitle = PlaybackPrefs.subtitle

    var body: some View {
        ScrollView {
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
            group("Quality", "Best quality looks for a sharper stream, up to 4K, for a few seconds after a video starts.") {
                ForEach(QualityPreference.allCases) { option in
                    Button(option.label) { quality = option.rawValue }
                        .buttonStyle(PillButtonStyle(selected: quality == option.rawValue))
                }
            }
            group("Subtitle size", "How big subtitles are drawn over the video.") {
                ForEach(PlaybackPrefs.captionSizes, id: \.0) { size, label in
                    Button(label) { captionSize = size }.buttonStyle(PillButtonStyle(selected: captionSize == size))
                }
            }
            group("Subtitle background", "A box behind the words makes them easier to read on bright scenes.") {
                ForEach(PlaybackPrefs.captionBackgrounds, id: \.0) { value, label in
                    Button(label) { captionBackground = value }.buttonStyle(PillButtonStyle(selected: captionBackground == value))
                }
            }
            group("Audio description", "Picks a described audio track automatically when a server has one.") {
                Button("On") { audioDescription = true }.buttonStyle(PillButtonStyle(selected: audioDescription))
                Button("Off") { audioDescription = false }.buttonStyle(PillButtonStyle(selected: !audioDescription))
            }
            group("Larger text", "Bigger text across the whole app.") {
                Button("On") { largeText = true }.buttonStyle(PillButtonStyle(selected: largeText))
                Button("Off") { largeText = false }.buttonStyle(PillButtonStyle(selected: !largeText))
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
        .scrollClipDisabled()
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
