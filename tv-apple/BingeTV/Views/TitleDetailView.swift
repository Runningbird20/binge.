import SwiftUI

struct Handoff: Identifiable {
    let id = UUID()
    let heading: String
    let detail: String
    let url: URL
}

struct TitleDetailView: View {
    @EnvironmentObject private var app: AppModel
    let title: Title

    @State private var details: TMDBDetails?
    @State private var resume: ContinueRow?
    @State private var season: Int?
    @State private var episodes: [TMDBSeason.Episode] = []
    @State private var more: [Title] = []
    @State private var handoff: Handoff?
    @State private var playing: PlayRequest?
    @State private var listBusy = false
    @State private var listError: String?
    @State private var outside: OutsideRatings?
    @State private var myStars: Double?
    @State private var rating = false
    @State private var sending = false
    @State private var sentTo: String?
    @State private var heatmap: [(season: Int, episodes: [TMDBSeason.Episode])] = []
    @State private var franchise: Franchises.Order?
    @State private var previously: [TMDBSeason.Episode] = []
    @FocusState private var playFocused: Bool
    // Episodes watched or marked, and the last marking (with its undo).
    @State private var watchedEpisodes: Set<EpisodeKey> = []
    @State private var markNote: MarkNote?
    @State private var marking = false
    @State private var reminderSet = false
    @State private var reminderError: String?

    struct MarkNote: Identifiable {
        let id = UUID()
        let text: String
        let undo: () async -> Void
    }

    private var lastAired: EpisodeKey? {
        details?.lastEpisodeToAir.map { EpisodeKey(season: $0.seasonNumber, episode: $0.episodeNumber) }
    }

