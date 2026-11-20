import SwiftUI

// The Collections tab: every ready-made set as a row per group (Malayalam,
// Franchises, Holidays…). Selecting one opens it as a grid that keeps
// loading as you scroll (Data/Collections.swift; the website's /collections).
struct CollectionsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var file: CollectionsFile?
    @State private var failed = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                Text("Collections").font(.system(size: 56, weight: .heavy))
                Text("Ready-made sets to scroll through. New releases join them on their own.")
                    .font(.callout).foregroundStyle(Theme.muted)
                #if DEBUG
                // -BingeCollection <id>: open one set at launch (testing without a remote).
                if let id = UserDefaults.standard.string(forKey: "BingeCollection"), let set = file?.collections.first(where: { $0.id == id }) {
                    CollectionDetailView(set: set)
                }
                #endif
                if let file {
                    ForEach(file.visible(restricted: app.maturity != .all), id: \.group.id) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            SectionTitle(text: entry.group.title)
                            ScrollView(.horizontal) {
                                LazyHStack(spacing: 40) {
                                    ForEach(entry.sets) { set in CollectionCard(set: set) }
                                }
                                .padding(.vertical, 34)
                            }
                            .scrollIndicators(.hidden)
                            .scrollClipDisabled()
                        }
                        .focusSection()
                    }
                } else if failed {
                    ProblemView(message: "Couldn't load the collections right now.") { Task { await load() } }
                } else {
                    ForEach(0..<3, id: \.self) { _ in RowSkeleton() }
                }
            }
            .padding(.vertical, 40)
        }
        .scrollClipDisabled()
        .task { await load() }
        .navigationDestination(for: CollectionsFile.Set.self) { CollectionDetailView(set: $0) }
    }

    private func load() async {
        failed = false
        do { file = try await Collections.load() } catch { failed = true }
    }
}

// A set's card: its first three posters fanned out, its name and line.
private struct CollectionCard: View {
    @EnvironmentObject private var app: AppModel
    let set: CollectionsFile.Set
    @State private var posters: [URL?] = []

    var body: some View {
        NavigationLink(value: set) {
            VStack(alignment: .leading, spacing: 14) {
                ZStack(alignment: .leading) {
                    ForEach(Array(posters.prefix(3).enumerated().reversed()), id: \.offset) { index, url in
                        PosterImage(url: url, name: set.title)
                            .frame(width: 130, height: 195)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .scaleEffect(1 - CGFloat(index) * 0.08, anchor: .leading)
                            .offset(x: CGFloat(index) * 92)
                            .shadow(color: .black.opacity(0.5), radius: 10, y: 6)
                    }
                    if posters.isEmpty {
                        RoundedRectangle(cornerRadius: 10).fill(Theme.raised).frame(width: 130, height: 195)
                    }
                }
                .frame(width: 330, height: 195, alignment: .leading)
                VStack(alignment: .leading, spacing: 4) {
                    Text(set.title).font(.headline).lineLimit(2, reservesSpace: true)
                    Text(set.subtitle).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                }
                .frame(width: 330, alignment: .leading)
            }
            .padding(20)
        }
        .buttonStyle(FocusCardStyle(cornerRadius: 18))
        .accessibilityLabel("\(set.title). \(set.subtitle)")
        .task {
            let feed = CollectionFeed.shared(set, maturity: app.maturity)
            if feed.items.isEmpty { await feed.loadMore() }
            posters = feed.items.prefix(3).map(\.poster)
        }
    }
}

struct CollectionDetailView: View {
    @EnvironmentObject private var app: AppModel
    let set: CollectionsFile.Set
    @StateObject private var holder = Holder()

    // The feed is shared (kept per set), created once the profile is known.
    @MainActor final class Holder: ObservableObject { @Published var feed: CollectionFeed? }

    private let columns = Array(repeating: GridItem(.fixed(220), spacing: 40), count: 7)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(set.title).font(.system(size: 56, weight: .heavy)).lineLimit(2).minimumScaleFactor(0.6)
                    Text(subtitle).font(.callout).foregroundStyle(Theme.muted)
                }
                if let feed = holder.feed { FeedGrid(feed: feed, columns: columns) } else { RowSkeleton() }
            }
            .padding(.vertical, 40)
        }
        .scrollClipDisabled()
        .task {
            let feed = CollectionFeed.shared(set, maturity: app.maturity)
            holder.feed = feed
            if feed.items.isEmpty { await feed.loadMore() }
        }
    }

    private var subtitle: String {
        guard let feed = holder.feed, !feed.items.isEmpty else { return set.subtitle }
        return "\(set.subtitle)  ·  \(feed.items.count)\(feed.done ? "" : "+") on binge."
    }
}

private struct FeedGrid: View {
    @ObservedObject var feed: CollectionFeed
    let columns: [GridItem]

    var body: some View {
        if feed.items.isEmpty && feed.done {
            Text("Nothing in this collection is on binge. for this profile yet. New titles join it as they come out.")
                .font(.headline).foregroundStyle(Theme.muted)
        } else if feed.items.isEmpty && feed.failed {
            ProblemView(message: "Couldn't load this collection right now.") { Task { await feed.loadMore() } }
        } else if feed.items.isEmpty {
            RowSkeleton()
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 50) {
                ForEach(Array(feed.items.enumerated()), id: \.element.id) { index, title in
                    PosterCard(title: title)
                        // The last row coming into view loads the next batch.
                        .onAppear { if index >= feed.items.count - 7 { Task { await feed.loadMore() } } }
                }
            }
            .focusSection()
            if feed.failed {
                ProblemView(message: "Couldn't load more of this collection.") { Task { await feed.loadMore() } }
            }
        }
    }
}
