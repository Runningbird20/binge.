import Foundation

// The notification inbox: the website's bell (src/utils/notificationsInbox.js).
// Every alert binge. sends (new episodes, reminders, your teams' games,
// announcements, server alerts to admins) is kept 30 days in `notifications`.
// The server writes the rows; the TV reads this profile's and the whole
// account's (profile_id null) and marks them read, so an alert read here is
// read on the website too, and the other way round.
struct InboxAlert: Decodable, Identifiable, Hashable {
    static let columns = "id,kind,title,body,url,created_at,read_at"
    static let days = 30

    let id: Int
    let kind: String
    let title: String
    let body: String
    let url: String?
    let createdAt: String
    var readAt: String?

    var unread: Bool { readAt == nil }
    var created: Date? { ISODate.parse(createdAt) }

    // The website draws a Phosphor icon per kind; these are the closest SF Symbols.
    var symbol: String {
        switch kind {
        case "episode": return "tv"
        case "reminder": return "alarm"
        case "game": return "trophy"
        case "announcement": return "megaphone"
        case "server": return "server.rack"
        default: return "bell"
        }
    }

    // Where opening it goes. Other links (the admin pages, an announcement's
    // page) have no screen on the TV: opening those only marks them read.
    var opens: InboxDestination? { url.flatMap(InboxDestination.init(sitePath:)) }
}

enum InboxDestination: Equatable {
    case title(DeepLink)
    case sports

    init?(sitePath: String) {
        if let link = DeepLink(sitePath: sitePath) {
            self = .title(link)
        } else if let parts = URLComponents(string: sitePath), parts.host == nil, parts.path == "/sports" {
            self = .sports
        } else {
            return nil
        }
    }
}

extension DeepLink {
    // A website link, as alerts carry them: /movie/12, /tv-show/34?play=1&season=2&episode=5,
    // a reminder's /movie/12?play=1&reminder=7, with an optional &t= second.
    // Read as the Top Shelf link to the same place.
    init?(sitePath: String) {
        // A path on the site only: a link to anywhere else isn't a title here.
        guard let parts = URLComponents(string: sitePath), parts.scheme == nil, parts.host == nil else { return nil }
        let segments = parts.path.split(separator: "/")
        guard segments.count == 2, let id = Int(segments[1]) else { return nil }
        let kind: MediaKind
        switch segments[0] {
        case "movie": kind = .movie
        case "tv-show": kind = .tvShow
        default: return nil
        }
        func value(_ name: String) -> String? { parts.queryItems?.first { $0.name == name }?.value }
        var link = URLComponents()
        link.scheme = "binge"
        link.host = value("play") == "1" ? "play" : "title"
        link.queryItems = [URLQueryItem(name: "kind", value: kind.rawValue), URLQueryItem(name: "id", value: String(id))]
            + [("s", value("season")), ("e", value("episode")), ("t", value("t"))].compactMap { name, found in
                found.map { URLQueryItem(name: name, value: $0) }
            }
        guard let url = link.url else { return nil }
        self.init(url)
    }
}

// The inbox for the profile on screen: loaded when the app opens, every 5
// minutes after (MainTabs), and when the Me tab or the page opens. Read
// marks show at once and are saved in the background.
@MainActor
final class InboxStore: ObservableObject {
    static let shared = InboxStore()

    // nil until this profile's inbox has loaded.
    @Published private(set) var alerts: [InboxAlert]?
    @Published private(set) var failed = false
    private var owner: String?
    private var loadedAt = Date.distantPast

    var unreadIds: [Int] { alerts?.filter(\.unread).map(\.id) ?? [] }

    // Loads again at most once a minute, unless `force` (opening the page or Try again).
    func refresh(_ app: AppModel, force: Bool = false) async {
        guard let session = app.session else {
            alerts = []
            failed = false
            owner = nil
            return
        }
        let key = "\(session.userId):\(app.profile?.id ?? "")"
        if key != owner {
            alerts = nil
            failed = false
            owner = key
            loadedAt = .distantPast
        }
        guard force || Date().timeIntervalSince(loadedAt) > 60 else { return }
        let since = Date().addingTimeInterval(-Double(InboxAlert.days) * 86_400)
        var query = [
            URLQueryItem(name: "select", value: InboxAlert.columns),
            URLQueryItem(name: "user_id", value: "eq.\(session.userId)"),
            URLQueryItem(name: "created_at", value: "gte.\(ISO8601DateFormatter().string(from: since))"),
            URLQueryItem(name: "order", value: "created_at.desc"),
            URLQueryItem(name: "limit", value: "100"),
        ]
        if let profile = app.profile {
            query.append(URLQueryItem(name: "or", value: "(profile_id.eq.\(profile.id),profile_id.is.null)"))
        }
        do {
            let rows: [InboxAlert] = try await Supabase.shared.select("notifications", query)
            guard key == owner else { return }
            alerts = rows
            failed = false
            loadedAt = Date()
        } catch BingeError.http(404, _) {
            // No notifications table yet (its migration hasn't run): an empty inbox.
            guard key == owner else { return }
            alerts = []
            failed = false
            loadedAt = Date()
        } catch {
            // A later failure keeps the list on screen; only a first one says so.
            guard key == owner, alerts == nil else { return }
            failed = true
        }
    }

    func markRead(_ ids: [Int]) async {
        let ids = Set(ids)
        guard !ids.isEmpty, let current = alerts else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        alerts = current.map { alert in
            guard ids.contains(alert.id), alert.unread else { return alert }
            var read = alert
            read.readAt = now
            return read
        }
        try? await Supabase.shared.update("notifications", [
            URLQueryItem(name: "id", value: "in.(\(ids.sorted().map(String.init).joined(separator: ",")))"),
            URLQueryItem(name: "read_at", value: "is.null"),
        ], ["read_at": now])
    }
}
