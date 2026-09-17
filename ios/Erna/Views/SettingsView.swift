import SwiftUI
import Observation

@MainActor
@Observable
final class SettingsViewModel {
    /// Mirrors the Zod bounds on `PUT /api/admin/prompt`.
    static let minimumPromptLength = 100
    static let maximumPromptLength = 12000

    var prompt = ""
    var defaultPrompt = ""
    var isLoading = false
    var isSaving = false
    var errorMessage: String?
    var didSave = false

    private var loadedPrompt = ""
    private let api: ErnaAPI

    init(api: ErnaAPI) {
        self.api = api
    }

    var isDirty: Bool { prompt != loadedPrompt }

    var canSave: Bool {
        isDirty
            && !isSaving
            && (Self.minimumPromptLength...Self.maximumPromptLength).contains(prompt.count)
    }

    var lengthHint: String? {
        if prompt.count < Self.minimumPromptLength {
            return "\(Self.minimumPromptLength - prompt.count) more characters needed."
        }
        if prompt.count > Self.maximumPromptLength {
            return "\(prompt.count - Self.maximumPromptLength) characters over the limit."
        }
        return nil
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response: PromptResponse = try await api.get("/api/admin/prompt")
            prompt = response.personalityPrompt
            loadedPrompt = response.personalityPrompt
            defaultPrompt = response.defaultPrompt
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func save() async {
        guard canSave else { return }

        isSaving = true
        errorMessage = nil
        didSave = false
        defer { isSaving = false }

        do {
            let _: EmptyResponse = try await api.put(
                "/api/admin/prompt",
                body: UpdatePromptBody(personalityPrompt: prompt)
            )
            loadedPrompt = prompt
            didSave = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restoreDefault() {
        prompt = defaultPrompt
        didSave = false
    }

    func discardChanges() {
        prompt = loadedPrompt
        didSave = false
    }
}

struct SettingsView: View {
    @Environment(AppServices.self) private var services
    @State private var model: SettingsViewModel?
    @State private var showingSignOut = false

    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    content(model)
                } else {
                    Color.clear
                }
            }
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
        .task {
            if model == nil { model = SettingsViewModel(api: services.api) }
            await model?.load()
        }
    }

    @ViewBuilder
    private func content(_ model: SettingsViewModel) -> some View {
        @Bindable var model = model

        Form {
            Section("Account") {
                LabeledContent("Signed in as") {
                    Text(services.auth.currentUser?.email ?? "—")
                        .foregroundStyle(Theme.muted)
                }
                LabeledContent("Server") {
                    Text(Config.apiBaseURL.host() ?? "—")
                        .foregroundStyle(Theme.muted)
                }
            }
            .listRowBackground(Theme.panel)

            Section {
                if let errorMessage = model.errorMessage {
                    ErrorBanner(message: errorMessage) {
                        Task { await model.load() }
                    }
                }

                TextEditor(text: $model.prompt)
                    .frame(minHeight: 260)
                    .font(.callout.monospaced())
                    .foregroundStyle(Theme.foreground)
                    .scrollContentBackground(.hidden)

                HStack {
                    Text("\(model.prompt.count) characters")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)

                    Spacer()

                    if let hint = model.lengthHint {
                        Text(hint)
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                    } else if model.didSave && !model.isDirty {
                        Label("Saved", systemImage: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(Theme.accent)
                    }
                }
            } header: {
                Text("Personality")
            } footer: {
                Text("This is Erna's system prompt. It applies to your account only, and takes effect on your next message.")
            }
            .listRowBackground(Theme.panel)

            Section {
                Button {
                    Task { await model.save() }
                } label: {
                    HStack {
                        if model.isSaving { ProgressView().tint(Theme.accent) }
                        Text("Save prompt")
                    }
                }
                .disabled(!model.canSave)

                Button("Discard changes") { model.discardChanges() }
                    .disabled(!model.isDirty)

                Button("Restore default personality") { model.restoreDefault() }
                    .disabled(model.defaultPrompt.isEmpty || model.prompt == model.defaultPrompt)
            }
            .listRowBackground(Theme.panel)

            Section {
                Button("Sign out", role: .destructive) { showingSignOut = true }
            }
            .listRowBackground(Theme.panel)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .overlay {
            if model.isLoading && model.prompt.isEmpty {
                ProgressView().tint(Theme.accent)
            }
        }
    }
}
