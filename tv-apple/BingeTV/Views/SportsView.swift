import SwiftUI

// Mirrors the website's Sports page: a spotlight game, category chips, then
// rows of 16:9 thumbnails (Live Now, one row per league, 24/7 channels),
// with ESPN scores at the end. Games play right here: a game's feeds are
// raced like movie servers (first stream to actually play wins).
struct SportsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var boards: [(League, [Scoreboard.Event])] = []
    @State private var games: [SportGame] = []
    @State private var loaded = false
    @State private var category = "All"
    @State private var playing: PlayRequest?
    @State private var starting: String?
    @State private var message: String?
    @State private var multi: [SportGame] = []
    @State private var multiOpen = false
    @ObservedObject private var teams = TeamCenter.shared
    @ObservedObject private var pip = PiPController.shared

    private var playable: [SportGame] { games.filter { !$0.streams.isEmpty } }
    private var liveGames: [SportGame] { playable.filter { $0.isLive && !$0.is247 } }

    private var categories: [String] {
        ["All"] + Array(Set(playable.map(\.category))).filter { $0 != "Other" }.sorted()
    }

    private var filtered: [SportGame] {
        category == "All" ? playable : playable.filter { $0.category == category }
    }

    // One row per league: leagues with live games first, live games first
    // within each row, then by start time. 24/7 channels get their own row.
    private var leagueRows: [(String, [SportGame])] {
        let soon = Date().addingTimeInterval(24 * 3600)
        let groups = Dictionary(grouping: filtered.filter { !$0.is247 && ($0.isLive || ($0.startsAt ?? .distantFuture) < soon) }, by: \.league)
        return groups
            .map { league, items in
                (league, items.sorted { ($0.isLive ? 0 : 1, $0.startsAt ?? .distantFuture) < ($1.isLive ? 0 : 1, $1.startsAt ?? .distantFuture) })
            }
            .sorted { lhs, rhs in
                let l = lhs.1.filter(\.isLive).count, r = rhs.1.filter(\.isLive).count
                return l != r ? l > r : (lhs.1.first?.startsAt ?? .distantFuture) < (rhs.1.first?.startsAt ?? .distantFuture)
            }
    }

    private var channels: [SportGame] { filtered.filter(\.is247) }

    // Spotlight: a live game with good art, preferring one ESPN knows about.
    private var featured: SportGame? {
        let live = filtered.filter { $0.isLive && !$0.is247 }
        return live.first { event(for: $0) != nil && ($0.logos != nil || $0.poster != nil) }
            ?? live.first { $0.poster != nil || $0.logos != nil }
            ?? live.first
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 34) {
                if let featured {
                    SportsSpotlight(game: featured, event: event(for: featured), busy: starting == featured.id,
                                    inMulti: multi.contains(featured),
                                    watch: { play(featured) },
                                    toggleMulti: { toggleMulti(featured) })
                } else if !loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 160)
                }

                if let message {
                    Text(message).font(.callout.weight(.semibold)).foregroundStyle(Theme.gold)
                }

                if !multi.isEmpty { multiviewBar }
                if let corner = pip.game { cornerBar(corner) }

                if categories.count > 2 {
                    ScrollView(.horizontal) {
                        HStack(spacing: 20) {
                            ForEach(categories, id: \.self) { name in
                                Button {
                                    category = name
                                } label: {
                                    Text(name == "All" ? "All" : "\(SportsFeed.icons[name] ?? "🏆") \(name)")
                                }
                                .buttonStyle(PillButtonStyle(selected: category == name))
                            }
                        }
                        .padding(.vertical, 16)
                    }
                    .scrollIndicators(.hidden)
                    .scrollClipDisabled()
                    .focusSection()
                }

                if category == "All", !teams.teams.isEmpty { yourTeams }

                let live = category == "All" ? liveGames : liveGames.filter { $0.category == category }
                if !live.isEmpty {
                    row("Live Now · \(live.count)", games: live)
                }
                ForEach(leagueRows, id: \.0) { league, items in
                    let liveCount = items.filter(\.isLive).count
                    row(league, subtitle: liveCount > 0 ? "\(liveCount) live now" : items.first?.startsAt.map { "Next: \(Self.when($0))" },
                        games: items)
                }
                if !channels.isEmpty {
                    row("24/7 Sports Channels", games: channels)
                }

                if category == "All" {
                    let scores = boards.flatMap(\.1).sorted { $0.sortRank < $1.sortRank }
                    if !scores.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            SectionTitle(text: "Scores")
                            ScrollView(.horizontal) {
                                LazyHStack(spacing: 40) {
                                    ForEach(scores) { event in
                                        let game = self.game(for: event)
                                        GameCard(event: event, watchable: game != nil, busy: game.map { starting == $0.id } ?? false) {
                                            if let game { play(game) } else {
                                                message = event.isFinal ? "That game has ended." : "No streams for \(event.shortName ?? "this game") yet. They usually appear shortly before start."
                                            }
                                        }
                                        .contextMenu {
                                            if let game { multiMenu(game) }
                                            followMenu(event)
                                        }
                                    }
                                }
                                .padding(.vertical, 34)
                            }
                            .scrollIndicators(.hidden)
                            .scrollClipDisabled()
                        }
                        .focusSection()
                    }
                }

                if loaded && playable.isEmpty && boards.isEmpty {
                    Text("No games right now.").font(.headline).foregroundStyle(Theme.muted)
                }
            }
            .padding(.bottom, 60)
        }
        .scrollClipDisabled()
        .fullScreenCover(item: $playing) { PlayerView(request: $0, app: app) }
        .fullScreenCover(isPresented: $multiOpen) { MultiviewView(games: multi) }
        .task {
            while !Task.isCancelled {
                await load()
                #if DEBUG
                // -BingeMulti "celtics,flyers": open Multiview with those live games.
                if let wanted = UserDefaults.standard.string(forKey: "BingeMulti")?.lowercased(), !multiOpen {
                    let picks = wanted.split(separator: ",").compactMap { word in liveGames.first { $0.title.lowercased().contains(word) } }
                    if picks.count >= 2 {
                        UserDefaults.standard.removeObject(forKey: "BingeMulti")
                        multi = picks
                        multiOpen = true
                    }
                }
                // -BingeCorner celtics: put that live game in the corner.
                if let wanted = UserDefaults.standard.string(forKey: "BingeCorner")?.lowercased(),
                   let game = liveGames.first(where: { $0.title.lowercased().contains(wanted) }) {
                    UserDefaults.standard.removeObject(forKey: "BingeCorner")
                    PiPController.shared.show(game)
                }
                // -BingeAlertTest YES: show a sample game-alert banner.
                if UserDefaults.standard.bool(forKey: "BingeAlertTest") {
                    UserDefaults.standard.removeObject(forKey: "BingeAlertTest")
                    TeamCenter.shared.debugShow(GameAlert(id: "test", headline: "Close game: Celtics vs Cavaliers",
                                                          detail: "BOS 98 – 96 CLE · 1:32 - 4th", teams: ["celtics", "cavaliers"]))
                }
                // -BingeLive celtics: auto-play the first live game matching it.
                if let wanted = UserDefaults.standard.string(forKey: "BingeLive")?.lowercased(), playing == nil, starting == nil,
                   let game = liveGames.first(where: { $0.title.lowercased().contains(wanted) }) {
                    UserDefaults.standard.removeObject(forKey: "BingeLive")
                    play(game)
                }
                #endif
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func row(_ title: String, subtitle: String? = nil, games: [SportGame]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 18) {
                SectionTitle(text: title)
                if let subtitle { Text(subtitle).font(.callout).foregroundStyle(Theme.muted) }
            }
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 40) {
                    ForEach(games) { game in
                        SportThumbCard(game: game, event: event(for: game), busy: starting == game.id,
                                       inMulti: multi.contains(game)) {
                            if game.isLive { play(game) } else {
                                message = "\(game.title) starts \(game.startsAt.map(Self.when) ?? "soon")."
                            }
                        }
                        .contextMenu { multiMenu(game) }
                    }
                }
                .padding(.vertical, 34)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
        .focusSection()
    }

    static func when(_ date: Date) -> String {
        let calendar = Calendar.current
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDateInToday(date) { return "Today \(time)" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow \(time)" }
        return date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }

    // MARK: Multiview

    @ViewBuilder
    private func multiMenu(_ game: SportGame) -> some View {
        if game.isLive {
            Button { play(game) } label: { Label("Watch", systemImage: "play.fill") }
            Button { PiPController.shared.show(game) } label: { Label("Watch in the corner", systemImage: "pip") }
            if multi.contains(game) {
                Button(role: .destructive) { toggleMulti(game) } label: {
                    Label("Remove from Multiview", systemImage: "rectangle.grid.2x2")
                }
            } else {
                Button { toggleMulti(game) } label: {
                    Label("Add to Multiview", systemImage: "rectangle.grid.2x2.fill")
                }
            }
        }
    }

    // MARK: Followed teams & the corner game

    @ViewBuilder
    private func followMenu(_ event: Scoreboard.Event) -> some View {
        if app.isSignedIn, let path = boards.first(where: { $0.1.contains(event) })?.0.path {
            ForEach(event.competitors, id: \.self) { competitor in
                let following = teams.isFollowing(competitor.team)
                Button {
                    Task { await teams.toggle(competitor.team, leaguePath: path) }
                } label: {
                    Label(following ? "Unfollow \(competitor.name)" : "Follow \(competitor.name)",
                          systemImage: following ? "star.slash" : "star")
                }
            }
        }
    }

    // Games involving teams you follow: live/upcoming first.
    private var yourTeams: some View {
        let ids = Set(teams.teams.map(\.teamId))
        let events = boards.flatMap(\.1).filter { $0.competitors.contains { ids.contains($0.team.id ?? "") } }
            .sorted { $0.sortRank < $1.sortRank }
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 18) {
                SectionTitle(text: "Your teams")
                Text(teams.teams.map { $0.teamAbbr ?? $0.teamName }.joined(separator: " · "))
                    .font(.callout).foregroundStyle(Theme.muted)
            }
            if events.isEmpty {
                Text("No games today for your teams. You'll get a banner when one starts or gets close.")
                    .font(.callout).foregroundStyle(Theme.muted).padding(.vertical, 20)
            } else {
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 40) {
                        ForEach(events) { event in
                            let game = self.game(for: event)
                            GameCard(event: event, watchable: game != nil, busy: game.map { starting == $0.id } ?? false) {
                                if let game { play(game) } else {
                                    message = event.isFinal ? "That game has ended." : "No streams for \(event.shortName ?? "this game") yet."
                                }
                            }
                            .contextMenu {
                                if let game { multiMenu(game) }
                                followMenu(event)
                            }
                        }
                    }
                    .padding(.vertical, 34)
                }
                .scrollIndicators(.hidden)
                .scrollClipDisabled()
            }
        }
        .focusSection()
    }

    private func cornerBar(_ corner: SportGame) -> some View {
        HStack(spacing: 24) {
            Image(systemName: "pip.fill").font(.title3).foregroundStyle(Theme.gold)
            Text("In the corner: \(corner.title)").font(.callout.weight(.semibold)).lineLimit(1)
            Spacer(minLength: 20)
            Button {
                PiPController.shared.close()
                play(corner)
            } label: { Label("Full screen", systemImage: "arrow.up.left.and.arrow.down.right") }
            .buttonStyle(PillButtonStyle(selected: true))
            Button("Close") { PiPController.shared.close() }
                .buttonStyle(PillButtonStyle())
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 18)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22))
        .focusSection()
    }

    private func toggleMulti(_ game: SportGame) {
        if multi.contains(game) {
            multi.removeAll { $0 == game }
            return
        }
        guard multi.count < 4 else { message = "Multiview holds up to 4 games."; return }
        multi.append(game)
        message = multi.count == 1 ? "Added. Add one more game to watch them together." : nil
    }

    private var multiviewBar: some View {
        HStack(spacing: 24) {
            Image(systemName: "rectangle.grid.2x2.fill").font(.title3).foregroundStyle(Theme.gold)
            Text(multi.map(\.title).joined(separator: "  ·  "))
                .font(.callout.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 20)
            Button {
                multiOpen = true
            } label: {
                Label("Watch \(multi.count) at once", systemImage: "play.fill")
            }
            .buttonStyle(PillButtonStyle(selected: true))
            .disabled(multi.count < 2)
            Button("Clear") { multi = [] }
                .buttonStyle(PillButtonStyle())
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 18)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22))
        .focusSection()
    }

    // MARK: Data

    private func load() async {
        async let feed = SportsFeed.load()
        async let scores: [(Int, [Scoreboard.Event])] = withTaskGroup(of: (Int, [Scoreboard.Event]).self) { group in
            for (index, league) in League.all.enumerated() {
                group.addTask { (index, (try? await Scoreboard.load(league)) ?? []) }
            }
            var found: [(Int, [Scoreboard.Event])] = []
            for await entry in group where !entry.1.isEmpty { found.append(entry) }
            return found
        }
        let (loadedGames, result) = await (feed, scores)
        games = loadedGames
        boards = result.sorted { $0.0 < $1.0 }.map { (League.all[$0.0], $0.1) }
        loaded = true
    }

    private func tokens(_ event: Scoreboard.Event) -> Set<String>? {
        let names = event.competitors.compactMap { $0.team.displayName ?? $0.team.shortDisplayName }
        guard names.count == 2 else { return nil }
        return SportsFeed.tokens(teams: (names[0], names[1]), name: "")
    }

    private func game(for event: Scoreboard.Event) -> SportGame? {
        guard let wanted = tokens(event) else { return nil }
        return playable.first { $0.teamTokens == wanted }
    }

    private func event(for game: SportGame) -> Scoreboard.Event? {
        guard let wanted = game.teamTokens else { return nil }
        return boards.lazy.flatMap(\.1).first { tokens($0) == wanted }
    }

    private func play(_ game: SportGame) {
        guard starting == nil else { return }
        starting = game.id
        message = nil
        Task {
            let servers = await SportsFeed.servers(for: game)
            starting = nil
            guard !servers.isEmpty else {
                message = "Couldn't find a stream for \(game.title) right now."
                return
            }
            let title = Title(kind: .movie, dbId: 0, name: game.title, year: nil, overview: nil, genre: nil, ageRating: nil)
            playing = PlayRequest(title: title, liveStreams: servers, subtitle: "LIVE · \(game.league)", game: game)
        }
    }
}

