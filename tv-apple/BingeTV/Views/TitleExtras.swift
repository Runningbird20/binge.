import SwiftUI

// Title-page extras from the website: outside ratings, your star rating,
// the episode heatmap, franchise watch order and "Previously on…".

struct OutsideRatingsRow: View {
    let ratings: OutsideRatings

    var body: some View {
        HStack(spacing: 22) {
            if let imdb = ratings.imdbRating {
                badge("IMDb", String(format: "%.1f", imdb), color: Color(hex: 0xF5C518), dark: true)
            }
            if let rt = ratings.rottenTomatoes {
                badge("RT", "\(rt)% " + (rt >= 60 ? "fresh" : "rotten"), color: Color(hex: rt >= 60 ? 0xFA320A : 0x5F7D2A), dark: false)
            }
            if let mc = ratings.metacritic {
                badge("Metacritic", "\(mc)", color: Color(hex: mc >= 61 ? 0x66CC33 : mc >= 40 ? 0xFFCC33 : 0xFF0000), dark: mc >= 40)
            }
        }
    }

    private func badge(_ label: String, _ value: String, color: Color, dark: Bool) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.caption.weight(.heavy))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(color, in: RoundedRectangle(cornerRadius: 6))
                .foregroundStyle(dark ? .black : .white)
            Text(value).font(.callout.weight(.bold))
        }
    }
}

// Five big stars; your choice fills every rating criterion on the site.
struct RateView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var app: AppModel
    let title: Title
    let current: Double?
    let saved: (Int) -> Void
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Int?

    var body: some View {
        VStack(spacing: 50) {
            Text("Rate \(title.name)").font(.system(size: 48, weight: .heavy)).multilineTextAlignment(.center)
            HStack(spacing: 30) {
                ForEach(1...5, id: \.self) { stars in
                    Button {
                        save(stars)
                    } label: {
                        VStack(spacing: 10) {
                            Image(systemName: Double(stars) <= (Double(focused ?? 0) > 0 ? Double(focused!) : (current ?? 0)) + 0.25 ? "star.fill" : "star")
                                .font(.system(size: 64))
                                .foregroundStyle(Theme.gold)
                            Text(["", "Not for me", "Meh", "Good", "Great", "Loved it"][stars]).font(.caption)
                        }
                        .frame(width: 200, height: 170)
                    }
                    .buttonStyle(.card)
                    .focused($focused, equals: stars)
                    .disabled(busy)
                }
            }
            if let error { Text(error).foregroundStyle(Color(hex: 0xFFB4A8)) }
            Text("Your rating syncs with binge. everywhere. Rated titles count as watched and leave My List.")
                .font(.callout)
                .foregroundStyle(Theme.muted)
        }
        .padding(Theme.edge)
        .onAppear { focused = Int((current ?? 4).rounded()) }
    }

    private func save(_ stars: Int) {
        busy = true
        Task {
            do {
                try await app.rate(title, stars: stars)
                saved(stars)
                dismiss()
            } catch {
                if !app.handle(error) { self.error = error.localizedDescription }
            }
            busy = false
        }
    }
}

// Every episode's TMDB rating at a glance, seasons as rows.
struct EpisodeHeatmap: View {
    let seasons: [(season: Int, episodes: [TMDBSeason.Episode])]
    let current: (Int, Int)?

