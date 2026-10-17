import SwiftUI

/// Account and app information. Erna's personality and operating rules are
/// internal — the owner edits them on the web `/admin` page, not in the app.
struct SettingsView: View {
    @Environment(AppServices.self) private var services
    @State private var showingSignOut = false

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }

    /// Nostr sign-ins get a placeholder `<pubkey>@nostr.erna` email; show
    /// "Nostr key" for those rather than the synthetic address.
    private var accountLine: String {
        guard let email = services.auth.currentUser?.email else { return "—" }
        return email.hasSuffix("@nostr.erna") ? "Nostr key" : email
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    LabeledContent("Signed in as") {
                        Text(accountLine)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .listRowBackground(Theme.panel)

                Section {
                    Link(destination: URL(string: "https://haskylabs.com")!) {
                        LabeledContent("Made by", value: "Hasky Labs, Copenhagen")
                    }
                    LabeledContent("Version", value: appVersion)
                } header: {
                    Text("About")
                } footer: {
                    Text("Erna remembers what you tell her, keeps your tasks and notes, and can read links, photos and PDFs you share.")
                }
                .listRowBackground(Theme.panel)

                Section {
                    Button("Sign out", role: .destructive) { showingSignOut = true }
                }
                .listRowBackground(Theme.panel)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Settings")
            .confirmationDialog(
                "Sign out of Erna?",
                isPresented: $showingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    Task { await services.auth.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}
