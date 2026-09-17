import Foundation
import Observation

/// Owns the signed-in session: restores it on launch, refreshes it when it is
/// close to expiring, and hands out access tokens to `ErnaAPI`.
@MainActor
@Observable
final class AuthStore {
    enum Phase: Equatable {
        case restoring
        case signedOut
        case signedIn(SupabaseUser)
    }

    private(set) var phase: Phase = .restoring

    private let auth = SupabaseAuth(baseURL: Config.supabaseURL, anonKey: Config.supabaseAnonKey)
    private let account = "primary"

    private var session: StoredSession? {
        didSet { persist() }
    }

    /// Shared by concurrent callers so a burst of requests triggers one refresh.
    private var refreshTask: Task<StoredSession, Error>?

    var currentUser: SupabaseUser? { session?.user }

    // MARK: - Lifecycle

    func restore() async {
        guard let data = Keychain.read(account: account),
              let stored = try? JSONDecoder().decode(StoredSession.self, from: data)
        else {
            phase = .signedOut
            return
        }

        session = stored
        phase = .signedIn(stored.user)

        // Validate the restored session up front so we don't show the app and
        // then bounce the user out on their first request.
        if stored.needsRefresh {
            _ = try? await refreshedSession()
        }
    }

    func signIn(email: String, password: String) async throws {
        let new = try await auth.signIn(email: email, password: password)
        session = new
        phase = .signedIn(new.user)
    }

    func signUp(email: String, password: String) async throws {
        let new = try await auth.signUp(email: email, password: password)
        session = new
        phase = .signedIn(new.user)
    }

    func signOut() async {
        if let token = session?.accessToken {
            await auth.signOut(accessToken: token)
        }
        clear()
    }

    // MARK: - Tokens

    func accessToken() async throws -> String {
        guard let current = session else { throw AuthError.notSignedIn }
        guard current.needsRefresh else { return current.accessToken }
        return try await refreshedSession().accessToken
    }

    /// Called by `ErnaAPI` after a 401, in case the token was revoked server
    /// side before our own expiry clock said so.
    func refreshedAccessToken() async throws -> String {
        try await refreshedSession().accessToken
    }

    private func refreshedSession() async throws -> StoredSession {
        if let inFlight = refreshTask {
            return try await inFlight.value
        }

        guard let current = session else { throw AuthError.notSignedIn }

        let task = Task { try await auth.refresh(refreshToken: current.refreshToken) }
        refreshTask = task
        defer { refreshTask = nil }

        do {
            let new = try await task.value
            session = new
            phase = .signedIn(new.user)
            return new
        } catch {
            // The refresh token is spent or revoked — nothing to do but sign out.
            clear()
            throw AuthError.notSignedIn
        }
    }

    // MARK: - Storage

    private func clear() {
        session = nil
        phase = .signedOut
    }

    private func persist() {
        guard let session else {
            Keychain.delete(account: account)
            return
        }
        guard let data = try? JSONEncoder().encode(session) else { return }
        Keychain.save(data, account: account)
    }
}
