import ImageIO
import SwiftUI
import UIKit

// Pictures decoded at the size they're drawn, not the size they were
// downloaded. AsyncImage decodes the whole file (a w780 poster is ~3.6 MB of
// memory, an original backdrop ~33 MB) even for a 220-point card, and keeps
// nothing between screens. This decodes a thumbnail just big enough for the
// view (ImageIO), keeps a capped memory cache that empties on a memory
// warning, and leaves the downloads to URLCache (disk).
@MainActor
final class ImageStore {
    static let shared = ImageStore()

    private final class Entry {
        let image: UIImage
        let pixels: Int // longest side, in pixels
        init(image: UIImage, pixels: Int) { self.image = image; self.pixels = pixels }
    }

    private let cache = NSCache<NSURL, Entry>()
    private var inflight: [String: Task<UIImage?, Never>] = [:]

    private init() {
        // Decoded bytes; the Apple TV HD shares 2 GB with WebKit's video pages.
        cache.totalCostLimit = (Device.isLowMemory ? 48 : 128) * 1_024 * 1_024
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { ImageStore.shared.cache.removeAllObjects() }
        }
    }

    // A cached picture at least `pixels` on its longest side (or any size
    // when `pixels` is 0, i.e. the view hasn't been measured yet).
    func cached(_ url: URL, pixels: Int = 0) -> UIImage? {
        guard let entry = cache.object(forKey: url as NSURL), entry.pixels >= pixels * 9 / 10 else { return nil }
        return entry.image
    }

    func load(_ url: URL, pixels: Int) async -> UIImage? {
        if let hit = cached(url, pixels: pixels) { return hit }
        let key = "\(url.absoluteString)@\(pixels)"
        if let running = inflight[key] { return await running.value }
        let task = Task<UIImage?, Never> {
            guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
            let scale = UIScreen.main.scale
            return await Task.detached(priority: .utility) { Self.decode(data, pixels: pixels, scale: scale) }.value
        }
        inflight[key] = task
        let image = await task.value
        inflight[key] = nil
        if let image, let cg = image.cgImage {
            let longest = max(cg.width, cg.height)
            if (cache.object(forKey: url as NSURL)?.pixels ?? 0) < longest {
                cache.setObject(Entry(image: image, pixels: longest), forKey: url as NSURL, cost: cg.bytesPerRow * cg.height)
            }
        }
        return image
    }

    nonisolated private static func decode(_ data: Data, pixels: Int, scale: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        var options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true, // decode here, off the main thread
        ]
        if pixels > 0 { options[kCGImageSourceThumbnailMaxPixelSize] = pixels }
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg, scale: scale, orientation: .up)
    }
}

// AsyncImage's shape (content for the loaded image, a placeholder until
// then), sized from the view's own frame.
struct RemoteImage<Content: View, Placeholder: View>: View {
    let url: URL?
    // How much bigger than the frame's longest side the picture may need to
    // be (fill-cropping a picture of another shape).
    var fill: CGFloat = 1.25
    @ViewBuilder let content: (Image) -> Content
    @ViewBuilder let placeholder: () -> Placeholder

    @State private var image: UIImage?
    @State private var shownURL: URL?
    @State private var size: CGSize = .zero

    init(url: URL?, fill: CGFloat = 1.25, @ViewBuilder content: @escaping (Image) -> Content,
         @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.fill = fill
        self.content = content
        self.placeholder = placeholder
    }

    private var pixels: Int {
        guard size.width > 0, size.height > 0 else { return 0 }
        // Rounded up to 64 px so small layout changes don't reload.
        let raw = max(size.width, size.height) * UIScreen.main.scale * fill
        return (Int(raw) + 63) / 64 * 64
    }

    var body: some View {
        let current = shownURL == url ? image : url.flatMap { ImageStore.shared.cached($0) }
        Group {
            if let current { content(Image(uiImage: current)) } else { placeholder() }
        }
        .background(GeometryReader { geo in
            Color.clear
                .onAppear { size = geo.size }
                .onChange(of: geo.size) { _, new in size = new }
        })
        .task(id: "\(url?.absoluteString ?? "")@\(pixels)") {
            guard let url, pixels > 0 else { return }
            if let hit = ImageStore.shared.cached(url, pixels: pixels) {
                image = hit; shownURL = url
                return
            }
            guard let loaded = await ImageStore.shared.load(url, pixels: pixels), !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { image = loaded; shownURL = url }
        }
    }
}

extension RemoteImage where Placeholder == Color {
    init(url: URL?, fill: CGFloat = 1.25, @ViewBuilder content: @escaping (Image) -> Content) {
        self.init(url: url, fill: fill, content: content, placeholder: { Color.clear })
    }
}
