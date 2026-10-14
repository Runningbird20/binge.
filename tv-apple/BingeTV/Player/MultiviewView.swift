import SwiftUI
import AVKit

// Up to four live games at once. Each tile races its own streams; only the
// focused tile has sound (the frame bridge can mute any player, which the
// website can't do across origins). Click a tile for full screen, Back to
// return to the grid, Back again to leave.
@MainActor
final class MultiviewTile: ObservableObject, Identifiable {
    nonisolated let game: SportGame
    let surface = UIView()
    @Published private(set) var status = "Finding a stream…"
    @Published private(set) var started = false
    @Published private(set) var paused = false
    @Published private(set) var streamName: String?
    private var race: StreamRace?
    private var timer: Timer?
    // Only Play/Pause on the remote pauses a tile; anything else that
    // pauses it (tvOS pauses one video when another starts making sound)
    // is undone.
    private var userPaused = false
    // Leaving Multiview stops every tile, including ones still waiting for
    // their staggered start: a tile that started after you left kept its
    // video pages loaded off-screen, and enough of those ran the Apple TV
    // out of memory (the crash).
    private var stopped = false
    private var lastStateAt = Date()
    private var restarts = 0
    private var streamsPerTile = 1
    // Servers that stalled or stopped on this tile; a restart skips them.
    private var dropped = Set<String>()
    // Paused by the app (another game is full screen): no decoding, no auto-resume.
    private var held = false
    private var trimmed = false
    private var startedAt = Date()
    private var lastT = 0.0
    private var lastMoveAt = Date()
    private var nudged = false
    @Published private(set) var gaveUp = false
    // Decoding health: share of frames dropped over the last ~10s.
    @Published private(set) var dropRate: Double = 0
    // Paused by Multiview because this Apple TV couldn't decode every game smoothly.
    @Published private(set) var throttled = false
    // How long the clock has run without a new picture (decoder starved).
    private(set) var frozenFor: TimeInterval = 0
    var isHeld: Bool { held }
    private var samples: [(at: Date, frames: Int, dropped: Int)] = []
    private var lastFrames = -1
    private var lastFramesAt = Date()
    // Waiting to start until picked (the Apple TV was already at its limit).
    private var deferredStreams = 0
    private var failedBatches = 0
    // This game's servers (for the picker) and one picked by hand (hold
    // select on the tile): a picked server is never switched away from.
    @Published private(set) var options: [StreamServer] = []
    private var picked: StreamServer?
    var audible = false {
        didSet { if oldValue != audible { applyAudio() } }
    }

    nonisolated var id: String { game.id }

    // Set when Multiview runs as one shared page: this game plays in a slot of it.
    var page: MultiviewPage? {
        didSet { surface.backgroundColor = page == nil ? .black : .clear }
    }
    // This game's slot in the shared page (for its position on screen).
    var slotId: String? { ((race?.winner?.web ?? race?.candidates.first?.web) as? PageSlotEngine)?.id }

    init(game: SportGame) {
        self.game = game
        surface.backgroundColor = .black
    }

