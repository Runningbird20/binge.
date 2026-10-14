import SwiftUI

struct PlayerView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: PlayerModel
    @State private var panelOpen = false
    @FocusState private var surfaceFocused: Bool

    init(request: PlayRequest, app: AppModel) {
        _model = StateObject(wrappedValue: PlayerModel(request: request, app: app))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            WebSurface(model: model).ignoresSafeArea()

            // An invisible, focusable layer that receives the Siri remote.
            Button { model.togglePlay() } label: { Color.clear.contentShape(Rectangle()) }
                .buttonStyle(SurfaceButtonStyle())
                .focused($surfaceFocused)
                .disabled(panelOpen)
                .onMoveCommand { direction in
                    switch direction {
                    case .left where model.request.isLive: model.flipGame(by: -1)
                    case .right where model.request.isLive: model.flipGame(by: 1)
                    case .left: model.seek(by: -10)
                    case .right: model.seek(by: 10)
                    case .down where model.showSkipIntro: model.dismissSkipIntro()
                    case .down: panelOpen = true
                    case .up where model.showSkipIntro: model.skipIntro()
                    default: model.showHUD()
                    }
                }
                .onPlayPauseCommand { model.togglePlay() }
                .onExitCommand {
                    if model.upNextCountdown ?? -1 > 0 {
                        model.cancelUpNext()
                    } else {
                        model.close()
                        dismiss()
                    }
                }
                .ignoresSafeArea()

            // Subtitles, drawn here from the video's own track (WebKit
            // doesn't draw them reliably on tvOS, and servers' own caption
            // overlays are hidden in fill mode). Style from Settings.
            if model.started, !model.subtitleText.isEmpty {
                SubtitleLine(text: model.subtitleText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    // Above the corner Skip intro button while it shows.
                    .padding(.bottom, model.hudVisible ? 200 : (model.showSkipIntro ? 150 : 70))
                    .animation(.easeOut(duration: 0.2), value: model.hudVisible)
                    .allowsHitTesting(false)
            }

            if !model.started {
                LoadingCard(model: model)
            } else if model.buffering {
                ProgressView()
                    .scaleEffect(1.6)
                    .padding(40)
                    .background(.black.opacity(0.45), in: Circle())
                    .allowsHitTesting(false)
                    .accessibilityLabel("Buffering")
            }

            if model.hudVisible || !model.started {
                HUD(model: model).transition(.opacity)
            }

            // Bottom-right corner, out of the picture's way; lifts above the
            // HUD's progress bar only while that shows. ▲ skips, ▼ hides it.
            if model.showSkipIntro {
                VStack(alignment: .trailing, spacing: 10) {
                    Label("Skip intro", systemImage: "forward.fill")
                        .font(.headline)
                        .padding(.horizontal, 28)
                        .padding(.vertical, 16)
                        .background(.white, in: Capsule())
                        .foregroundStyle(.black)
                    Text("\(Image(systemName: "chevron.up")) skip · \(Image(systemName: "chevron.down")) hide")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white.opacity(0.75))
                        .shadow(color: .black.opacity(0.8), radius: 4)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .padding(.trailing, 60)
                .padding(.bottom, model.hudVisible ? 190 : 50)
                .allowsHitTesting(false)
                .transition(.opacity)
            }

            if model.stillWatching {
                VStack(spacing: 18) {
                    Text("Still watching?").font(.system(size: 52, weight: .heavy))
                    Text(model.request.title.name).font(.title3).foregroundStyle(Theme.muted)
                    Text("Click to keep going · Back to stop").font(.callout).foregroundStyle(Theme.muted)
                }
                .padding(60)
                .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 30))
                .allowsHitTesting(false)
            }

            if let countdown = model.upNextCountdown, countdown > 0, let next = model.nextEpisode {
                UpNextCard(season: next.season, episode: next.episode, seconds: countdown)
            }

            if model.pausedAmbient {
                AmbientView(titles: [model.request.title] + AmbientStore.shared.titles.filter { $0.id != model.request.title.id },
                            resumeLabel: "Resume \(model.request.title.name)",
                            resume: { model.togglePlay(); surfaceFocused = true },
                            dismiss: { model.leaveAmbient(); surfaceFocused = true })
                    .transition(.opacity)
            }

            if panelOpen {
                PlayerPanel(model: model) {
                    panelOpen = false
                    surfaceFocused = true
                }
                .transition(.move(edge: .trailing))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.hudVisible)
        .animation(.easeInOut(duration: 0.25), value: model.showSkipIntro)
        .animation(.easeInOut(duration: 0.25), value: panelOpen)
        .onAppear {
            surfaceFocused = true
            #if DEBUG
            // -BingePanel YES: open the options sidebar right away (screenshots).
            if UserDefaults.standard.bool(forKey: "BingePanel") { panelOpen = true }
            #endif
        }
        .onDisappear { model.close() }
    }
}