    private var seasons: [TMDBDetails.Season] {
        let all = (details?.seasons ?? []).filter { ($0.episodeCount ?? 0) > 0 }
        let regular = all.filter { $0.seasonNumber > 0 }
        return regular.isEmpty ? all : regular
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 46) {
                header
                    .frame(minHeight: 760, alignment: .bottomLeading)
                if !previously.isEmpty {
                    PreviouslyOn(episodes: previously) { episode in
                        start(season: episode.seasonNumber, episode: episode.episodeNumber, name: episode.name)
                    }
                }
                if title.kind == .tvShow && !seasons.isEmpty {
                    episodesSection
                }
                let people = People.forTitle(details, kind: title.kind)
                if !people.isEmpty {
                    CastRow(people: people)
                }
                if let franchise {
                    FranchiseSection(order: franchise)
                }
                if !more.isEmpty {
                    TitleRowView(row: LoadedRow(id: "more", title: "More Like This", items: more))
                }
                if heatmap.count > 0, heatmap.flatMap(\.episodes).count > 3 {
                    EpisodeHeatmap(seasons: heatmap,
                                   current: resume.flatMap { r in r.currentSeason.flatMap { s in r.currentEpisode.map { (s, $0) } } })
                }
            }
            .padding(.bottom, 80)
        }
        .scrollClipDisabled()
        .fullScreenCover(item: $playing, onDismiss: { Task { resume = await app.resumePoint(for: title) } }) {
            PlayerView(request: $0, app: app)
        }
        .background(alignment: .top) { backdrop }
        .sheet(isPresented: $rating) {
            RateView(title: title, current: myStars) { stars in myStars = Double(stars) }
        }
        .fullScreenCover(item: $handoff) { HandoffView(handoff: $0) }
        .task { await load() }
        .task(id: season) { await loadEpisodes() }
    }

    // MARK: Header

    private var backdrop: some View {
        RemoteImage(url: TMDB.image(details?.backdropPath, TMDB.fullScreen) ?? TMDB.resized(title.backdrop, TMDB.fullScreen)) { image in
            image.resizable().aspectRatio(contentMode: .fill)
        } placeholder: {
            Theme.background
        }
        .frame(height: 1080)
        .frame(maxWidth: .infinity)
        .clipped()
        .overlay {
            LinearGradient(colors: [Theme.background, Theme.background.opacity(0.75), .clear],
                           startPoint: .leading, endPoint: .trailing)
        }
        .overlay {
            LinearGradient(colors: [.clear, Theme.background], startPoint: .init(x: 0.5, y: 0.45), endPoint: .bottom)
        }
        .ignoresSafeArea()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 24) {
            if let logo = TMDB.image(details?.logoPath, TMDB.fullScreen) {
                RemoteImage(url: logo) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    titleText.hidden()
                }
                .frame(maxWidth: 620, maxHeight: 200, alignment: .leading)
                .accessibilityLabel(title.name)
            } else {
                titleText
            }

            Text(metaLine)
                .font(.callout.weight(.semibold))
                .foregroundStyle(Theme.muted)

            if outside != nil || myStars != nil {
                HStack(spacing: 30) {
                    if let outside { OutsideRatingsRow(ratings: outside) }
                    if let myStars {
                        Label("You rated it \(Int(myStars.rounded())) of 5", systemImage: "star.fill")
                            .font(.callout.weight(.bold))
                            .foregroundStyle(Theme.gold)
                    }
                }
            }

            if let tagline = details?.tagline, !tagline.isEmpty {
                Text(tagline).font(.headline).italic().foregroundStyle(.white.opacity(0.85))
            }

            if let overview = details?.overview ?? title.overview, !overview.isEmpty {
                Text(overview)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.88))
                    .lineLimit(5)
                    .frame(maxWidth: 1000, alignment: .leading)
            }

            if let cast = details?.credits?.cast.prefix(5).map(\.name), !cast.isEmpty {
                Text("Starring \(cast.joined(separator: ", "))")
                    .font(.callout)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .frame(maxWidth: 1000, alignment: .leading)
            }

            HStack(spacing: 28) {
                Button { play() } label: {
                    Label(playLabel, systemImage: "play.fill")
                }
                .buttonStyle(ActionButtonStyle(primary: true))
                .focused($playFocused)

                Button { toggleList() } label: {
                    Label(app.isInList(title) ? "In My List" : "My List",
                          systemImage: app.isInList(title) ? "checkmark" : "plus")
                }
                .buttonStyle(ActionButtonStyle())
                .disabled(listBusy || !app.isSignedIn)

                Button { rating = true } label: {
                    Label(myStars == nil ? "Rate" : "Rated", systemImage: myStars == nil ? "star" : "star.fill")
                }
                .buttonStyle(ActionButtonStyle())
                .disabled(!app.isSignedIn)

                // Household queue: put it in another profile's "Sent to you".
                if app.isSignedIn, app.profiles.count > 1 {
                    Button { sending = true } label: {
                        Label(sentTo.map { "Sent to \($0)" } ?? "Send to…", systemImage: sentTo == nil ? "paperplane" : "checkmark")
                    }
                    .buttonStyle(ActionButtonStyle())
                    .confirmationDialog("Send \(title.name) to", isPresented: $sending, titleVisibility: .visible) {
                        ForEach(app.profiles.filter { $0.id != app.profile?.id }) { profile in
                            Button(profile.name) {
                                Task {
                                    if (try? await app.send(title, to: profile)) != nil { sentTo = profile.name }
                                }
                            }
                        }
                    }
                }

                // Not out yet (a movie, or a series' next episode): remind
                // this profile on the day (Home shows it; phones get a push).
                if app.isSignedIn, let upcoming = ReleaseReminder.upcoming(title, details: details) {
                    Button { remind(at: upcoming.at) } label: {
                        Label(reminderSet ? "Reminder set" : upcoming.label, systemImage: reminderSet ? "bell.fill" : "bell")
                    }
                    .buttonStyle(ActionButtonStyle())
                    .disabled(reminderSet)
                }

                if let progress = resumeProgress {
                    ProgressView(value: progress)
                        .tint(Theme.gold)
                        .frame(width: 220)
                }
            }
            .padding(.top, 10)
            .focusSection()

            if let error = listError ?? reminderError {
                Text(error).font(.caption).foregroundStyle(Color(hex: 0xFFB4A8))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleText: some View {
        Text(title.name)
            .font(.system(size: 76, weight: .heavy))
            .lineLimit(2)
            .minimumScaleFactor(0.5)
            .frame(maxWidth: 1100, alignment: .leading)
    }

    private var metaLine: String {
        var parts: [String] = []
        if let year = title.year { parts.append(String(year)) }
        if let vote = details?.voteAverage, vote > 0 { parts.append(String(format: "TMDB %.1f", vote)) }
        if let runtime = details?.runtime, runtime > 0 {
            parts.append(runtime >= 60 ? "\(runtime / 60)h \(runtime % 60)m" : "\(runtime)m")
        }
        if let count = details?.numberOfSeasons, count > 0 { parts.append(count == 1 ? "1 season" : "\(count) seasons") }
        if let rating = title.ageRating { parts.append(rating) }
        let genres = details?.genres?.prefix(3).map(\.name) ?? []
        if !genres.isEmpty { parts.append(genres.joined(separator: ", ")) }
        if title.comingSoon { parts.append("Coming soon") }
        return parts.joined(separator: "  ·  ")
    }

    private var resumeProgress: Double? {
        guard let duration = resume?.durationSeconds, duration > 0,
              let position = ResumeRule.start(position: resume?.positionSeconds, duration: duration) else { return nil }
        return min(1, position / duration)
    }

    private var playLabel: String {
        if title.kind == .tvShow, let s = resume?.currentSeason, let e = resume?.currentEpisode {
            return "Resume S\(s):E\(e)"
        }
        if resumeProgress != nil { return "Resume" }
        return title.kind == .tvShow ? "Play S1:E1" : "Play"
    }

    // MARK: Episodes

    private var episodesSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            ScrollView(.horizontal) {
                HStack(spacing: 24) {
                    if app.isSignedIn, let season, !episodes.isEmpty {
                        let aired = EpisodeMarking.season(season, episodes: episodes, lastAired: lastAired)
                        let done = !aired.isEmpty && aired.allSatisfy(watchedEpisodes.contains)
                        Button {
                            done ? unmark(aired, note: "Season \(season) marked as not watched")
                                 : mark(aired, note: "Season \(season) marked as watched")
                        } label: {
                            Label(done ? "Season watched" : "Mark season watched", systemImage: done ? "checkmark.circle.fill" : "checkmark.circle")
                        }
                        .buttonStyle(PillButtonStyle(selected: done))
                        .disabled(marking || aired.isEmpty)
                    }
                    ForEach(seasons) { entry in
                        Button {
                            season = entry.seasonNumber
                        } label: {
                            Text(entry.name ?? "Season \(entry.seasonNumber)")
                        }
                        .buttonStyle(PillButtonStyle(selected: season == entry.seasonNumber))
                    }
                }
                .padding(.vertical, 20)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .focusSection()

            if let markNote {
                HStack(spacing: 24) {
                    Text(markNote.text).font(.callout.weight(.semibold))
                    Button("Undo") {
                        self.markNote = nil
                        Task { await markNote.undo() }
                    }
                    .buttonStyle(PillButtonStyle())
                }
                .focusSection()
                .task(id: markNote.id) {
                    try? await Task.sleep(for: .seconds(10))
                    if self.markNote?.id == markNote.id { self.markNote = nil }
                }
            }

            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 40) {
                    ForEach(episodes) { episode in
                        let key = EpisodeKey(season: episode.seasonNumber, episode: episode.episodeNumber)
                        let watched = watchedEpisodes.contains(key)
                        EpisodeCard(episode: episode, fallback: title.backdrop,
                                    isCurrent: episode.seasonNumber == resume?.currentSeason && episode.episodeNumber == resume?.currentEpisode,
                                    watched: watched) {
                            start(season: episode.seasonNumber, episode: episode.episodeNumber, name: episode.name)
                        }
                        .contextMenu {
                            Button { start(season: episode.seasonNumber, episode: episode.episodeNumber, name: episode.name) } label: {
                                Label("Play", systemImage: "play.fill")
                            }
                            if app.isSignedIn {
                                if watched {
                                    Button { unmark([key], note: "S\(key.season):E\(key.episode) marked as not watched") } label: {
                                        Label("Mark as not watched", systemImage: "circle")
                                    }
                                } else {
                                    Button {
                                        mark(EpisodeMarking.upTo(key, seasons: seasons, lastAired: lastAired),
                                             note: "Watched up to S\(key.season):E\(key.episode)")
                                    } label: {
                                        Label("Watched up to here", systemImage: "checkmark.circle")
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 30)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .focusSection()
        }
    }

    // MARK: Actions

    private func play() {
        if title.kind == .tvShow {
            let s = resume?.currentSeason ?? seasons.first?.seasonNumber ?? 1
            let e = resume?.currentEpisode ?? 1
            start(season: s, episode: e, name: nil)
        } else {
            start(season: nil, episode: nil, name: nil)
        }
    }

    // Plays on the TV. The phone handoff is only a fallback for a tvOS
    // without the web view, or a title with no streaming id.
    private func start(season: Int?, episode: Int?, name: String?) {
        let sameAsResume = title.kind == .movie || (season == resume?.currentSeason && episode == resume?.currentEpisode)
        let startAt = sameAsResume ? ResumeRule.start(position: resume?.positionSeconds, duration: resume?.durationSeconds) : nil
        if WebEngines.isAvailable, title.tmdbId != nil {
            playing = PlayRequest(title: title, season: season, episode: episode, startAt: startAt, seasons: seasons)
            return
        }
        let label = season.map { "S\($0):E\(episode ?? 1)" + (name.map { " · \($0)" } ?? "") } ?? "Starts on your phone."
        handoff = Handoff(heading: "Watch \(title.name)", detail: label,
                          url: title.watchURL(season: season, episode: episode, seconds: startAt))
    }

    // MARK: Marking episodes (the website's utils/episodeMarking.js)

    private func mark(_ episodes: [EpisodeKey], note: String) {
        let added = episodes.filter { !watchedEpisodes.contains($0) }
        guard !added.isEmpty else { return }
        marking = true
        watchedEpisodes.formUnion(added)
        Task {
            defer { marking = false }
            do {
                try await app.markEpisodes(title, added)
            } catch {
                watchedEpisodes.subtract(added)
                if !app.handle(error) { listError = "Couldn't save those episodes. Try again." }
                return
            }
            // Caught up past where Continue Watching points: it moves on to
            // the next aired episode.
            let before = resume
            var moved = false
            if let before, let s = before.currentSeason, let e = before.currentEpisode,
               let furthest = episodes.max(by: { ($0.season, $0.episode) < ($1.season, $1.episode) }),
               (s, e) <= (furthest.season, furthest.episode),
               let next = EpisodeMarking.next(after: episodes, seasons: seasons, lastAired: lastAired) {
                await app.setResumeEpisode(title, to: next)
                moved = true
                resume = await app.resumePoint(for: title)
            }
            markNote = MarkNote(text: note) {
                watchedEpisodes.subtract(added)
                try? await app.unmarkEpisodes(title, added)
                if moved, let before { await app.setResumeEpisode(title, to: nil, restoring: before) }
                resume = await app.resumePoint(for: title)
            }
        }
    }

    private func unmark(_ episodes: [EpisodeKey], note: String) {
        let removed = episodes.filter { watchedEpisodes.contains($0) }
        guard !removed.isEmpty else { return }
        marking = true
        Task {
            defer { marking = false }
            let times = await app.episodeTimes(title, removed)
            watchedEpisodes.subtract(removed)
            do {
                try await app.unmarkEpisodes(title, removed)
            } catch {
                watchedEpisodes.formUnion(removed)
                if !app.handle(error) { listError = "Couldn't update those episodes. Try again." }
                return
            }
            markNote = MarkNote(text: note) {
                watchedEpisodes.formUnion(removed)
                try? await app.markEpisodes(title, removed, watchedAt: times)
            }
        }
    }

    private func remind(at when: Date) {
        reminderError = nil
        Task {
            do {
                try await app.addReminder(title, at: when)
                reminderSet = true
            } catch {
                if !app.handle(error) { reminderError = "Couldn't set that reminder. Try again." }
            }
        }
    }

    private func toggleList() {
        listBusy = true
        listError = nil
        Task {
            do {
                try await app.toggleList(title)
            } catch {
                if !app.handle(error) { listError = error.localizedDescription }
            }
            listBusy = false
        }
    }

    // MARK: Loading

    private func load() async {
        playFocused = true
        async let resumeRow = app.resumePoint(for: title)
        if let tmdbId = title.tmdbId {
            details = try? await TMDB.shared.get("\(title.kind.tmdbPath)/\(tmdbId)",
                                                 ["append_to_response": "credits,images", "include_image_language": "en,null"])
        }
        resume = await resumeRow
        if title.kind == .tvShow, season == nil {
            season = resume?.currentSeason ?? seasons.first?.seasonNumber
        }
        warmUp()
        if title.kind == .tvShow { watchedEpisodes = await app.watchedEpisodes(title) }
        reminderSet = await app.reminders(dueOnly: false).contains { $0.mediaType == title.kind.rawValue && $0.mediaId == title.dbId }
        async let outsideTask = OutsideRatings.load(title)
        async let starsTask = app.myRating(for: title)
        async let franchiseTask = Franchises.find(for: title, maturity: app.maturity)
        if title.kind == .tvShow, let tmdbId = title.tmdbId {
            await loadPreviously(tmdbId: tmdbId)
            heatmap = await EpisodeHeatmap.load(tmdbId: tmdbId, seasons: seasons)
        }
        (outside, myStars, franchise) = await (outsideTask, starsTask, franchiseTask)
        if let tmdbId = title.tmdbId {
            let spec = RowSpec(id: "more", title: "More Like This", kind: title.kind,
                               path: "\(title.kind.tmdbPath)/\(tmdbId)/recommendations")
            // Watched titles are never recommended.
            async let watched = WatchedTitles.shared.load(app)
            let found = await Catalog.load(spec, maturity: app.maturity)?.items.filter { $0.id != title.id } ?? []
            more = WatchedTitles.without(found, await watched)
        }
    }

    // "Previously on…": back after 14+ days, show the 3 episodes before
    // the one you're on.
    private func loadPreviously(tmdbId: Int) async {
        guard let resume, let updated = resume.updatedDate, Date().timeIntervalSince(updated) > 14 * 86_400,
              let season = resume.currentSeason, let episode = resume.currentEpisode, episode + season > 2 else { return }
        var collected: [TMDBSeason.Episode] = []
        let this: TMDBSeason? = try? await TMDB.shared.get("tv/\(tmdbId)/season/\(season)")
        collected = (this?.episodes ?? []).filter { $0.episodeNumber < episode }
        if collected.count < 3, season > 1 {
            let previous: TMDBSeason? = try? await TMDB.shared.get("tv/\(tmdbId)/season/\(season - 1)")
            collected = (previous?.episodes ?? []) + collected
        }
        previously = Array(collected.suffix(3))
    }

    // Start loading what Play will play while you read the page.
    private func warmUp() {
        let season = title.kind == .tvShow ? (resume?.currentSeason ?? seasons.first?.seasonNumber ?? 1) : nil
        let episode = title.kind == .tvShow ? (resume?.currentEpisode ?? 1) : nil
        Warmup.shared.prepare(PlayRequest(title: title, season: season, episode: episode,
                                          startAt: ResumeRule.start(position: resume?.positionSeconds, duration: resume?.durationSeconds),
                                          seasons: seasons))
    }

    private func loadEpisodes() async {
        guard let season, let tmdbId = title.tmdbId else { return }
        let result: TMDBSeason? = try? await TMDB.shared.get("tv/\(tmdbId)/season/\(season)")
        episodes = result?.episodes ?? []
    }
}

struct EpisodeCard: View {
    let episode: TMDBSeason.Episode
    let fallback: URL?
    let isCurrent: Bool
    var watched = false
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button(action: action) {
                ZStack(alignment: .bottomLeading) {
                    PosterImage(url: TMDB.image(episode.stillPath, TMDB.fullScreen) ?? fallback, name: "Episode \(episode.episodeNumber)")
                        .frame(width: 400, height: 225)
                        .clipped()
                    if isCurrent { Badge(text: "Up next").padding(14) }
                }
                .overlay(alignment: .topTrailing) {
                    if watched {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title2)
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.black, .white)
                            .padding(12)
                            .accessibilityLabel("Watched")
                    }
                }
            }
            .buttonStyle(.focusCard)
            Text("\(episode.episodeNumber). \(episode.name ?? "Episode \(episode.episodeNumber)")")
                .font(.callout.weight(.semibold))
                .lineLimit(1)
            Text([episode.runtime.map { "\($0)m" }, episode.airDate].compactMap { $0 }.joined(separator: "  ·  "))
                .font(.caption)
                .foregroundStyle(Theme.muted)
        }
        .frame(width: 400, alignment: .leading)
    }
}

