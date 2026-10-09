import Foundation

struct AuthSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userId: String
    var email: String?
}

enum BingeError: LocalizedError {
    case notConfigured
    case signedOut
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "This build is missing its settings. Run tv-apple/scripts/make-secrets.sh, then build again."
        case .signedOut:
            return "You've been signed out. Sign in again to continue."
        case .http(_, let message):
            return message
        }
    }
}

// Same Supabase project the website uses: GoTrue for sign-in, PostgREST for
// data, protected by the same RLS policies. No SDK, just URLSession.
actor Supabase {
    static let shared = Supabase()

    enum Auth { case required, optional }

    private(set) var session: AuthSession?
    private var refreshTask: Task<AuthSession, Error>?

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    init() {
        if let data = Keychain.load(), let saved = try? JSONDecoder().decode(AuthSession.self, from: data) {
            session = saved
        }
    }

    // MARK: Auth

    func signIn(email: String, password: String) async throws -> AuthSession {
        try await tokenRequest(grant: "password", body: ["email": email, "password": password])
    }

    func signOut() async {
        if let token = session?.accessToken, let base = Config.supabaseURL {
            var request = URLRequest(url: base.appending(path: "auth/v1/logout"))
            request.httpMethod = "POST"
            request.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try? await URLSession.shared.data(for: request)
        }
        clearSession()
    }

    private func clearSession() {
        session = nil
        Keychain.delete()
    }

    private func tokenRequest(grant: String, body: [String: String]) async throws -> AuthSession {
        guard Config.isConfigured, let base = Config.supabaseURL else { throw BingeError.notConfigured }
        var components = URLComponents(url: base.appending(path: "auth/v1/token"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: grant)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw BingeError.http(status, Self.message(from: data, status: status))
        }

        struct TokenResponse: Decodable {
            struct User: Decodable { let id: String; let email: String? }
            let accessToken: String
            let refreshToken: String
            let expiresIn: Double
            let user: User
        }
        let token = try decoder.decode(TokenResponse.self, from: data)
        let fresh = AuthSession(
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: Date().addingTimeInterval(token.expiresIn),
            userId: token.user.id,
            email: token.user.email
        )
        session = fresh
        if let encoded = try? JSONEncoder().encode(fresh) { Keychain.save(encoded) }
        return fresh
    }

    // A session whose access token is good for at least another minute.
    // Concurrent callers share one refresh.
    func validSession() async throws -> AuthSession {
        guard let current = session else { throw BingeError.signedOut }
        if current.expiresAt.timeIntervalSinceNow > 60 { return current }
        if let refreshTask { return try await refreshTask.value }

        let task = Task { try await self.tokenRequest(grant: "refresh_token", body: ["refresh_token": current.refreshToken]) }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            return try await task.value
        } catch BingeError.http(let status, _) where (400..<500).contains(status) {
            // The refresh token itself was rejected (revoked or expired).
            clearSession()
            throw BingeError.signedOut
        }
    }

    // MARK: PostgREST

    func select<T: Decodable>(_ table: String, _ query: [URLQueryItem], auth: Auth = .required) async throws -> T {
        let data = try await send("GET", table: table, query: query, body: nil, auth: auth)
        return try decoder.decode(T.self, from: data)
    }

    func insert(_ table: String, _ row: [String: Any]) async throws {
        _ = try await send("POST", table: table, query: [], body: row, auth: .required, prefer: "return=minimal")
    }

    // Insert or replace on the given unique columns.
    func upsert(_ table: String, onConflict: String, _ row: [String: Any]) async throws {
        _ = try await send("POST", table: table, query: [URLQueryItem(name: "on_conflict", value: onConflict)], body: row,
                           auth: .required, prefer: "resolution=merge-duplicates,return=minimal")
    }

    func rpc<T: Decodable>(_ name: String, _ params: [String: Any], auth: Auth = .optional) async throws -> T {
        let data = try await send("POST", table: "rpc/\(name)", query: [], body: params, auth: auth)
        return try decoder.decode(T.self, from: data)
    }

    func update(_ table: String, _ query: [URLQueryItem], _ row: [String: Any]) async throws {
        _ = try await send("PATCH", table: table, query: query, body: row, auth: .required, prefer: "return=minimal")
    }

    func delete(_ table: String, _ query: [URLQueryItem]) async throws {
        _ = try await send("DELETE", table: table, query: query, body: nil, auth: .required)
    }

    private func send(_ method: String, table: String, query: [URLQueryItem], body: Any?, auth: Auth, prefer: String? = nil) async throws -> Data {
        guard Config.isConfigured, let base = Config.supabaseURL else { throw BingeError.notConfigured }
        var components = URLComponents(url: base.appending(path: "rest/v1/\(table)"), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        // URLComponents leaves "+" alone, which PostgREST would read as a space.
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")

        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        switch auth {
        case .required:
            request.setValue("Bearer \(try await validSession().accessToken)", forHTTPHeaderField: "Authorization")
        case .optional:
            // Catalog tables are public; use the session when there is one.
            if let token = try? await validSession().accessToken {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let prefer { request.setValue(prefer, forHTTPHeaderField: "Prefer") }

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401, auth == .required {
            clearSession()
            throw BingeError.signedOut
        }
        guard (200..<300).contains(status) else {
            throw BingeError.http(status, Self.message(from: data, status: status))
        }
        return data
    }

    private static func message(from data: Data, status: Int) -> String {
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let code = json?["error_code"] as? String ?? json?["error"] as? String
        if code == "invalid_credentials" || code == "invalid_grant" {
            return "That email and password don't match a binge. account."
        }
        if code == "email_not_confirmed" {
            return "Confirm your email first. Check your inbox for the link from binge."
        }
        let text = json?["msg"] as? String
            ?? json?["message"] as? String
            ?? json?["error_description"] as? String
        if let text, !text.isEmpty { return text }
        return status >= 500 ? "binge. is having trouble right now. Try again in a moment." : "Something went wrong (\(status))."
    }
}
