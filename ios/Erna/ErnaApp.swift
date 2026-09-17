import SwiftUI
import Observation

/// Single owner of the long-lived objects, so the auth store and the API client
/// that depends on it are created once and shared through the environment.
@MainActor
@Observable
final class AppServices {
    let auth: AuthStore
    let api: ErnaAPI

    init() {
        let auth = AuthStore()
        self.auth = auth
        self.api = ErnaAPI(auth: auth)
    }
}

@main
struct ErnaApp: App {
    @State private var services = AppServices()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(services)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}