    func start(streamsPerTile: Int) async {
        guard !stopped else { return }
        self.streamsPerTile = streamsPerTile
        if options.isEmpty { options = await SportsFeed.servers(for: game, limit: 12) }
        let servers: [StreamServer]
        if let picked { servers = [picked] } else {
            servers = Array(await SportsFeed.servers(for: game, limit: streamsPerTile + dropped.count)
                .filter { !dropped.contains($0.name) }.prefix(streamsPerTile))
        }
        guard !stopped else { return }
        guard !servers.isEmpty else { status = "No stream found"; gaveUp = true; return }
        let title = Title(kind: .movie, dbId: 0, name: game.title, year: nil, overview: nil, genre: nil, ageRating: nil)
        let page = self.page
        let race = StreamRace(request: PlayRequest(title: title, liveStreams: servers), servers: servers,
                              mode: .live, keepMuted: true,
                              makeEngine: page.map { page in { _ in page.makeSlot() } })
        if page != nil { race.container.backgroundColor = .clear }
        race.container.frame = surface.bounds
        race.container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        surface.addSubview(race.container)
        race.onChange = { [weak self] in
            guard let self, let race = self.race else { return }
            if let winner = race.winner { self.streamName = winner.server.name; self.applyAudio() }
            if race.failed {
                if self.picked == nil, self.failedBatches < 3 {
                    // That server failed: the next ones, a few times, before giving up.
                    self.failedBatches += 1
                    servers.forEach { self.dropped.insert($0.name) }
                    self.status = "Trying another stream…"
                    self.timer?.invalidate(); self.timer = nil
                    race.stop(); race.container.removeFromSuperview(); self.race = nil
                    Task { await self.start(streamsPerTile: self.streamsPerTile) }
                } else {
                    self.status = self.picked.map { "\($0.name) didn't play. Hold to pick another." } ?? "No stream could play"
                    self.gaveUp = true
                }
            }
        }
        self.race = race
        lastStateAt = Date()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        guard let web = race?.winner?.web else { return }
        // Re-assert sound every second: some players reset muted themselves.
        web.send(audible ? .unmute : .mute)
        // Video edge to edge in the tile, not the server's page layout.
        if started { web.send(.fill) }
        web.poll { [weak self] state in
            guard let self else { return }
            guard let state else {
                // The tile's page stopped reporting (its web process was
                // closed for memory, or the stream page broke): start over,
                // a couple of times at most.
                if self.started, Date().timeIntervalSince(self.lastStateAt) > 10, self.restarts < 2 { self.restart() }
                return
            }
            let now = Date()
            self.lastStateAt = now
            self.paused = state.paused
            if !self.started, state.t > 0.4, !state.paused {
                self.started = true
                self.startedAt = now
                self.lastT = state.t
                web.send(.cushionOn)
            }
            guard self.started, !self.held else { return }
            if state.paused, !state.ended, !self.userPaused, !state.cushion {
                web.send(self.audible ? .unmute : .mute)
                web.send(.play)
            }
            // Ad and tracker frames go once the game plays: memory and CPU.
            if !self.trimmed, now.timeIntervalSince(self.startedAt) > 8 { self.trimmed = true; web.send(.trim) }
            // A playing tile whose clock stops is buffering: jump to the live
            // edge, and if that doesn't help, move it to another server.
            self.measure(state, now: now)
            if state.paused || self.userPaused { self.lastMoveAt = now; return }
            // Clock running without a new picture: Multiview decides
            // (starved by the other games → pause one; alone → another server).
            self.frozenFor = self.lastFrames >= 0 && now.timeIntervalSince(self.lastMoveAt) < 2 ? now.timeIntervalSince(self.lastFramesAt) : 0
            if state.t != self.lastT { self.lastT = state.t; self.lastMoveAt = now; self.nudged = false; return }
            let stuck = now.timeIntervalSince(self.lastMoveAt)
            if stuck > 8, !self.nudged { self.nudged = true; web.send(.edge) }
            else if stuck > 18, self.restarts < 3, self.picked == nil {
                if let name = self.race?.winner?.server.name { self.dropped.insert(name) }
                self.restart()
            }
        }
    }

    private func measure(_ state: MediaState, now: Date) {
        guard state.frames >= 0 else { return }
        if state.frames < lastFrames { samples.removeAll(); lastFrames = -1 } // a new video element
        if state.frames > lastFrames { lastFrames = state.frames; lastFramesAt = now }
        samples.append((now, state.frames, state.dropped))
        while samples.count > 1, now.timeIntervalSince(samples[0].at) > 10 { samples.removeFirst() }
        let decoded = state.frames - samples[0].frames
        let lost = state.dropped - samples[0].dropped
        // WebKit counts every frame of a muted, unfocused tile as dropped
        // (dropped == decoded exactly) even while it plays fine: that's
        // bookkeeping, not overload, so it says nothing.
        dropRate = decoded > 30 && lost < decoded - 2 ? Double(lost) / Double(decoded) : 0
    }

