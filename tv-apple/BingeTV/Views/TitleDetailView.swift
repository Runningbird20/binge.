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
        AsyncImage(url: TMDB.image(details?.backdropPath, TMDB.fullScreen) ?? TMDB.resized(title.backdrop, TMDB.fullScreen)) { image in
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
                AsyncImage(url: logo) { image in
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
                .focused($playFocused)

                Button { toggleList() } label: {
                    Label(app.isInList(title) ? "In My List" : "My List",
                          systemImage: app.isInList(title) ? "checkmark" : "plus")
                }
                .disabled(listBusy || !app.isSignedIn)

                Button { rating = true } label: {
                    Label(myStars == nil ? "Rate" : "Rated", systemImage: myStars == nil ? "star" : "star.fill")
                }
                .disabled(!app.isSignedIn)

                // Household queue: put it in another profile's "Sent to you".
                if app.isSignedIn, app.profiles.count > 1 {
                    Button { sending = true } label: {
                        Label(sentTo.map { "Sent to \($0)" } ?? "Send to…", systemImage: sentTo == nil ? "paperplane" : "checkmark")
                    }
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

                if let progress = resumeProgress {
                    ProgressView(value: progress)
                        .tint(Theme.gold)
                        .frame(width: 220)
                }
            }
            .padding(.top, 10)
            .focusSection()

            if let listError {
                Text(listError).font(.caption).foregroundStyle(Color(hex: 0xFFB4A8))
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
        guard let position = resume?.positionSeconds, let duration = resume?.durationSeconds, duration > 0, position > 30 else { return nil }
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

            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 40) {
                    ForEach(episodes) { episode in
                        EpisodeCard(episode: episode, fallback: title.backdrop,
                                    isCurrent: episode.seasonNumber == resume?.currentSeason && episode.episodeNumber == resume?.currentEpisode) {
                            start(season: episode.seasonNumber, episode: episode.episodeNumber, name: episode.name)
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
        let startAt = sameAsResume ? resume?.positionSeconds : nil
        if WebEngines.isAvailable, title.tmdbId != nil {
            playing = PlayRequest(title: title, season: season, episode: episode, startAt: startAt, seasons: seasons)
            return
        }
        let label = season.map { "S\($0):E\(episode ?? 1)" + (name.map { " · \($0)" } ?? "") } ?? "Starts on your phone."
        handoff = Handoff(heading: "Watch \(title.name)", detail: label,
                          url: title.watchURL(season: season, episode: episode, seconds: startAt))
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
        async let outsideTask = OutsideRatings.load(title)
        async let starsTask = app.myRating(for: title)
        async let franchiseTask = Franchises.find(for: title, kids: app.isKids)
        if title.kind == .tvShow, let tmdbId = title.tmdbId {
            await loadPreviously(tmdbId: tmdbId)
            heatmap = await EpisodeHeatmap.load(tmdbId: tmdbId, seasons: seasons)
        }
        (outside, myStars, franchise) = await (outsideTask, starsTask, franchiseTask)
        if let tmdbId = title.tmdbId {
            let spec = RowSpec(id: "more", title: "More Like This", kind: title.kind,
                               path: "\(title.kind.tmdbPath)/\(tmdbId)/recommendations")
            more = await Catalog.load(spec, kids: app.isKids)?.items.filter { $0.id != title.id } ?? []
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
                                          startAt: resume?.positionSeconds, seasons: seasons))
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
            }
            .buttonStyle(.card)
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
