import Foundation

// Build-time settings, injected into Info.plist from Config/*.xcconfig.
enum Config {
    private static func value(_ key: String) -> String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.hasPrefix("$(") ? "" : trimmed
    }

    static let supabaseURL = URL(string: value("BingeSupabaseURL"))
    static let supabaseKey = value("BingeSupabaseKey")
    static let tmdbKey = value("BingeTMDBKey")
    static let siteURL = URL(string: value("BingeSiteURL")) ?? URL(string: "https://binge-26.vercel.app")!

    static var isConfigured: Bool {
        supabaseURL?.host != nil && !supabaseKey.isEmpty && !tmdbKey.isEmpty
    }

    static var siteHost: String { siteURL.host ?? siteURL.absoluteString }
}
