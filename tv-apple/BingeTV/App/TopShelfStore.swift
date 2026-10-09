import Foundation
import TVServices

// What the Top Shelf extension shows, written into the shared App Group,
// plus the binge:// links its items open.
enum TopShelfStore {
    private static var group: String {
        Bundle.main.object(forInfoDictionaryKey: "BingeAppGroup") as? String ?? "group.com.binge.tv"
    }

    private struct Item: Encodable { let id, title: String; let image: String?; let play, display: String; let progress: Double? }
    private struct Section: Encodable { let title: String; let items: [Item] }

    static func save(continueItems: [ContinueItem], picks: [Title]) {
        func link(_ action: String, _ title: Title, season: Int? = nil, episode: Int? = nil, seconds: Double? = nil) -> String {
            var c = URLComponents()
            c.scheme = "binge"
            c.host = action
            var items = [URLQueryItem(name: "kind", value: title.kind.rawValue), URLQueryItem(name: "id", value: String(title.dbId))]
            if let season, let episode {
                items += [URLQueryItem(name: "s", value: String(season)), URLQueryItem(name: "e", value: String(episode))]
            }
            if let seconds, seconds > 30 { items.append(URLQueryItem(name: "t", value: String(Int(seconds)))) }
            c.queryItems = items
            return c.url!.absoluteString
        }
        var sections: [Section] = []
        let resume = continueItems.prefix(12).map { item in
            Item(id: item.id, title: item.episodeLabel.map { "\(item.title.name) · \($0)" } ?? item.title.name,
                 image: (item.title.backdrop ?? item.title.poster)?.absoluteString,
                 play: link("play", item.title, season: item.season, episode: item.episode, seconds: item.position),
                 display: link("title", item.title), progress: item.progress)
        }
        if !resume.isEmpty { sections.append(Section(title: "Continue Watching", items: resume)) }
        let top = picks.filter { $0.backdrop != nil }.prefix(10).map { title in
            Item(id: "pick-\(title.id)", title: title.name, image: title.backdrop?.absoluteString,
                 play: link("play", title), display: link("title", title), progress: nil)
        }
        if !top.isEmpty { sections.append(Section(title: "Top Picks", items: top)) }
        guard let data = try? JSONEncoder().encode(sections) else { return }
        UserDefaults(suiteName: group)?.set(data, forKey: "topShelf")
        TVTopShelfContentProvider.topShelfContentDidChange()
    }
}

struct DeepLink: Equatable {
    let play: Bool
    let kind: MediaKind
    let id: Int
    let season: Int?
    let episode: Int?
    let seconds: Double?

    // binge://play?kind=tv_show&id=58132&s=1&e=2&t=300 or binge://title?kind=movie&id=197851
    init?(_ url: URL) {
        guard url.scheme == "binge", let host = url.host, host == "play" || host == "title",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let kind = value("kind").flatMap(MediaKind.init(rawValue:)), let id = value("id").flatMap(Int.init) else { return nil }
        self.play = host == "play"
        self.kind = kind
        self.id = id
        self.season = value("s").flatMap(Int.init)
        self.episode = value("e").flatMap(Int.init)
        self.seconds = value("t").flatMap(Double.init)
    }
}
