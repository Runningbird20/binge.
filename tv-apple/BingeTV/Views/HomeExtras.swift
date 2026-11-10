import SwiftUI

// "Surprise me with a movie / a series" (the website's SurpriseButtons): one
// title of that type from the profile's own picks, opened on its page.
struct SurpriseButtons: View {
    let personal: Personal.Rows
    let fallback: [Title]
    let watched: Set<String>
    let open: (Title) -> Void

    var body: some View {
        let movies = Surprise.pool(personal, fallback: fallback, kind: .movie, exclude: watched)
        let series = Surprise.pool(personal, fallback: fallback, kind: .tvShow, exclude: watched)
        if !movies.isEmpty || !series.isEmpty {
            HStack(spacing: 28) {
                if !movies.isEmpty { button("Surprise me with a movie", movies) }
                if !series.isEmpty { button("Surprise me with a series", series) }
            }
            .focusSection()
        }
    }

    private func button(_ label: String, _ pool: [Title]) -> some View {
        Button {
            guard let pick = Surprise.pick(pool, recent: Surprise.recent) else { return }
            Surprise.remember(pick)
            open(pick)
        } label: {
            Label(label, systemImage: "shuffle")
        }
        .buttonStyle(ActionButtonStyle())
    }
}

// What's playing in the corner: back to full screen (the same stream, no
// reload), pause or play, or close it.
struct CornerBar: View {
    @ObservedObject var episode: CornerEpisode
    let fullScreen: (PlayRequest) -> Void

    var body: some View {
        HStack(spacing: 24) {
            Image(systemName: "pip").font(.title3)
            Text("In the corner: \(episode.label)").font(.headline).lineLimit(1)
            Spacer(minLength: 20)
            Button {
                if let request = PiPController.shared.fullScreenEpisode() { fullScreen(request) }
            } label: { Label("Full screen", systemImage: "arrow.up.left.and.arrow.down.right") }
            .buttonStyle(ActionButtonStyle(primary: true))
            Button { episode.setPaused(!episode.paused) } label: {
                Label(episode.paused ? "Play" : "Pause", systemImage: episode.paused ? "play.fill" : "pause.fill")
            }
            .buttonStyle(ActionButtonStyle())
            Button("Close") { PiPController.shared.closeEpisode() }.buttonStyle(ActionButtonStyle())
        }
        .padding(.horizontal, 34)
        .padding(.vertical, 20)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.top, 20)
        .focusSection()
    }
}

// Reminders that are due (set here or on the website): open the title, or
// dismiss. The website pushes them to phones; the TV shows them here.
struct ReminderBanner: View {
    let reminders: [Reminder]
    let open: (Reminder) -> Void
    let dismiss: (Reminder) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(reminders.prefix(3)) { reminder in
                HStack(spacing: 28) {
                    Image(systemName: "bell.fill").font(.title3)
                    Text("\(reminder.title) is ready to watch.")
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 20)
                    Button("Open") { open(reminder) }.buttonStyle(ActionButtonStyle(primary: true))
                    Button("Dismiss") { dismiss(reminder) }.buttonStyle(ActionButtonStyle())
                }
                .padding(.horizontal, 34)
                .padding(.vertical, 20)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
        }
        .padding(.top, 20)
        .focusSection()
    }
}

// Messages posted from the admin panel (site_announcements), the same ones
// the website shows on every page. Dismissing hides one on this Apple TV.
struct AnnouncementBanner: View {
    struct Announcement: Decodable, Identifiable {
        let id: Int
        let message: String
        let level: String?
        let linkLabel: String?
        let linkUrl: String?
        let endsAt: String?
    }

    private static let dismissedKey = "binge.dismissedAnnouncements"
    @State private var current: Announcement?

    var body: some View {
        Group {
            if let current {
                HStack(spacing: 28) {
                    Image(systemName: icon(current.level))
                        .font(.title3)
                        .foregroundStyle(current.level == "critical" ? Color(hex: 0xFF8A80) : .white)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(current.message).font(.headline).lineLimit(3)
                        // TV apps can't open links; say where it goes.
                        if let link = current.linkUrl, !link.isEmpty {
                            Text("\(current.linkLabel ?? "More") at \(link.hasPrefix("/") ? Config.siteHost + link : link)")
                                .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 20)
                    Button("Dismiss") { dismiss(current) }.buttonStyle(ActionButtonStyle())
                }
                .padding(.horizontal, 34)
                .padding(.vertical, 22)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .padding(.top, 20)
                .focusSection()
                .accessibilityElement(children: .combine)
            }
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(300))
            }
        }
    }

    private func icon(_ level: String?) -> String {
        switch level {
        case "critical": return "exclamationmark.octagon.fill"
        case "warning": return "exclamationmark.triangle.fill"
        default: return "info.circle.fill"
        }
    }

    private func load() async {
        let now = ISO8601DateFormatter().string(from: Date())
        let rows: [Announcement] = (try? await Supabase.shared.select("site_announcements", [
            URLQueryItem(name: "select", value: "id,message,level,link_url,link_label,ends_at"),
            URLQueryItem(name: "active", value: "eq.true"),
            URLQueryItem(name: "starts_at", value: "lte.\(now)"),
            URLQueryItem(name: "order", value: "created_at.desc"),
            URLQueryItem(name: "limit", value: "5"),
        ], auth: .optional)) ?? []
        let hidden = Set(UserDefaults.standard.array(forKey: Self.dismissedKey) as? [Int] ?? [])
        current = rows.first { row in
            !hidden.contains(row.id) && (row.endsAt.flatMap(ISODate.parse).map { $0 > Date() } ?? true)
        }
    }

    private func dismiss(_ announcement: Announcement) {
        let hidden = UserDefaults.standard.array(forKey: Self.dismissedKey) as? [Int] ?? []
        UserDefaults.standard.set(Array((hidden + [announcement.id]).suffix(50)), forKey: Self.dismissedKey)
        current = nil
    }
}