private extension PlayerPanel {
    // Corner game + a recent game alert, when there's anything to show.
    @ViewBuilder
    var extrasRow: some View {
        let alert = teams.recent.flatMap { Date().timeIntervalSince($0.at) < 20 * 60 ? $0 : nil }
        if model.request.isLive || pip.tile != nil || alert != nil {
            VStack(alignment: .leading, spacing: 12) {
                if let alert {
                    Label(alert.headline, systemImage: "sportscourt.fill").font(.callout.weight(.semibold)).lineLimit(1)
                    Button("Watch now") { watchAlert(alert, inCorner: false) }.buttonStyle(PillButtonStyle(selected: true))
                    Button("In the corner") { watchAlert(alert, inCorner: true) }.buttonStyle(PillButtonStyle())
                }
                if model.request.isLive, let game = model.request.game, pip.game != game {
                    Button {
                        PiPController.shared.show(game)
                        model.close()
                        dismissPlayer()
                    } label: { Label("Keep watching in the corner", systemImage: "pip") }
                    .buttonStyle(PillButtonStyle())
                }
                if let corner = pip.game {
                    Button {
                        Task { await model.switchToLive(corner); PiPController.shared.close(); close() }
                    } label: { Label("Full screen: \(corner.title)", systemImage: "arrow.up.left.and.arrow.down.right") }
                    .buttonStyle(PillButtonStyle())
                    Button("Close corner game") { PiPController.shared.close() }
                        .buttonStyle(PillButtonStyle())
                }
            }
            .focusSection()
        }
    }

    func watchAlert(_ alert: GameAlert, inCorner: Bool) {
        alertBusy = true
        Task {
            if let game = await SportsFeed.game(for: alert) {
                if inCorner { PiPController.shared.show(game) } else { await model.switchToLive(game) }
                close()
            } else {
                model.notice = "No stream for that game yet."
            }
            alertBusy = false
        }
    }
}

private struct SurfaceButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label }
}

private struct WebSurface: UIViewRepresentable {
    let model: PlayerModel
    func makeUIView(context: Context) -> UIView {
        model.surface.isUserInteractionEnabled = false // the remote goes to our layer
        return model.surface
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

private func clock(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else { return "0:00" }
    let total = Int(seconds)
    let h = total / 3600, m = (total % 3600) / 60, s = total % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

private struct SubtitleLine: View {
    let text: String

    private var background: Color {
        switch PlaybackPrefs.captionBackground {
        case "transparent": return .clear
        case "rgba(0,0,0,1)": return .black
        default: return .black.opacity(0.6)
        }
    }

    var body: some View {
        Text(text)
            .font(.system(size: 46 * CGFloat(PlaybackPrefs.captionSize) / 100, weight: .semibold))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .shadow(color: .black.opacity(PlaybackPrefs.captionBackground == "transparent" ? 0.95 : 0), radius: 3)
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .background(background, in: RoundedRectangle(cornerRadius: 8))
            .frame(maxWidth: 1500)
            .accessibilityLabel("Subtitle: \(text)")
    }
}

private struct HUD: View {
    @ObservedObject var model: PlayerModel

    var body: some View {
        VStack {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.request.title.name).font(.title3.weight(.bold))
                    if let label = model.episodeLabel {
                        Text(label).font(.callout).foregroundStyle(Theme.muted)
                    }
                }
                Spacer()
                if let quality = model.resolutionLabel {
                    Text(quality)
                        .font(.caption.weight(.heavy))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white.opacity(0.7), lineWidth: 1.5))
                        .accessibilityLabel("Playing in \(quality)")
                }
                if let server = model.server {
                    Label(server.name, systemImage: "server.rack")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, Theme.edge)
            .padding(.top, 50)
            .padding(.bottom, 70)
            .background(LinearGradient(colors: [.black.opacity(0.8), .clear], startPoint: .top, endPoint: .bottom))

            Spacer()

            if model.started {
            VStack(alignment: .leading, spacing: 16) {
                if let notice = model.notice {
                    Text(notice).font(.callout.weight(.semibold)).foregroundStyle(Theme.gold)
                }
                if model.request.isLive {
                    HStack(spacing: 20) {
                        Label("LIVE", systemImage: "circle.fill")
                            .font(.callout.weight(.heavy))
                            .foregroundStyle(Color(hex: 0xFF5A50))
                        Image(systemName: model.playback.paused ? "play.fill" : "pause.fill")
                    }
                    Text("Click  Pause / play     \(Image(systemName: "chevron.left")) \(Image(systemName: "chevron.right"))  Other games     \(Image(systemName: "chevron.down"))  Options     Back  Exit")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                } else {
                HStack(spacing: 24) {
                    Image(systemName: model.playback.paused ? "play.fill" : "pause.fill")
                        .font(.title3)
                    Text(clock(model.playback.t)).monospacedDigit()
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.25))
                            Capsule().fill(Theme.gold)
                                .frame(width: model.playback.d > 0 ? proxy.size.width * min(1, model.playback.t / model.playback.d) : 0)
                        }
                    }
                    .frame(height: 8)
                    Text("-" + clock(max(0, model.playback.d - model.playback.t))).monospacedDigit()
                }
                .font(.callout.weight(.semibold))
                Text("\(Image(systemName: "chevron.left")) \(Image(systemName: "chevron.right"))  10 seconds     \(Image(systemName: "chevron.down"))  Options     Back  Exit")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, Theme.edge)
            .padding(.bottom, 50)
            .padding(.top, 80)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom))
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

