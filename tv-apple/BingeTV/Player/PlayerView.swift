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
                    case .left: model.seek(by: -10)
                    case .right: model.seek(by: 10)
                    case .down: panelOpen = true
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

            if !model.started {
                LoadingCard(model: model)
            }

            if model.hudVisible || !model.started {
                HUD(model: model).transition(.opacity)
            }

            if let countdown = model.upNextCountdown, countdown > 0, let next = model.nextEpisode {
                UpNextCard(season: next.season, episode: next.episode, seconds: countdown)
            }

            if panelOpen {
                PlayerPanel(model: model) {
                    panelOpen = false
                    surfaceFocused = true
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.hudVisible)
        .animation(.easeInOut(duration: 0.25), value: panelOpen)
        .onAppear { surfaceFocused = true }
        .onDisappear { model.close() }
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
                    Text("Click  Pause / play     ▼  Other streams     Back  Exit")
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
                Text("◀ ▶  10 seconds     ▼  Servers & episodes     Back  Exit")
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
            Text("UP NEXT").font(.caption.weight(.heavy)).tracking(2).foregroundStyle(Theme.gold)
            Text("S\(season):E\(episode) in \(seconds)s").font(.title3.weight(.bold))
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

// Swipe down: switch server, jump to another episode.
private struct PlayerPanel: View {
    @ObservedObject var model: PlayerModel
    let close: () -> Void
    @State private var episodes: [TMDBSeason.Episode] = []
    @FocusState private var focusedServer: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            Spacer()
            VStack(alignment: .leading, spacing: 26) {
                Text(model.request.isLive ? "Stream" : "Server").font(.headline).foregroundStyle(Theme.muted)
                HStack(spacing: 24) {
                    ForEach(model.servers) { server in
                        Button {
                            model.choose(server)
                            close()
                        } label: {
                            Label(server.name, systemImage: server == model.server ? "checkmark.circle.fill" : "play.circle")
                        }
                        .focused($focusedServer, equals: server.id)
                    }
                }
                .focusSection()

                if model.isEpisode, !episodes.isEmpty {
                    Text("Season \(model.request.season ?? 1)").font(.headline).foregroundStyle(Theme.muted)
                    ScrollView(.horizontal) {
                        LazyHStack(spacing: 30) {
                            ForEach(episodes) { episode in
                                Button {
                                    model.play(season: episode.seasonNumber, episode: episode.episodeNumber)
                                    close()
                                } label: {
                                    VStack(alignment: .leading, spacing: 0) {
                                        PosterImage(url: TMDB.image(episode.stillPath, "w300"), name: "Episode \(episode.episodeNumber)")
                                            .frame(width: 300, height: 169)
                                            .clipped()
                                        Text("\(episode.episodeNumber). \(episode.name ?? "")")
                                            .font(.caption.weight(.semibold))
                                            .lineLimit(1)
                                            .padding(12)
                                            .frame(width: 300, alignment: .leading)
                                            .background(episode.episodeNumber == model.request.episode ? Theme.gold.opacity(0.35) : Theme.surface)
                                    }
                                }
                                .buttonStyle(.card)
                            }
                        }
                        .padding(.vertical, 24)
                    }
                    .scrollClipDisabled()
                    .focusSection()
                }
            }
            .padding(.horizontal, Theme.edge)
            .padding(.vertical, 50)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.92), .black], startPoint: .top, endPoint: .bottom))
        }
        .ignoresSafeArea()
        .onAppear { focusedServer = model.server?.id ?? model.servers.first?.id }
        .onExitCommand(perform: close)
        .task {
            guard model.isEpisode, let tmdbId = model.request.title.tmdbId else { return }
            let season: TMDBSeason? = try? await TMDB.shared.get("tv/\(tmdbId)/season/\(model.request.season ?? 1)")
            episodes = season?.episodes ?? []
        }
    }
}