// Apple TV can't run the web players binge. streams through, so playback
// happens on the phone (which can AirPlay or mirror back to this TV).
struct HandoffView: View {
    @Environment(\.dismiss) private var dismiss
    let handoff: Handoff

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            HStack(spacing: 110) {
                QRCodeView(url: handoff.url)
                VStack(alignment: .leading, spacing: 30) {
                    Text(handoff.heading)
                        .font(.system(size: 54, weight: .heavy))
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                    Text(handoff.detail)
                        .font(.title3)
                        .foregroundStyle(.white.opacity(0.85))
                    VStack(alignment: .leading, spacing: 22) {
                        Step(number: 1, text: "Point your iPhone camera at the code.")
                        Step(number: 2, text: "binge. opens and starts playing.")
                        Step(number: 3, text: "Tap AirPlay in the player (or Screen Mirroring in Control Center) and pick this Apple TV.")
                    }
                    Text(handoff.url.absoluteString.replacingOccurrences(of: "https://", with: ""))
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button("Done") { dismiss() }
                        .buttonStyle(ActionButtonStyle())
                        .padding(.top, 16)
                }
                .frame(maxWidth: 860, alignment: .leading)
            }
            .padding(Theme.edge)
        }
    }

    private struct Step: View {
        let number: Int
        let text: String
        var body: some View {
            HStack(alignment: .firstTextBaseline, spacing: 20) {
                Text("\(number)")
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(.black)
                    .frame(width: 46, height: 46)
                    .background(.white, in: Circle())
                Text(text).font(.title3)
            }
        }
    }
}