// MARK: - Art

// Same rule as the site's GameArt: crisp team logos on the teams' colors
// beat the providers' low-res thumbnails; otherwise the thumbnail, then the
// sport's icon.
struct SportArt: View {
    let game: SportGame
    var large = false

    private var split: (Color, Color) {
        let colors = (game.colors ?? []).compactMap { Color(hexString: $0) }
        return colors.count >= 2 ? (colors[0], colors[1]) : (Color(hex: 0x26304A), Color(hex: 0x121620))
    }

    var body: some View {
        if let logos = game.logos, let home = logos.home, let away = logos.away {
            ZStack {
                // The split sits between the two logos (further right in
                // the spotlight, where the logos are).
                let mid = large ? 0.735 : 0.5
                LinearGradient(stops: [.init(color: split.0, location: 0), .init(color: split.0, location: mid - 0.02),
                                       .init(color: split.1, location: mid + 0.02), .init(color: split.1, location: 1)],
                               startPoint: large ? .leading : .topLeading, endPoint: large ? .trailing : .bottomTrailing)
                // Title order ("Away vs. Home") matches the feeds' color order.
                HStack(spacing: large ? 60 : 28) {
                    logo(away)
                    Text("vs").font(large ? .title2.weight(.heavy) : .callout.weight(.heavy)).foregroundStyle(.white.opacity(0.85))
                    logo(home)
                }
                .frame(maxWidth: .infinity, alignment: large ? .trailing : .center)
                .padding(.trailing, large ? 220 : 0)
            }
        } else if let poster = game.poster {
            AsyncImage(url: poster) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                iconArt
            }
        } else {
            iconArt
        }
    }

    private func logo(_ url: URL) -> some View {
        AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
            .frame(width: large ? 200 : 96, height: large ? 200 : 96)
            .shadow(color: .black.opacity(0.35), radius: 8, y: 4)
    }

    private var iconArt: some View {
        ZStack {
            LinearGradient(colors: [split.0, split.1], startPoint: .topLeading, endPoint: .bottomTrailing)
            Text(game.icon).font(.system(size: large ? 140 : 72))
        }
    }
}