private struct LoadingCard: View {
    @ObservedObject var model: PlayerModel
    var body: some View {
        VStack(spacing: 22) {
            ProgressView()
            Text("Finding the fastest server…").font(.headline)
            if !model.racingNames.isEmpty {
                Text("Trying \(model.racingNames) at once").font(.callout).foregroundStyle(Theme.muted)
            }
            if let notice = model.notice {
                Text(notice).font(.callout).foregroundStyle(Theme.gold).multilineTextAlignment(.center)
            }
            Text("Swipe down to pick another server").font(.caption).foregroundStyle(Theme.muted)
        }
        .padding(40)
        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 24))
        .allowsHitTesting(false)
    }
}

private struct UpNextCard: View {
    let season: Int
    let episode: Int
    let seconds: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Next: S\(season):E\(episode)").font(.title3.weight(.bold))
            Text("Starts in \(seconds) seconds").font(.callout).monospacedDigit()
            Text("Click to play now · Back to keep watching").font(.caption).foregroundStyle(Theme.muted)
        }
        .padding(30)
        .background(Theme.surface.opacity(0.95), in: RoundedRectangle(cornerRadius: 22))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .padding(.trailing, Theme.edge)
        .padding(.bottom, 170)
        .allowsHitTesting(false)
    }
}

// Swipe down: the options sidebar (as on Fire TV / Prime Video). A list of
// settings with their current value; picking one opens its choices in the
// same sidebar. Back goes up a level, then closes.
private enum Pane: String {
    case menu = "Options", audio = "Audio", subtitles = "Subtitles", timing = "Subtitle timing", server = "Server"
    case picture = "Picture", quality = "Quality", sleep = "Sleep timer", episodes = "Episodes"
}

private struct PlayerPanel: View {
    @ObservedObject var model: PlayerModel
    @ObservedObject var pip = PiPController.shared
    @ObservedObject var teams = TeamCenter.shared
    @Environment(\.dismiss) var dismissPlayer
    let close: () -> Void
    @State var alertBusy = false
    @State private var episodes: [TMDBSeason.Episode] = []
    @State private var pane: Pane = .menu
    @State private var from: Pane = .menu
    @FocusState private var focus: String?

