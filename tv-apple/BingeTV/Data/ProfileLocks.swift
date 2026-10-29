import Foundation

// Profile PINs (Supabase profile_locks + RPCs, same as the website's
// utils/profileLocks.js). The PIN is checked on the server; the app only
// learns which profiles are locked and whether a PIN was right.
enum ProfileLocks {
    private struct Row: Decodable { let profileId: String }

    /// IDs of this account's locked profiles. PINs not installed on the
    /// server (no function and no table) means no locks; any other failure
    /// throws, so a locked profile is never opened by mistake.
    static func lockedIds() async throws -> Set<String> {
        do {
            let rows: [Row] = try await Supabase.shared.rpc("list_profile_locks", [:], auth: .required)
            return Set(rows.map(\.profileId))
        } catch BingeError.http(404, let message) {
            do {
                let _: [Row] = try await Supabase.shared.select("profile_locks", [
                    URLQueryItem(name: "select", value: "profile_id"),
                    URLQueryItem(name: "limit", value: "0"),
                ])
            } catch BingeError.http(404, _) {
                return []
            }
            throw BingeError.http(404, message)
        }
    }

    /// True when the PIN is right. Five wrong tries lock the profile for
    /// five minutes (the server then answers false).
    static func verify(profileId: String, pin: String) async throws -> Bool {
        try await Supabase.shared.rpc("verify_profile_pin", ["target_profile": profileId, "entered_pin": pin], auth: .required)
    }
}

/// The digits typed so far on the PIN screen.
struct PinEntry: Equatable {
    static let length = 4
    private(set) var digits = ""

    var isComplete: Bool { digits.count == Self.length }

    mutating func type(_ digit: Int) {
        guard (0...9).contains(digit), !isComplete else { return }
        digits.append(String(digit))
    }

    mutating func deleteLast() {
        if !digits.isEmpty { digits.removeLast() }
    }

    mutating func clear() { digits = "" }
}