struct StatusPill: View {
    let game: SportGame
    var body: some View {
        HStack(spacing: 8) {
            if game.isLive {
                Circle().fill(.white).frame(width: 10, height: 10)
            }
            Text(game.is247 ? "24/7" : game.isLive ? "LIVE" : (game.startsAt.map(SportsView.when) ?? "Soon"))
                .font(.caption.weight(.heavy))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(game.isLive ? Color(hex: 0xE5383B) : Color.black.opacity(0.7), in: Capsule())
        .foregroundStyle(.white)
    }
}

// The live score from ESPN, laid over the thumbnail.
struct ScoreChip: View {
    let event: Scoreboard.Event
    var body: some View {
        let away = event.away, home = event.home
        HStack(spacing: 10) {
            Text("\(away?.team.abbreviation ?? "") \(away?.score ?? "")")
            Text("–").foregroundStyle(.white.opacity(0.6))
            Text("\(home?.score ?? "") \(home?.team.abbreviation ?? "")")
            if let detail = event.status.type.shortDetail {
                Text(detail).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
            }
        }
        .font(.caption.weight(.bold))
        .monospacedDigit()
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.black.opacity(0.75), in: Capsule())
    }
}

struct SportThumbCard: View {
    let game: SportGame
    let event: Scoreboard.Event?
    let busy: Bool
    let inMulti: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                ZStack {
                    SportArt(game: game)
                        .frame(width: 480, height: 270)
                        .clipped()
                    VStack {
                        HStack {
                            StatusPill(game: game)
                            Spacer()
                            if inMulti {
                                Image(systemName: "rectangle.grid.2x2.fill")
                                    .padding(8)
                                    .background(.black.opacity(0.6), in: Circle())
                                    .foregroundStyle(Theme.gold)
                            }
                        }
                        Spacer()
                        HStack {
                            if let event, event.status.type.state != "pre" { ScoreChip(event: event) }
                            Spacer()
                            if busy { ProgressView() }
                        }
                    }
                    .padding(16)
                }
                .frame(width: 480, height: 270)
                VStack(alignment: .leading, spacing: 6) {
                    Text(game.title).font(.callout.weight(.semibold)).lineLimit(1)
                    Text("\(game.icon) \(game.league)  ·  \(game.streams.count) server\(game.streams.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
                .frame(width: 480, alignment: .leading)
                .background(Theme.surface)
            }
        }
        .buttonStyle(.card)
    }
}

