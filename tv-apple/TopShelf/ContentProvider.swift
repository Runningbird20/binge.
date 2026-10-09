import TVServices

// Fills the Apple TV home screen's Top Shelf (when binge. is in the top
// row). With an App Group (paid developer account) the app shares your
// Continue Watching here; without one, the shelf fetches "Trending on
// binge." itself, from the same TMDB lists + catalog the app uses.
final class ContentProvider: TVTopShelfContentProvider {
    private struct Item: Decodable {
        let id: String
        let title: String
        let image: String?
        let play: String
        let display: String
        let progress: Double?
    }
    private struct Section: Decodable {
        let title: String
        let items: [Item]
    }

    private func info(_ key: String) -> String {
        let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "").trimmingCharacters(in: .whitespaces)
        return value.hasPrefix("$(") ? "" : value
    }

    override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
        let group = info("BingeAppGroup")
        if !group.isEmpty, let data = UserDefaults(suiteName: group)?.data(forKey: "topShelf"),
           let sections = try? JSONDecoder().decode([Section].self, from: data), !sections.isEmpty {
            completionHandler(content(sections))
            return
        }
        Task {
            let trending = await fetchTrending()
            completionHandler(trending.isEmpty ? nil : content([Section(title: "Trending on binge.", items: trending)]))
        }
    }

    private func content(_ sections: [Section]) -> TVTopShelfContent {
        let collections = sections.map { section -> TVTopShelfItemCollection<TVTopShelfSectionedItem> in
            let items = section.items.compactMap { entry -> TVTopShelfSectionedItem? in
                guard let play = URL(string: entry.play), let display = URL(string: entry.display) else { return nil }
                let item = TVTopShelfSectionedItem(identifier: entry.id)
                item.title = entry.title
                item.imageShape = .hdtv
                if let image = entry.image.flatMap(URL.init(string:)) {
                    item.setImageURL(image, for: [.screenScale1x, .screenScale2x])
                }
                item.playAction = TVTopShelfAction(url: play)
                item.displayAction = TVTopShelfAction(url: display)
                if let progress = entry.progress { item.playbackProgress = progress }
                return item
            }
            let collection = TVTopShelfItemCollection(items: items)
            collection.title = section.title
            return collection
        }
        return TVTopShelfSectionedContent(sections: collections)
    }

    // TMDB's trending list, kept to titles in binge.'s catalog.
    private func fetchTrending() async -> [Item] {
        let tmdb = info("BingeTMDBKey"), base = info("BingeSupabaseURL"), key = info("BingeSupabaseKey")
        guard !tmdb.isEmpty, !base.isEmpty, !key.isEmpty,
              let url = URL(string: "https://api.themoviedb.org/3/trending/all/day?api_key=\(tmdb)"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = json["results"] as? [[String: Any]] else { return [] }
        var picks: [(kind: String, tmdb: Int, name: String, backdrop: String)] = []
        for r in results {
            guard let id = r["id"] as? Int, let backdrop = r["backdrop_path"] as? String,
                  let type = r["media_type"] as? String, type == "movie" || type == "tv" else { continue }
            picks.append((type, id, (r["title"] ?? r["name"]) as? String ?? "", backdrop))
        }
        var items: [Item] = []
        for (kind, table, appKind) in [("movie", "movies", "movie"), ("tv", "tv_shows", "tv_show")] {
            let wanted = picks.filter { $0.kind == kind }
            guard !wanted.isEmpty else { continue }
            let keys = wanted.map { "\"tmdb:\(kind):\($0.tmdb)\"" }.joined(separator: ",")
            var c = URLComponents(string: "\(base)/rest/v1/\(table)")!
            c.queryItems = [URLQueryItem(name: "select", value: "id,source_key"), URLQueryItem(name: "source_key", value: "in.(\(keys))")]
            var request = URLRequest(url: c.url!)
            request.setValue(key, forHTTPHeaderField: "apikey")
            guard let (rows, _) = try? await URLSession.shared.data(for: request),
                  let list = try? JSONSerialization.jsonObject(with: rows) as? [[String: Any]] else { continue }
            let ids = Dictionary(list.compactMap { row -> (String, Int)? in
                guard let source = row["source_key"] as? String, let id = (row["id"] as? NSNumber)?.intValue else { return nil }
                return (source, id)
            }, uniquingKeysWith: { a, _ in a })
            for pick in wanted {
                guard let id = ids["tmdb:\(kind):\(pick.tmdb)"] else { continue }
                items.append(Item(id: "\(appKind):\(id)", title: pick.name,
                                  image: "https://image.tmdb.org/t/p/w780\(pick.backdrop)",
                                  play: "binge://play?kind=\(appKind)&id=\(id)",
                                  display: "binge://title?kind=\(appKind)&id=\(id)", progress: nil))
            }
        }
        return Array(items.prefix(12))
    }
}