    var body: some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 6) {
                Text(pane == .menu ? "Options" : (pane == .server && model.request.isLive ? "Stream" : pane.rawValue))
                    .font(.system(size: 40, weight: .bold))
                if pane == .menu {
                    Text(model.request.title.name + (model.episodeLabel.map { " · \($0)" } ?? ""))
                        .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                } else {
                    Text("Back to return").font(.caption).foregroundStyle(Theme.muted)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) { content }
                        .padding(.vertical, 20)
                }
                .scrollClipDisabled()
            }
            .padding(.top, 70)
            .padding(.horizontal, 36)
            .frame(width: 760, alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Theme.surface.opacity(0.97))
            .focusSection()
        }
        .ignoresSafeArea()
        .disabled(alertBusy)
        .onExitCommand { if pane == .menu { close() } else { open(.menu) } }
        .onAppear { focusFirst() }
        .onChange(of: pane) { _, _ in focusFirst() }
        .task {
            guard model.isEpisode, let tmdbId = model.request.title.tmdbId else { return }
            let season: TMDBSeason? = try? await TMDB.shared.get("tv/\(tmdbId)/season/\(model.request.season ?? 1)")
            episodes = season?.episodes ?? []
        }
    }

    private func open(_ next: Pane) { from = pane; pane = next }

    // Focus lands on what's chosen (or, back on the list, the setting you came from).
    private func focusFirst() {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(60))
            focus = selectedId ?? rowIds.first
        }
    }

    private var selectedId: String? {
        switch pane {
        case .menu: return from == .menu ? nil : from.rawValue
        case .audio: return model.audioTracks.first(where: \.on).map { "a\($0.id)" }
        case .subtitles: return model.useExternal ? "s\(model.subtitleLanguage)" : model.textTracks.first(where: \.on).map { "t\($0.id)" } ?? "soff"
        case .server: return model.server.map { "v\($0.id)" }
        case .picture: return model.fillScreen ? "fill" : "layout"
        case .quality: return "q\(QualityPreference.current.rawValue)"
        case .sleep: return "z\(model.sleep.rawValue)"
        case .episodes: return "e\(model.request.episode ?? 1)"
        case .timing: return "earlier"
        }
    }

    private var rowIds: [String] {
        switch pane {
        case .menu: return menuRows.map(\.pane.rawValue)
        case .audio: return model.audioTracks.count > 1 ? model.audioTracks.map { "a\($0.id)" } : ["pick-server"]
        case .server: return model.servers.map { "v\($0.id)" }
        default: return []
        }
    }

    private var menuRows: [(pane: Pane, label: String, value: String)] {
        var rows: [(pane: Pane, label: String, value: String)] = []
        rows.append((.audio, "Audio", model.audioTracks.first(where: \.on).map(PlayerModel.displayName) ?? "Default"))
        rows.append((.subtitles, "Subtitles", subtitleLabel))
        if model.usingExternalSubtitles {
            rows.append((.timing, "Subtitle timing", model.subtitleOffset == 0 ? "In sync" : String(format: "%+.1fs", model.subtitleOffset)))
        }
        rows.append((.server, model.request.isLive ? "Stream" : "Server", model.server?.name ?? "Choosing…"))
        rows.append((.picture, "Picture", model.fillScreen ? "Fill screen" : "Server's layout"))
        rows.append((.quality, "Quality", QualityPreference.current.label))
        rows.append((.sleep, "Sleep timer", model.sleep.rawValue))
        if model.isEpisode, !episodes.isEmpty { rows.append((.episodes, "Episodes", "Season \(model.request.season ?? 1)")) }
        return rows
    }

    private var subtitleLabel: String {
        if model.useExternal, model.subtitleLanguage != "off" {
            return PlaybackPrefs.subtitleChoices.first { $0.0 == model.subtitleLanguage }?.1 ?? model.subtitleLanguage
        }
        if let track = model.textTracks.first(where: \.on) { return PlayerModel.displayName(track) }
        return "Off"
    }

    @ViewBuilder private var content: some View {
        switch pane {
        case .menu:
            extrasRow
            ForEach(menuRows, id: \.pane) { row in
                SideRow(label: row.label, value: row.value, chevron: true) { open(row.pane) }
                    .focused($focus, equals: row.pane.rawValue)
            }
        case .audio:
            if model.audioTracks.count > 1 {
                ForEach(model.audioTracks) { track in
                    SideRow(label: PlayerModel.displayName(track), selected: track.on) { model.selectAudio(track); close() }
                        .focused($focus, equals: "a\(track.id)")
                }
            } else {
                note(model.audioTracks.isEmpty ? "This server has one audio track."
                                                : "Only \(PlayerModel.displayName(model.audioTracks[0])) on this server.")
                SideRow(label: "Pick another server", chevron: true) { open(.server) }
                    .focused($focus, equals: "pick-server")
            }
        case .subtitles:
            if model.useExternal && model.externalLoading { note("Finding subtitles…") }
            else if model.usingExternalSubtitles, let release = model.external?.release, !release.isEmpty { note(release) }
            ForEach(PlaybackPrefs.subtitleChoices, id: \.0) { code, label in
                let selected = code == "off" ? (!model.useExternal && !model.textTracks.contains(where: \.on))
                                             : (model.useExternal && model.subtitleLanguage == code)
                SideRow(label: label, selected: selected) { model.chooseSubtitleLanguage(code); close() }
                    .focused($focus, equals: "s\(code)")
            }
            if !model.textTracks.isEmpty {
                Text("From this server").font(.headline).foregroundStyle(Theme.muted).padding(.top, 14)
                ForEach(model.textTracks.prefix(30)) { track in
                    SideRow(label: PlayerModel.displayName(track), selected: !model.useExternal && track.on) { model.selectSubtitles(track); close() }
                        .focused($focus, equals: "t\(track.id)")
                }
            }
        case .timing:
            note(model.subtitleOffset == 0 ? "In sync" : String(format: "Shifted %+.1f seconds", model.subtitleOffset))
            SideRow(label: "Earlier (0.5s)") { model.nudgeSubtitles(by: -0.5) }.focused($focus, equals: "earlier")
            SideRow(label: "Later (0.5s)") { model.nudgeSubtitles(by: 0.5) }.focused($focus, equals: "later")
            if (model.external?.versions ?? 0) > 1 {
                SideRow(label: "Another version") { model.nextSubtitleVersion() }.focused($focus, equals: "version")
            }
        case .server:
            ForEach(model.servers) { server in
                SideRow(label: server.name, selected: server == model.server) { model.choose(server); close() }
                    .focused($focus, equals: "v\(server.id)")
            }
        case .picture:
            SideRow(label: "Fill screen", selected: model.fillScreen) { model.fillScreen = true; close() }.focused($focus, equals: "fill")
            SideRow(label: "Server's layout", selected: !model.fillScreen) { model.fillScreen = false; close() }.focused($focus, equals: "layout")
            note("Switch if subtitles or the server's buttons go missing.")
        case .quality:
            ForEach(QualityPreference.allCases) { option in
                SideRow(label: option.label, selected: QualityPreference.current == option) {
                    UserDefaults.standard.set(option.rawValue, forKey: "binge.quality")
                    close()
                }
                .focused($focus, equals: "q\(option.rawValue)")
            }
            note("Best quality starts on the server that has looked sharpest on this Apple TV (it learns from what you watch), waiting a few seconds for it if needed. Fastest start plays whichever server is ready first.")
        case .sleep:
            ForEach(PlayerModel.SleepOption.allCases) { option in
                if option != .episode || model.isEpisode {
                    SideRow(label: option.rawValue, selected: model.sleep == option) { model.sleep = option; close() }
                        .focused($focus, equals: "z\(option.rawValue)")
                }
            }
        case .episodes:
            ForEach(episodes) { episode in
                SideRow(label: "\(episode.episodeNumber). \(episode.name ?? "Episode \(episode.episodeNumber)")",
                        selected: episode.episodeNumber == model.request.episode) {
                    model.play(season: episode.seasonNumber, episode: episode.episodeNumber)
                    close()
                }
                .focused($focus, equals: "e\(episode.episodeNumber)")
            }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.callout).foregroundStyle(Theme.muted).padding(.vertical, 8)
    }
}

// One row of the sidebar: label, current value or a check, and a chevron for
// rows that open more choices. Focused rows turn white (Fire TV's look).
private struct SideRow: View {
    let label: String
    var value: String? = nil
    var selected = false
    var chevron = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                if selected { Image(systemName: "checkmark").font(.callout.weight(.bold)) }
                Text(label).font(.headline).lineLimit(1)
                Spacer(minLength: 12)
                if let value { Text(value).font(.callout).lineLimit(1).opacity(0.7) }
                if chevron { Image(systemName: "chevron.right").font(.callout.weight(.semibold)).opacity(0.7) }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 16)
        }
        .buttonStyle(SideRowStyle(selected: selected))
    }
}

private struct SideRowStyle: ButtonStyle {
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View { SideRowBody(configuration: configuration, selected: selected) }
}

private struct SideRowBody: View {
    let configuration: ButtonStyle.Configuration
    let selected: Bool
    @Environment(\.isFocused) private var focused
    var body: some View {
        configuration.label
            .foregroundStyle(focused ? Color.black : (selected ? Theme.gold : Color.white))
            .background(focused ? Color.white : Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: focused)
    }
}