struct SportsSpotlight: View {
    let game: SportGame
    let event: Scoreboard.Event?
    let busy: Bool
    let inMulti: Bool
    let watch: () -> Void
    let toggleMulti: () -> Void

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if game.logos == nil, let poster = game.poster {
                    // Provider thumbnails are small: a blurred copy fills
                    // the backdrop, the real one sits at a size it stays sharp.
                    ZStack(alignment: .trailing) {
                        AsyncImage(url: poster) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Theme.surface }
                            .blur(radius: 40)
                            .opacity(0.6)
                        AsyncImage(url: poster) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
                            .frame(maxWidth: 900, maxHeight: 480)
                            .clipShape(RoundedRectangle(cornerRadius: 20))
                            .padding(.trailing, Theme.edge)
                    }
                } else {
                    SportArt(game: game, large: true)
                }
            }
            .frame(height: 600)
            .frame(maxWidth: .infinity)
            .clipped()
            .overlay {
                LinearGradient(colors: [Theme.background.opacity(0.95), Theme.background.opacity(0.35), .clear],
                               startPoint: .leading, endPoint: .trailing)
            }
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [.clear, Theme.background], startPoint: .center, endPoint: .bottom)
            }
            .padding(.horizontal, -Theme.edge)

            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    StatusPill(game: game)
                    if let event, event.status.type.state != "pre" { ScoreChip(event: event) }
                }
                Text(game.title)
                    .font(.system(size: 60, weight: .heavy))
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                Text("\(game.icon) \(game.league)  ·  \(game.streams.count) server\(game.streams.count == 1 ? "" : "s")")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(Theme.muted)
                HStack(spacing: 24) {
                    Button(action: watch) {
                        HStack {
                            if busy { ProgressView() } else { Image(systemName: "play.fill") }
                            Text("Watch live")
                        }
                    }
                    Button(action: toggleMulti) {
                        Label(inMulti ? "In Multiview" : "Add to Multiview",
                              systemImage: inMulti ? "checkmark" : "rectangle.grid.2x2")
                    }
                }
                .padding(.top, 6)
            }
            .frame(maxWidth: 900, alignment: .leading)
            .padding(.bottom, 40)
        }
        .focusSection()
    }
}

