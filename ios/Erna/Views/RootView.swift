import SwiftUI

struct RootView: View {
    @Environment(AppServices.self) private var services

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            switch services.auth.phase {
            case .restoring:
                ProgressView()
                    .controlSize(.large)
                    .tint(Theme.accent)
            case .signedOut:
                LoginView()
            case .signedIn:
                MainTabView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: services.auth.phase)
        .task {
            await services.auth.restore()
        }
    }
}
