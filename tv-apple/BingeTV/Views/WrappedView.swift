import SwiftUI

// Ticket faces (SIL Open Font License, see Fonts/*-OFL.txt): Barlow
// Condensed for the marquee line, IBM Plex Mono for the printed line items.
enum TicketFont {
    static func marquee(_ size: CGFloat, semibold: Bool = false) -> Font {
        .custom(semibold ? "BarlowCondensed-SemiBold" : "BarlowCondensed-ExtraBold", size: size)
    }
    static func mono(_ size: CGFloat, semibold: Bool = false) -> Font {
        .custom(semibold ? "IBMPlexMono-SemiBold" : "IBMPlexMono-Regular", size: size)
    }
}

// Wrapped is the one screen that dresses up: your year as a run of movie
// tickets (same design as the website). Each stat prints on its own ticket:
// gold ADMIT ONE stub, perforation with notches, paper body with a marquee
// headline, printed line items and a barcode. ◀ ▶ move, click goes on,
// tickets also advance by themselves; Back closes.
struct WrappedView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var stats: Stats?
    @State private var page = 0
    @State private var printed = false
    @State private var lastInput = Date.distantPast
    @FocusState private var focused: Bool
    private let year = Calendar.current.component(.year, from: Date())

    private static let ink = Color(hex: 0x1C1A17)
    private static let paper = Color(hex: 0xF4EFE6)
    private static let gold = Color(hex: 0xF5C451)
    private static let red = Color(hex: 0x5A1020)
    private static let floor = Color(hex: 0x0F1218)

    struct Stats {
        var titles = 0, episodes = 0, movies = 0, minutes = 0, ratings = 0
        var genres: [String] = []
        var topShow: Title?
        var topShowEpisodes = 0
        var favorite: (Title, Double)?
    }

    struct Ticket: Identifiable {
        let id: String
        let screen: String
        let title: String
        var sub: String?
        var lines: [(String, String)] = []
        var poster: URL?
        var final = false
    }

    private var tickets: [Ticket] {
        guard let stats else { return [] }
        let name = app.profile?.name ?? "Your"
        if stats.titles == 0 {
            return [Ticket(id: "empty", screen: "Box office", title: "No tickets yet",
                           sub: "Watch or rate a few things this year and your tickets print here.")]
        }
        let hours = stats.minutes / 60
        var list = [
            Ticket(id: "intro", screen: "Opening night", title: "\(name)’s \(String(year))", sub: "A year at the binge. cinema",
                   lines: [("Showing", "Movies · Series · Sports"), ("Titles", "\(stats.titles)"), ("Seat", "Yours, every night")]),
            Ticket(id: "time", screen: "Screen 1", title: "\(hours) hours",
                   sub: "That’s about \(String(format: "%.1f", Double(hours) / 24)) days in the dark.",
                   lines: [("Episodes", "\(stats.episodes)"), ("Movies", "\(stats.movies)"), ("Titles", "\(stats.titles)")]),
        ]
        if let show = stats.topShow {
            list.append(Ticket(id: "show", screen: "Now showing", title: show.name, sub: "Your most-watched show",
                               lines: [("Episodes", "\(stats.topShowEpisodes)"), ("Rewatch value", "Off the charts")], poster: show.poster))
        }
        if let top = stats.genres.first {
            list.append(Ticket(id: "genres", screen: "Double feature", title: top, sub: "The genre you kept coming back to",
                               lines: stats.genres.prefix(3).enumerated().map { ("No. \($0.offset + 1)", $0.element) }))
        }
        if let favorite = stats.favorite {
            list.append(Ticket(id: "fav", screen: "Critics’ pick", title: favorite.0.name, sub: "Your best-rated title",
                               lines: [("Your rating", "\(Int(favorite.1.rounded())) of 5")], poster: favorite.0.poster))
        }
        list.append(Ticket(id: "end", screen: "Closing night", title: stats.ratings > 10 ? "The Critic" : "The Binger",
                           sub: stats.ratings > 10 ? "\(stats.ratings) ratings, and every pick learned from them." : "You kept coming back for more.",
                           lines: [("Ratings", "\(stats.ratings)"), ("Hours", "\(hours)")], final: true))
        return list
    }

    var body: some View {
        let list = tickets
        let ticket = list.indices.contains(page) ? list[page] : nil
        ZStack {
            Self.floor.ignoresSafeArea()

            // The remote: a focusable surface over the whole screen.
            Button { advance(list.count) } label: { Color.clear }
                .buttonStyle(SceneButtonStyle())
                .focused($focused)
                .onMoveCommand { direction in
                    lastInput = Date()
                    if direction == .left { page = max(0, page - 1) }
                    if direction == .right { page = min(list.count - 1, page + 1) }
                }
                .onExitCommand { dismiss() }
                .ignoresSafeArea()

            if let ticket {
                ticketView(ticket, number: page)
                    .frame(width: 1480, height: 640)
                    // feeds out of the printer: revealed top to bottom
                    .mask(alignment: .top) {
                        Rectangle().frame(height: printed ? 640 : 0).frame(maxHeight: .infinity, alignment: .top)
                    }
                    .offset(y: printed ? 0 : -30)
                    .shadow(color: .black.opacity(0.55), radius: 40, y: 30)
                    .allowsHitTesting(false)
                    .id(ticket.id)
            } else {
                RoundedRectangle(cornerRadius: 20).fill(.white.opacity(0.06)).frame(width: 1480, height: 640)
            }

            VStack {
                HStack(spacing: 12) {
                    ForEach(list.indices, id: \.self) { index in
                        Capsule().fill(Self.paper.opacity(index <= page ? 1 : 0.22)).frame(height: 5)
                    }
                }
                .padding(.horizontal, 120)
                .padding(.top, 60)
                Spacer()
                Text("\(Image(systemName: "chevron.left")) \(Image(systemName: "chevron.right"))  flip tickets  ·  Back  close")
                    .font(TicketFont.mono(22))
                    .foregroundStyle(Self.paper.opacity(0.45))
                    .padding(.bottom, 50)
            }
            .allowsHitTesting(false)
        }
        .ignoresSafeArea()
        .task { await load() }
        .task(id: "\(page)-\(stats != nil)") {
            printed = false
            withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.85)) { printed = true }
            // Advance by itself unless the remote was used in the last 10s.
            try? await Task.sleep(for: .seconds(7))
            if !Task.isCancelled, Date().timeIntervalSince(lastInput) > 10, page < tickets.count - 1 { page += 1 }
        }
        .onAppear { focused = true }
    }

    private func ticketView(_ ticket: Ticket, number: Int) -> some View {
        HStack(spacing: 0) {
            // stub
            VStack(alignment: .leading, spacing: 0) {
                Text("binge.").font(.system(size: 46, weight: .bold, design: .serif)).italic()
                Text("ADMIT\nONE").font(TicketFont.marquee(76)).lineSpacing(-14).padding(.top, 18)
                Spacer()
                Text("\(ticket.screen.uppercased()) · \(String(year))").font(TicketFont.mono(22, semibold: true))
                Text("NO. \(String(String(year).suffix(2)))-\(String(format: "%05d", 412 + number * 37))")
                    .font(TicketFont.mono(22, semibold: true)).opacity(0.7).padding(.top, 6)
            }
            .foregroundStyle(Self.ink)
            .padding(40)
            .frame(width: 330, height: 640, alignment: .topLeading)
            .background(Self.gold)

            // body
            VStack(alignment: .leading, spacing: 30) {
                HStack(alignment: .bottom, spacing: 36) {
                    if let poster = ticket.poster {
                        AsyncImage(url: poster) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Self.ink.opacity(0.1) }
                            .frame(width: 170, height: 255)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text(ticket.title.uppercased())
                            .font(TicketFont.marquee(ticket.title.count > 16 ? 96 : 128))
                            .lineLimit(2)
                            .minimumScaleFactor(0.5)
                        if let sub = ticket.sub {
                            Text(sub).font(TicketFont.marquee(40, semibold: true)).foregroundStyle(Self.red)
                        }
                    }
                }
                VStack(spacing: 0) {
                    ForEach(Array(ticket.lines.enumerated()), id: \.offset) { _, line in
                        HStack {
                            Text(line.0.uppercased()).font(TicketFont.mono(28)).opacity(0.62)
                            Spacer()
                            Text(line.1).font(TicketFont.mono(28, semibold: true))
                        }
                        .padding(.vertical, 12)
                        .overlay(alignment: .bottom) {
                            Line().stroke(style: StrokeStyle(lineWidth: 2, dash: [8, 7])).foregroundStyle(Self.ink.opacity(0.22)).frame(height: 1)
                        }
                    }
                }
                Spacer(minLength: 0)
                Barcode(seed: "\(ticket.id)-\(year)").fill(Self.ink).frame(width: 330, height: 64)
            }
            .foregroundStyle(Self.ink)
            .padding(.horizontal, 56)
            .padding(.vertical, 44)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Self.paper)
            .overlay(alignment: .leading) {
                Line(vertical: true).stroke(style: StrokeStyle(lineWidth: 3, dash: [12, 10])).foregroundStyle(Self.ink.opacity(0.35)).frame(width: 3)
            }
            .overlay(alignment: .topTrailing) {
                if ticket.final {
                    Text("ADMITTED")
                        .font(TicketFont.marquee(58))
                        .foregroundStyle(Self.red)
                        .padding(.horizontal, 22).padding(.vertical, 6)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Self.red, lineWidth: 6))
                        .rotationEffect(.degrees(-11))
                        .opacity(0.85)
                        .padding(50)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 22))
        // the notches where the ticket tears
        .overlay(alignment: .topLeading) { Circle().fill(Self.floor).frame(width: 46, height: 46).offset(x: 330 - 23, y: -23) }
        .overlay(alignment: .bottomLeading) { Circle().fill(Self.floor).frame(width: 46, height: 46).offset(x: 330 - 23, y: 23) }
    }

    private struct Line: Shape {
        var vertical = false
        func path(in rect: CGRect) -> Path {
            var path = Path()
            if vertical {
                path.move(to: CGPoint(x: rect.midX, y: rect.minY)); path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
            } else {
                path.move(to: CGPoint(x: rect.minX, y: rect.midY)); path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            }
            return path
        }
    }

    // Bars drawn from the ticket's own text, so every ticket's differs.
    private struct Barcode: Shape {
        let seed: String
        func path(in rect: CGRect) -> Path {
            var state = UInt32(truncatingIfNeeded: seed.unicodeScalars.reduce(UInt32(2166136261)) { ($0 ^ $1.value) &* 16777619 })
            if state == 0 { state = 1 }
            var path = Path()
            var x: CGFloat = 0
            let unit = rect.width / 240
            while x < 236 {
                state = state &* 1664525 &+ 1013904223
                let width = CGFloat(1 + state % 3)
                path.addRect(CGRect(x: rect.minX + x * unit, y: rect.minY, width: width * unit, height: rect.height))
                x += width + CGFloat(1 + (state >> 8) % 3)
            }
            return path
        }
    }

    private func advance(_ count: Int) {
        lastInput = Date()
        if page < count - 1 { page += 1 } else { dismiss() }
    }

    private struct SceneButtonStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View { configuration.label }
    }

    // MARK: Data

    private func load() async {
        #if DEBUG
        if app.isDemo {
            let shows = (try? await Catalog.titles(.tvShow, ids: [58132])) ?? [:]
            var show = shows[58132]
            if let tmdbId = show?.tmdbId, let details: TMDBDetails = try? await TMDB.shared.get("tv/\(tmdbId)") {
                show?.backdrop = TMDB.image(details.backdropPath, TMDB.fullScreen)
            }
            stats = Stats(titles: 64, episodes: 486, movies: 37, minutes: 412 * 60, ratings: 41,
                          genres: ["Thriller", "Drama", "Comedy"], topShow: show, topShowEpisodes: 22,
                          favorite: show.map { ($0, 5) })
            return
        }
        #endif
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
        if let top = counts.max(by: { $0.value < $1.value }), var show = shows[top.key] {
            if let tmdbId = show.tmdbId, let details: TMDBDetails = try? await TMDB.shared.get("tv/\(tmdbId)") {
                show.backdrop = TMDB.image(details.backdropPath, TMDB.fullScreen)
            }
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
