import SwiftUI

// Live games play right here: a game's feeds are raced like movie servers
// (first stream to actually play wins). ESPN supplies the scoreboards.
struct SportsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var boards: [(League, [Scoreboard.Event])] = []
    @State private var games: [SportGame] = []
    @State private var loaded = false
    @State private var playing: PlayRequest?
    @State private var starting: String?
    @State private var message: String?
    @State private var multi: [SportGame] = []
    @State private var multiOpen = false

    private var liveGames: [SportGame] { games.filter { $0.isLive && !$0.streams.isEmpty } }
    private var upcoming: [SportGame] {
        let soon = Date().addingTimeInterval(8 * 3600)
        return games.filter { !$0.isLive && ($0.startsAt ?? .distantFuture) < soon }.prefix(20).map { $0 }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 40) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Sports").font(.system(size: 54, weight: .heavy))
                    Spacer()
                    if let message {
                        Text(message).font(.callout.weight(.semibold)).foregroundStyle(Theme.gold)
                    } else {
                        Text("Scores update every 30 seconds").font(.caption).foregroundStyle(Theme.muted)
                    }
                }
                if !loaded { ProgressView().frame(maxWidth: .infinity).padding(.top, 80) }

                if !multi.isEmpty { multiviewBar }

                if !liveGames.isEmpty {
                    section("Live now") {
                        ForEach(liveGames) { game in
                            LiveGameCard(game: game, event: event(for: game), busy: starting == game.id,
                                         inMulti: multi.contains(game)) { play(game) }
                                .contextMenu { multiMenu(game) }
                        }
                    }
                }

                ForEach(boards, id: \.0.id) { league, events in
                    section(league.name) {
                        ForEach(events) { event in
                            let game = self.game(for: event)
                            GameCard(event: event, watchable: game != nil && !(game?.streams.isEmpty ?? true),
                                     busy: game.map { starting == $0.id } ?? false) {
                                if let game, !game.streams.isEmpty {
                                    play(game)
                                } else {
                                    message = event.isFinal ? "That game has ended." : "No streams for \(event.shortName ?? "this game") yet — they usually appear shortly before start."
                                }
                            }
                            .contextMenu { if let game, !game.streams.isEmpty { multiMenu(game) } }
                        }
                    }
                }

                if !upcoming.isEmpty {
                    section("Coming up") {
                        ForEach(upcoming) { game in
                            LiveGameCard(game: game, event: event(for: game), busy: starting == game.id, inMulti: false) {
                                message = "\(game.title) starts \(game.startsAt.map { $0.formatted(date: .omitted, time: .shortened) } ?? "soon")."
                            }
                        }
                    }
                }

                if loaded && boards.isEmpty && games.isEmpty {
                    Text("No games right now.").font(.headline).foregroundStyle(Theme.muted)
                }
            }
            .padding(.vertical, 30)
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

    // MARK: Multiview

    @ViewBuilder
    private func multiMenu(_ game: SportGame) -> some View {
        if multi.contains(game) {
            Button(role: .destructive) { multi.removeAll { $0 == game } } label: {
                Label("Remove from Multiview", systemImage: "rectangle.grid.2x2")
            }
        } else {
            Button { addToMulti(game) } label: {
                Label("Add to Multiview", systemImage: "rectangle.grid.2x2.fill")
            }
        }
        Button { play(game) } label: { Label("Watch", systemImage: "play.fill") }
    }

    private func addToMulti(_ game: SportGame) {
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

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: title)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 40) { content() }
                    .padding(.vertical, 34)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
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
        // Leagues with a live game first, then the usual order.
        boards = result
            .sorted { lhs, rhs in
                let l = lhs.1.contains(where: \.isLive), r = rhs.1.contains(where: \.isLive)
                return l != r ? l : lhs.0 < rhs.0
            }
            .map { (League.all[$0.0], $0.1) }
        loaded = true
    }

    private func tokens(_ event: Scoreboard.Event) -> Set<String>? {
        let names = event.competitors.compactMap { $0.team.displayName ?? $0.team.shortDisplayName }
        guard names.count == 2 else { return nil }
        return SportsFeed.tokens(teams: (names[0], names[1]), name: "")
    }

    private func game(for event: Scoreboard.Event) -> SportGame? {
        guard let wanted = tokens(event) else { return nil }
        return games.first { $0.teamTokens == wanted }
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
            playing = PlayRequest(title: title, liveStreams: servers, subtitle: "LIVE · \(game.category)")
        }
    }
}

struct LiveGameCard: View {
    let game: SportGame
    let event: Scoreboard.Event?
    let busy: Bool
    var inMulti = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    if game.isLive {
                        Label("LIVE", systemImage: "circle.fill")
                            .font(.caption.weight(.heavy))
                            .foregroundStyle(Color(hex: 0xFF5A50))
                    } else if let start = game.startsAt {
                        Text(start.formatted(date: .omitted, time: .shortened))
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                    }
                    Text(game.category).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                    Spacer()
                    if busy { ProgressView() }
                    if inMulti { Image(systemName: "rectangle.grid.2x2.fill").foregroundStyle(Theme.gold) }
                }
                if let event, let away = event.away, let home = event.home {
                    TeamScore(name: away.name, logo: away.logoURL, score: event.status.type.state == "pre" ? nil : away.score)
                    TeamScore(name: home.name, logo: home.logoURL, score: event.status.type.state == "pre" ? nil : home.score)
                } else if let teams = game.teams {
                    TeamScore(name: teams.away, logo: game.logos?.away, score: nil)
                    TeamScore(name: teams.home, logo: game.logos?.home, score: nil)
                } else {
                    Text(game.title).font(.headline).lineLimit(2)
                    Spacer(minLength: 0)
                }
                Text((game.streams.count == 1 ? "1 stream" : "\(game.streams.count) streams") + (game.isLive ? "  ·  hold for Multiview" : ""))
                    .font(.caption2).foregroundStyle(Theme.muted)
            }
            .padding(26)
            .frame(width: 460, height: 240, alignment: .topLeading)
            .background(Theme.surface)
        }
        .buttonStyle(.card)
    }
}

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