    private var maxEpisodes: Int { seasons.map { $0.episodes.count }.max() ?? 0 }
    private var cell: CGFloat { max(30, min(58, 1600 / CGFloat(max(maxEpisodes, 1)) - 6)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline, spacing: 20) {
                SectionTitle(text: "Episode ratings")
                legend
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(seasons, id: \.season) { row in
                    HStack(spacing: 6) {
                        Text("S\(row.season)")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 70, alignment: .leading)
                        ForEach(row.episodes) { episode in
                            let rating = episode.voteAverage ?? 0
                            let isCurrent = current.map { $0 == (row.season, episode.episodeNumber) } ?? false
                            Text(rating > 0 ? String(format: "%.1f", rating) : "–")
                                .font(.system(size: cell * 0.32, weight: .bold))
                                .monospacedDigit()
                                .foregroundStyle(rating >= 6 && rating < 8 ? .black : .white)
                                .frame(width: cell, height: cell * 0.8)
                                .background(Self.color(rating), in: RoundedRectangle(cornerRadius: 6))
                                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white, lineWidth: isCurrent ? 3 : 0))
                        }
                    }
                }
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 10) {
            ForEach([(9.0, "Awesome"), (8.0, "Great"), (7.0, "Good"), (6.0, "Regular"), (5.0, "Bad")], id: \.0) { value, label in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 3).fill(Self.color(value)).frame(width: 18, height: 18)
                    Text(label).font(.caption2).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    static func color(_ rating: Double) -> Color {
        switch rating {
        case 0: return Color.white.opacity(0.12)
        case 8.6...: return Color(hex: 0x1B6E3A)
        case 8.0..<8.6: return Color(hex: 0x2E9E4F)
        case 7.0..<8.0: return Color(hex: 0xC9D74A)
        case 6.0..<7.0: return Color(hex: 0xF5C451)
        case 5.0..<6.0: return Color(hex: 0xE8772E)
        default: return Color(hex: 0xC0392B)
        }
    }

    static func load(tmdbId: Int, seasons: [TMDBDetails.Season]) async -> [(season: Int, episodes: [TMDBSeason.Episode])] {
        await withTaskGroup(of: (Int, [TMDBSeason.Episode]).self) { group in
            for season in seasons.prefix(40) {
                group.addTask {
                    let result: TMDBSeason? = try? await TMDB.shared.get("tv/\(tmdbId)/season/\(season.seasonNumber)")
                    return (season.seasonNumber, result?.episodes ?? [])
                }
            }
            var rows: [(season: Int, episodes: [TMDBSeason.Episode])] = []
            for await (number, episodes) in group where !episodes.isEmpty { rows.append((number, episodes)) }
            return rows.sorted { $0.season < $1.season }
        }
    }
}

struct FranchiseSection: View {
    let order: Franchises.Order
    @State private var story = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 24) {
                SectionTitle(text: "\(order.name) · watch order")
                if order.story != nil {
                    Button("Release order") { story = false }.buttonStyle(PillButtonStyle(selected: !story))
                    Button("Story order") { story = true }.buttonStyle(PillButtonStyle(selected: story))
                }
            }
            .focusSection()
            let items = story ? (order.story ?? order.release) : order.release
            ScrollView(.horizontal) {
                LazyHStack(spacing: 40) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, title in
                        VStack(alignment: .leading, spacing: 10) {
                            PosterCard(title: title)
                            Text("\(index + 1). \(title.name)").font(.caption).lineLimit(1).frame(width: 220, alignment: .leading)
                        }
                    }
                }
                .padding(.vertical, 34)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .focusSection()
        }
    }
}

// Back after two weeks or more: the last few episodes, in a sentence each.
struct PreviouslyOn: View {
    let episodes: [TMDBSeason.Episode]
    let play: (TMDBSeason.Episode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: "Previously on…")
            Text("It's been a while. Here's where you left off.").font(.callout).foregroundStyle(Theme.muted)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 40) {
                    ForEach(episodes) { episode in
                        Button { play(episode) } label: {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("S\(episode.seasonNumber):E\(episode.episodeNumber) · \(episode.name ?? "")")
                                    .font(.callout.weight(.bold))
                                    .lineLimit(1)
                                Text(episode.overview?.isEmpty == false ? episode.overview! : "No summary for this one.")
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.8))
                                    .lineLimit(5)
                                Spacer(minLength: 0)
                            }
                            .padding(24)
                            .frame(width: 520, height: 230, alignment: .topLeading)
                            .background(Theme.surface)
                        }
                        .buttonStyle(.card)
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
