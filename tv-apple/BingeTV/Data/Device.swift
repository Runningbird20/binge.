import Foundation

// What this Apple TV can afford. The Apple TV HD (AppleTV5,3: A8, 2 GB,
// 1080p only) runs out of memory long before the 4K models (3–4 GB), so it
// gets smaller pictures, fewer video pages at once and lighter preloads.
enum Device {
    nonisolated static let machine: String = {
        var info = utsname()
        uname(&info)
        return withUnsafePointer(to: &info.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
    }()

    // `-BingeLowMemory YES` forces it on (simulator testing).
    nonisolated static let isLowMemory: Bool = UserDefaults.standard.bool(forKey: "BingeLowMemory")
        || machine.hasPrefix("AppleTV5,")
        || ProcessInfo.processInfo.physicalMemory < 2_500 * 1_024 * 1_024
}