    // This Apple TV can't take another game: this one's page is closed (not
    // just paused), so its memory is freed. Picking it again reloads it.
    // A paused page still held its whole web process, and too many of those
    // took down the Apple TV.
    func throttle() {
        timer?.invalidate(); timer = nil
        race?.stop(); race?.container.removeFromSuperview(); race = nil
        started = false; trimmed = false; nudged = false; samples.removeAll(); lastFrames = -1; frozenFor = 0
        held = false
        deferredStreams = streamsPerTile
        throttled = true
        status = "Paused to keep the others smooth"
    }

    /// Loading or playing (counts against this Apple TV's limit).
    var isActive: Bool { !throttled && !stopped && !gaveUp }

    // Not started at all: the Apple TV was already at its limit when its turn came.
    func deferStart(streamsPerTile: Int) {
        deferredStreams = streamsPerTile
        throttled = true
        status = "Paused to keep the others smooth"
    }

    func unthrottle() {
        guard throttled else { return }
        throttled = false
        if deferredStreams > 0 {
            let streams = deferredStreams
            deferredStreams = 0
            status = "Finding a stream…"
            Task { await start(streamsPerTile: streams) }
        } else {
            release()
        }
    }

    // The picture froze and this is the only game playing: another server.
    func switchServer() {
        guard restarts < 3, picked == nil else { return }
        if let name = race?.winner?.server.name { dropped.insert(name) }
        restart()
    }

    // Picked by hand: this tile plays exactly that server from now on.
    func choose(_ server: StreamServer) {
        picked = server
        dropped.removeAll(); restarts = 0; gaveUp = false
        throttled = false; deferredStreams = 0; held = false
        timer?.invalidate(); timer = nil
        race?.stop(); race?.container.removeFromSuperview(); race = nil
        started = false; trimmed = false; nudged = false; samples.removeAll(); lastFrames = -1; frozenFor = 0
        streamName = server.name
        status = "Switching to \(server.name)…"
        Task { await start(streamsPerTile: streamsPerTile) }
    }

    // Another game went full screen: stop decoding this one until it's back.
    func hold() {
        guard !held else { return }
        held = true
        race?.winner?.web.send(.pause)
    }

    func release() {
        guard held, !throttled else { return }
        held = false
        lastMoveAt = Date()
        lastFramesAt = lastMoveAt
        samples.removeAll()
        race?.winner?.web.send(.edge)
    }

    private func applyAudio() {
        race?.winner?.web.send(audible ? .unmute : .mute)
    }

    func togglePause() {
        userPaused = !paused
        race?.winner?.web.send(.toggle)
    }

    func stop() {
        stopped = true
        timer?.invalidate()
        timer = nil
        race?.stop()
        race?.container.removeFromSuperview()
        race = nil
    }

    private func restart() {
        restarts += 1
        timer?.invalidate()
        timer = nil
        race?.stop()
        race?.container.removeFromSuperview()
        race = nil
        started = false
        trimmed = false
        nudged = false
        samples.removeAll()
        lastFrames = -1
        frozenFor = 0
        status = "Reconnecting…"
        Task { await start(streamsPerTile: streamsPerTile) }
    }
}

