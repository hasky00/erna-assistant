import Foundation

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

/// Empty stand-in for endpoints whose body we ignore (`{"ok":true}`).
struct EmptyResponse: Decodable {}

/// Client for the Next.js API routes.
///
/// Every request carries `Authorization: Bearer <supabase jwt>`, which
/// `lib/supabase/api.ts` turns back into an RLS-scoped Supabase client. On a
/// 401 we refresh once and retry, so an expired token is invisible to the UI.
@MainActor
final class ErnaAPI {
    private let auth: AuthStore
    private let baseURL = Config.apiBaseURL
    private let session: URLSession

    init(auth: AuthStore) {
        self.auth = auth

        let configuration = URLSessionConfiguration.default
        // A chat turn can run several tool round trips server-side.
        configuration.timeoutIntervalForRequest = 120
        configuration.waitsForConnectivity = true
        self.session = URLSession(configuration: configuration)
    }

    // MARK: - Verbs

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await perform("GET", path, query: query)
    }

    func post<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        try await perform("POST", path, body: try encode(body))
    }

    func put<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        try await perform("PUT", path, body: try encode(body))
    }

    func patch<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        try await perform("PATCH", path, body: try encode(body))
    }

    @discardableResult
    func delete(_ path: String) async throws -> EmptyResponse {
        try await perform("DELETE", path)
    }

    // MARK: - Plumbing

    private func encode(_ value: some Encodable) throws -> Data {
        try JSONEncoder().encode(value)
    }

    private func perform<T: Decodable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Data? = nil
    ) async throws -> T {
        let token = try await auth.accessToken()
        let (data, status) = try await send(method, path, query: query, body: body, token: token)

        if status == 401 {
            // Token may have been revoked ahead of its expiry; refresh and retry once.
            let fresh = try await auth.refreshedAccessToken()
            let (retryData, retryStatus) = try await send(
                method, path, query: query, body: body, token: fresh
            )
            return try decode(retryData, status: retryStatus)
        }

        return try decode(data, status: status)
    }

    private func send(
        _ method: String,
        _ path: String,
        query: [URLQueryItem],
        body: Data?,
        token: String
    ) async throws -> (Data, Int) {
        var components = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty { components.queryItems = query }

        guard let url = components.url else {
            throw APIError(status: 0, message: "Could not build a URL for \(path).")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch let error as URLError {
            throw APIError(status: 0, message: Self.describe(error))
        }
    }

    private func decode<T: Decodable>(_ data: Data, status: Int) throws -> T {
        guard (200..<300).contains(status) else {
            throw APIError(status: status, message: Self.errorMessage(from: data, status: status))
        }

        if T.self == EmptyResponse.self { return EmptyResponse() as! T }

        do {
            return try JSONDecoder.erna.decode(T.self, from: data)
        } catch {
            throw APIError(status: status, message: "Unexpected response from the server.")
        }
    }

    /// Routes return `{error: string}`, but Zod validation failures return
    /// `{error: <flattened object>}`, so a plain string decode is not enough.
    private static func errorMessage(from data: Data, status: Int) -> String {
        struct StringError: Decodable { let error: String }

        if let payload = try? JSONDecoder().decode(StringError.self, from: data),
           !payload.error.isEmpty {
            return payload.error
        }

        switch status {
        case 401: return "Your session expired. Sign in again."
        case 404: return "Not found."
        case 429: return "Rate limited or out of OpenAI quota. Try again shortly."
        default: return "Request failed (\(status))."
        }
    }

    private static func describe(_ error: URLError) -> String {
        switch error.code {
        case .notConnectedToInternet: return "You're offline."
        case .timedOut: return "The server took too long to respond."
        case .cannotConnectToHost, .cannotFindHost:
            return "Can't reach \(Config.apiBaseURL.host() ?? "the server"). Check ERNA_API_BASE_URL in Secrets.xcconfig."
        default: return error.localizedDescription
        }
    }
}
