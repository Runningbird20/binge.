import Foundation
import Network

// Whether this Apple TV has a network path at all, so a failed load only
// blames the internet when it's really down. (Builds from before the catalog
// moved to Neon said "check your internet" while it was fine.)
final class Connectivity: @unchecked Sendable {
    static let shared = Connectivity()
    private let monitor = NWPathMonitor()
    private(set) var isOnline = true

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in self?.isOnline = path.status == .satisfied }
        monitor.start(queue: DispatchQueue(label: "binge.connectivity"))
    }

    static func problemMessage(_ what: String) -> String {
        shared.isOnline
            ? "Couldn't load \(what) right now. Try again in a moment."
            : "This Apple TV isn't connected to the internet."
    }
}