struct MultiviewView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var tiles: [MultiviewTile]
    @State private var expanded: String?
    // Layout 2 ("main"): with 2–3 games one is big and the rest stack
    // beside it. Layout 1 (default): equal tiles. Chosen in Settings › Playback.
    @State private var main: String?
    @AppStorage(MultiviewLayout.key) private var layoutChoice = MultiviewLayout.grid.rawValue
    @FocusState private var focused: String?
    // Set once this Apple TV has shown it can't decode every game smoothly.
    @State private var overloaded = false
    @State private var lastLoadAction = Date.distantPast
    // Most recently watched first: when a paused game is picked, the game
    // watched longest ago makes room for it.
    @State private var recent: [String] = []
    // Bumped every second so a game that just got its slot is positioned.
    @State private var slotTick = 0

    // One shared page for every game (default), or a web view per game.
    @State private var page: MultiviewPage?

    init(games: [SportGame]) {
        let tiles = games.prefix(4).map { MultiviewTile(game: $0) }
        let page = MultiviewEngine.current == .page ? MultiviewPage() : nil
        tiles.forEach { $0.page = page }
        _tiles = State(initialValue: tiles)
        _page = State(initialValue: page)
    }

    var body: some View {
        GeometryReader { proxy in
            let frames = layout(in: proxy.size)
            ZStack(alignment: .topLeading) {
                Color.black
                if let page {
                    MultiviewPageSurface(page: page)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .task(id: layoutKey(frames)) { syncPage(page, frames) }
                }
                ForEach(tiles) { tile in
                    let frame = frames[tile.id] ?? .zero
                    let hidden = expanded != nil && expanded != tile.id
                    TileButton(tile: tile, focused: focused == tile.id, showFocus: expanded == nil) {
                        if tile.throttled {
                            // Stay within this Apple TV's limit: the game
                            // watched longest ago makes room.
                            let active = tiles.filter { $0.isActive && $0.id != tile.id }
                            if active.count >= MultiviewCapacity.games {
                                let victim = active.max { (recent.firstIndex(of: $0.id) ?? Int.max) < (recent.firstIndex(of: $1.id) ?? Int.max) }
                                victim?.throttle()
                            }
                            tile.unthrottle()
                            lastLoadAction = Date()
                            return
                        }
                        withAnimation(.easeInOut(duration: 0.3)) {
                            if expanded != nil {
                                expanded = nil
                            } else if usesMain, tile.id != mainId {
                                main = tile.id // a small game: make it the big one
                            } else {
                                expanded = tile.id
                            }
                        }
                    }
                    .focused($focused, equals: tile.id)
                    .disabled(hidden)
                    .onPlayPauseCommand { tile.togglePause() }
                    .frame(width: frame.width, height: frame.height)
                    .offset(x: frame.minX, y: frame.minY)
                    .opacity(hidden ? 0.01 : 1) // stays in the window, so it keeps playing (muted)
                }
            }
        }
        .ignoresSafeArea()
        .onExitCommand {
            if expanded != nil {
                withAnimation(.easeInOut(duration: 0.25)) { expanded = nil }
            } else {
                tiles.forEach { $0.stop() }
                dismiss()
            }
        }
        .onChange(of: focused) { _, id in
            if let id { recent.removeAll { $0 == id }; recent.insert(id, at: 0) }
            // Silence the others first; a moment later give the focused tile
            // sound. Unmuting first would briefly have two videos with sound,
            // and tvOS answers that by pausing one of them.
            for tile in tiles where tile.id != id { tile.audible = false }
            Task {
                try? await Task.sleep(for: .milliseconds(150))
                guard focused == id else { return }
                tiles.first { $0.id == id }?.audible = true
            }
        }
        .task {
            // Free memory for the games: no background preload while here.
            #if DEBUG
            print("[mv] web views alive before cancel: \(WebEngines.liveCount)")
            #endif
            Warmup.shared.suspended = true
            #if DEBUG
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { print("[mv] web views alive 8s later: \(WebEngines.liveCount)") }
            #endif
            focused = tiles.first?.id
            tiles.first?.audible = true
            // Fewer contenders per tile when there are more tiles: an Apple
            // TV has to decode every stream on screen.
            // A real Apple TV runs out of memory with a dozen video pages at
            // once, so tiles start one after another with few contenders.
            // One server page per tile at a time (each page is a whole web
            // process); a tile whose server fails moves on to the next.
            let perTile = 1
            let cap = MultiviewCapacity.games
            // The next tile starts as soon as the one before it plays (its
            // page load is the heavy part), or after 3s.
            for (index, tile) in tiles.enumerated() {
                if index > 0 {
                    let previous = tiles[index - 1]
                    let deadline = Date().addingTimeInterval(3)
                    while !previous.started, !previous.gaveUp, !previous.throttled, Date() < deadline {
                        try? await Task.sleep(for: .milliseconds(150))
                    }
                }
                // Already at this Apple TV's limit: the rest wait until picked.
                if overloaded || index >= cap { tile.deferStart(streamsPerTile: perTile) } else { Task { await tile.start(streamsPerTile: perTile) } }
            }
        }
        // Frames dropping: pause one game at a time, worst first, never the
        // one being watched. Apple TV HD and 4K differ a lot, so it's measured.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard expanded == nil else { continue }
                let playing = tiles.filter { $0.started && !$0.isHeld }
                let now = Date()
                if let frozen = playing.first(where: { $0.frozenFor > 8 }) {
                    if playing.count > 1, frozen.id != focused {
                        frozen.throttle(); overloaded = true; lastLoadAction = now
                        MultiviewCapacity.lower(to: playing.count - 1)
                    } else if playing.count == 1 {
                        frozen.switchServer()
                    }
                    continue
                }
                guard playing.count >= 2, now.timeIntervalSince(lastLoadAction) > 15 else { continue }
                let rates = playing.map(\.dropRate)
                guard rates.contains(where: { $0 > 0.3 }), rates.reduce(0, +) / Double(rates.count) >= 0.2 else { continue }
                let candidates = playing.filter { $0.id != focused }
                let order = { (tile: MultiviewTile) in tiles.firstIndex { $0 === tile } ?? 0 }
                // Worst first; on a tie the later game (the first ones were picked first).
                guard let victim = candidates.max(by: { ($0.dropRate, order($0)) < ($1.dropRate, order($1)) }) else { continue }
                victim.throttle()
                overloaded = true
                lastLoadAction = now
                MultiviewCapacity.lower(to: playing.count - 1)
            }
        }
        // New slots (a game starting or changing server) get positioned.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if page != nil { slotTick &+= 1 }
            }
        }
        // tvOS says memory is low: close the game watched longest ago now,
        // before the system has to (which can take down the whole Apple TV).
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            let active = tiles.filter { $0.isActive && $0.id != focused }
            guard let victim = active.max(by: { (recent.firstIndex(of: $0.id) ?? Int.max) < (recent.firstIndex(of: $1.id) ?? Int.max) }) else { return }
            victim.throttle()
            overloaded = true
            lastLoadAction = Date()
            MultiviewCapacity.lower(to: tiles.filter(\.isActive).count)
        }
        // Keep the TV in one display mode: with Match Content on, tvOS
        // switches the TV's frame rate per video, and games at 50 and 60fps
        // made the TV re-sync its HDMI signal over and over.
        .task {
            while !Task.isCancelled {
                for scene in UIApplication.shared.connectedScenes {
                    for window in (scene as? UIWindowScene)?.windows ?? [] where window.avDisplayManager.preferredDisplayCriteria != nil {
                        window.avDisplayManager.preferredDisplayCriteria = nil
                    }
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        // Full screen: only that game is decoded; the others pause and rejoin
        // at the live edge when the grid comes back.
        .onChange(of: expanded) { _, id in
            for tile in tiles {
                if let id, tile.id != id { tile.hold() } else { tile.release() }
            }
        }
        .onDisappear {
            tiles.forEach { $0.stop() }
            Warmup.shared.suspended = false
        }
    }

    // The shared page's iframes follow the tiles (and a game's new slot after a server change).
    private func layoutKey(_ frames: [String: CGRect]) -> String {
        tiles.map { tile in "\(tile.slotId ?? "-")@\(frames[tile.id].map { "\(Int($0.minX)),\(Int($0.minY)),\(Int($0.width))" } ?? "")" }
            .joined(separator: "|") + "|\(expanded ?? "")|\(slotTick)"
    }

    private func syncPage(_ page: MultiviewPage, _ frames: [String: CGRect]) {
        page.layout(tiles.compactMap { tile in
            guard let slot = tile.slotId, let rect = frames[tile.id] else { return nil }
            return (slot, rect, expanded != nil && expanded != tile.id)
        })
    }

    private var mainId: String? { main ?? tiles.first?.id }
    private var usesMain: Bool { layoutChoice == MultiviewLayout.main.rawValue && (2...3).contains(tiles.count) }

    // Layout 1: equal 16:9 tiles, two per row, rows centred.
    private func gridLayout(in size: CGSize) -> [String: CGRect] {
        var frames: [String: CGRect] = [:]
        let gap: CGFloat = 16
        let columns = 2
        let rows = tiles.count <= 2 ? 1 : 2
        let width = (size.width - gap * CGFloat(columns + 1)) / CGFloat(columns)
        let height = min(width * 9 / 16, (size.height - gap * CGFloat(rows + 1)) / CGFloat(rows))
        let tileWidth = height * 16 / 9
        let totalHeight = CGFloat(rows) * height + CGFloat(rows - 1) * gap
        let top = (size.height - totalHeight) / 2
        for (index, tile) in tiles.enumerated() {
            let row = index / columns, column = index % columns
            let inRow = min(columns, tiles.count - row * columns)
            let rowWidth = CGFloat(inRow) * tileWidth + CGFloat(inRow - 1) * gap
            let left = (size.width - rowWidth) / 2
            frames[tile.id] = CGRect(x: left + CGFloat(column) * (tileWidth + gap),
                                     y: top + CGFloat(row) * (height + gap),
                                     width: tileWidth, height: height)
        }
        return frames
    }

    // Layout 2 — 1 game: full screen. 2–3: the main game large on the left,
    // the others stacked on the right. 4: a 2×2 grid. Expanded (either
    // layout): one full screen.
    private func layout(in size: CGSize) -> [String: CGRect] {
        var frames: [String: CGRect] = [:]
        if let expanded {
            for tile in tiles {
                frames[tile.id] = tile.id == expanded ? CGRect(origin: .zero, size: size) : CGRect(x: 0, y: 0, width: 16, height: 9)
            }
            return frames
        }
        if layoutChoice != MultiviewLayout.main.rawValue { return gridLayout(in: size) }
        let gap: CGFloat = 16
        func fit(width: CGFloat, height: CGFloat) -> CGSize {
            let w = min(width, height * 16 / 9)
            return CGSize(width: w, height: w * 9 / 16)
        }
        switch tiles.count {
        case 0:
            return frames
        case 1:
            frames[tiles[0].id] = CGRect(origin: .zero, size: size)
        case 2, 3:
            let others = tiles.filter { $0.id != mainId }
            let rows = CGFloat(others.count)
            // Side column holds `rows` 16:9 tiles stacked; the main tile
            // takes the remaining width. Solve for the side width so both
            // columns fill the screen height as well as possible.
            let sideWidth = min(size.width * (rows == 1 ? 0.27 : 0.3),
                                ((size.height - gap * (rows + 1)) / rows) * 16 / 9)
            let side = CGSize(width: sideWidth, height: sideWidth * 9 / 16)
            let big = fit(width: size.width - side.width - gap * 3, height: size.height - gap * 2)
            let totalWidth = big.width + gap + side.width
            let left = (size.width - totalWidth) / 2
            if let main = tiles.first(where: { $0.id == mainId }) {
                frames[main.id] = CGRect(x: left, y: (size.height - big.height) / 2, width: big.width, height: big.height)
            }
            let columnHeight = rows * side.height + (rows - 1) * gap
            var y = (size.height - columnHeight) / 2
            for tile in others {
                frames[tile.id] = CGRect(x: left + big.width + gap, y: y, width: side.width, height: side.height)
                y += side.height + gap
            }
        default:
            let cell = fit(width: (size.width - gap * 3) / 2, height: (size.height - gap * 3) / 2)
            let left = (size.width - (cell.width * 2 + gap)) / 2
            let top = (size.height - (cell.height * 2 + gap)) / 2
            for (index, tile) in tiles.prefix(4).enumerated() {
                frames[tile.id] = CGRect(x: left + CGFloat(index % 2) * (cell.width + gap),
                                         y: top + CGFloat(index / 2) * (cell.height + gap),
                                         width: cell.width, height: cell.height)
            }
        }
        return frames
    }
}

private struct TileButton: View {
    @ObservedObject var tile: MultiviewTile
    let focused: Bool
    let showFocus: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                TileSurface(tile: tile)
                if !tile.started && !tile.throttled {
                    VStack(spacing: 14) {
                        ProgressView()
                        Text(tile.status).font(.callout.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if tile.throttled {
                    VStack(spacing: 10) {
                        Image(systemName: "pause.fill").font(.title2)
                        Text("Paused to keep the others smooth").font(.callout.weight(.semibold))
                        Text("Press to watch this game").font(.caption).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black.opacity(0.72))
                }
                if showFocus || !tile.started {
                    HStack(spacing: 12) {
                        Circle().fill(Color(hex: 0xFF5A50)).frame(width: 12, height: 12)
                        Text(tile.game.title).font(.callout.weight(.bold)).lineLimit(1)
                        Spacer(minLength: 8)
                        // The server playing; on the focused tile, how to change it.
                        if let name = tile.streamName {
                            Text(focused && showFocus ? "\(name) · hold to change" : name)
                                .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        if tile.paused && tile.started { Image(systemName: "pause.fill") }
                        Image(systemName: tile.audible ? "speaker.wave.2.fill" : "speaker.slash.fill")
                            .foregroundStyle(tile.audible ? Theme.gold : Theme.muted)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 14)
                    .background(LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: showFocus ? 14 : 0))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Theme.gold, lineWidth: focused && showFocus ? 6 : 0)
            }
        }
        .buttonStyle(TileButtonStyle())
        // Hold select: this game's servers.
        .contextMenu {
            if tile.options.isEmpty {
                Text("Looking for servers…")
            } else {
                ForEach(tile.options) { server in
                    Button { tile.choose(server) } label: {
                        if server.name == tile.streamName { Label(server.name, systemImage: "checkmark") } else { Text(server.name) }
                    }
                }
            }
        }
    }
}

private struct TileButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

private struct TileSurface: UIViewRepresentable {
    let tile: MultiviewTile
    func makeUIView(context: Context) -> UIView {
        tile.surface.isUserInteractionEnabled = false
        return tile.surface
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

enum MultiviewLayout: String, CaseIterable, Identifiable {
    case grid, main
    static let key = "binge.multiviewLayout"
    var id: String { rawValue }
    var label: String { self == .grid ? "Equal tiles" : "One big, others beside" }
}

// How many games this Apple TV plays at once in Multiview. More than two
// overloaded a real Apple TV (memory and video decoding) badly enough to
// restart it, so two is the most, and the older Apple TV HD gets one. A
// session that has to pause a game lowers it for next time.
enum MultiviewCapacity {
    private static var key: String { MultiviewEngine.current == .page ? "binge.multiviewCapacity.page" : "binge.multiviewCapacity" }

    static var deviceLimit: Int {
        var info = utsname()
        uname(&info)
        let machine = withUnsafePointer(to: &info.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
        // AppleTV5,3 is the Apple TV HD (A8, 2GB). Separate pages: 1 there,
        // 2 on the 4K models. One shared page costs far less memory: 2 and 4.
        let hd = machine.hasPrefix("AppleTV5,")
        if MultiviewEngine.current == .page { return hd ? 2 : 4 }
        return hd ? 1 : 2
    }

    static var games: Int {
        let saved = UserDefaults.standard.integer(forKey: key)
        return max(1, min(deviceLimit, saved == 0 ? deviceLimit : saved))
    }

    static func lower(to count: Int) {
        guard count >= 1, count < games else { return }
        UserDefaults.standard.set(count, forKey: key)
    }
}