// ESPN scoreboard card (the Scores row).
struct TeamScore: View {
    let name: String
    let logo: URL?
    let score: String?
    var dim = false

    var body: some View {
        HStack(spacing: 16) {
            if let logo {
                AsyncImage(url: logo) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
                    .frame(width: 44, height: 44)
            }
            Text(name).font(.headline).lineLimit(1)
            Spacer()
            if let score { Text(score).font(.title2.weight(.heavy)).monospacedDigit() }
        }
        .opacity(dim ? 0.55 : 1)
    }
}

struct GameCard: View {
    let event: Scoreboard.Event
    let watchable: Bool
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    if event.isLive {
                        Circle().fill(Color(hex: 0xFF5A50)).frame(width: 14, height: 14)
                            .accessibilityLabel("Live")
                    }
                    Text(event.status.type.shortDetail ?? "")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(event.isLive ? Color(hex: 0xFF5A50) : Theme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 8)
                    if busy {
                        ProgressView()
                    } else if watchable {
                        Image(systemName: "play.circle.fill")
                            .font(.title3)
                            .foregroundStyle(Theme.gold)
                            .accessibilityLabel("Watch")
                    }
                }
                let showScore = event.status.type.state != "pre"
                if let away = event.away {
                    TeamScore(name: away.name, logo: away.logoURL, score: showScore ? away.score : nil, dim: event.isFinal && away.winner == false)
                }
                if let home = event.home {
                    TeamScore(name: home.name, logo: home.logoURL, score: showScore ? home.score : nil, dim: event.isFinal && home.winner == false)
                }
            }
            .padding(26)
            .frame(width: 460, height: 230, alignment: .topLeading)
            .background(Theme.surface)
        }
        .buttonStyle(.card)
    }
}
