import Foundation

enum AuthError: LocalizedError {
    case message(String)
    case needsEmailConfirmation
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        case .needsEmailConfirmation:
            return "Account created. Check your email for the confirmation link, then sign in."
        case .notSignedIn: return "You are signed out."
        }
    }
}

/// Thin GoTrue REST client.
///
/// Deliberately dependency-free: the three endpoints the app needs are a few
/// lines of URLSession each, which avoids pulling supabase-swift (and its
/// transitive packages) into the build.
struct SupabaseAuth {
    let baseURL: URL
    let anonKey: String

    private struct TokenResponse: Decodable {
        let access_token: String?
        let refresh_token: String?
        let expires_in: Double?
        let user: SupabaseUser?
    }

    func signIn(email: String, password: String) async throws -> StoredSession {
        let body = ["email": email, "password": password]
        let response: TokenResponse = try await post(
            path: "/auth/v1/token",
            query: [URLQueryItem(name: "grant_type", value: "password")],
            body: body
        )
        return try session(from: response)
    }

    /// Returns a session when the project has email confirmation switched off,
    /// and throws `.needsEmailConfirmation` when it is on.
    func signUp(email: String, password: String) async throws -> StoredSession {
        let body = ["email": email, "password": password]
        let response: TokenResponse = try await post(path: "/auth/v1/signup", body: body)

        guard response.access_token != nil else { throw AuthError.needsEmailConfirmation }
        return try session(from: response)
    }

    func refresh(refreshToken: String) async throws -> StoredSession {
        let body = ["refresh_token": refreshToken]
        let response: TokenResponse = try await post(
            path: "/auth/v1/token",
            query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
            body: body
        )
        return try session(from: response)
    }

    func signOut(accessToken: String) async {
        var request = URLRequest(url: baseURL.appending(path: "/auth/v1/logout"))
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        // Best effort: a failure here still leaves the local session cleared.
        _ = try? await URLSession.shared.data(for: request)
    }

    // MARK: - Plumbing

    private func session(from response: TokenResponse) throws -> StoredSession {
        guard let accessToken = response.access_token,
              let refreshToken = response.refresh_token,
              let user = response.user
        else {
            throw AuthError.message("Supabase returned an incomplete session.")
        }

        return StoredSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: Date().addingTimeInterval(response.expires_in ?? 3600),
            user: user
        )
    }

    private func post<T: Decodable>(
        path: String,
        query: [URLQueryItem] = [],
        body: [String: String]
    ) async throws -> T {
        var components = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty { components.queryItems = query }

        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard (200..<300).contains(status) else {
            throw AuthError.message(Self.errorMessage(from: data, status: status))
        }

        return try JSONDecoder().decode(T.self, from: data)
    }

    /// GoTrue uses several error shapes depending on the endpoint and version.
    private static func errorMessage(from data: Data, status: Int) -> String {
        struct Payload: Decodable {
            let error_description: String?
            let error: String?
            let msg: String?
            let message: String?
        }

        if let payload = try? JSONDecoder().decode(Payload.self, from: data) {
            if let text = payload.error_description ?? payload.msg
                ?? payload.message ?? payload.error, !text.isEmpty {
                return text
            }
        }

        return status == 400
            ? "Invalid email or password."
            : "Sign in failed (\(status))."
    }
}
