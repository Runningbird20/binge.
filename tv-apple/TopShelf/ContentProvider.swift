import TVServices

// Fills the Apple TV home screen's Top Shelf (when binge. is in the top
// row) with Continue Watching, written by the app into the shared App Group.
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

    override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
        let group = Bundle.main.object(forInfoDictionaryKey: "BingeAppGroup") as? String ?? "group.com.binge.tv"
        guard let data = UserDefaults(suiteName: group)?.data(forKey: "topShelf"),
              let sections = try? JSONDecoder().decode([Section].self, from: data), !sections.isEmpty else {
            completionHandler(nil)
            return
        }
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
        completionHandler(TVTopShelfSectionedContent(sections: collections))
    }
}
