import SwiftUI

/// Account and app information. Erna's personality and operating rules are
/// internal — the owner edits them on the web `/admin` page, not in the app.
struct SettingsView: View {
    @Environment(AppServices.self) private var services
    @State private var showingSignOut = false
    @AppStorage("spokenReplies") private var spokenReplies = false

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
                    NavigationLink {
                        MemoriesView()
                    } label: {
                        Label("What Erna knows about you", systemImage: "brain")
                    }
                } header: {
                    Text("Your data")
                } footer: {
                    Text("Every fact Erna remembers, where it came from, and a way to forget it.")
                }
                .listRowBackground(Theme.panel)

                Section {
                    Toggle("Spoken replies", isOn: $spokenReplies)
                        .tint(Theme.accent)
                } header: {
                    Text("Voice")
                } footer: {
                    Text("Erna reads every reply aloud. When this is off she still answers out loud if you asked with the microphone, and the Listen button always works.")
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


// MARK: - Memory page

@MainActor
@Observable
final class MemoriesViewModel {
    var memories: [Memory] = []
    var isLoading = false
    var errorMessage: String?

    private let api: ErnaAPI

    init(api: ErnaAPI) {
        self.api = api
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response: MemoriesResponse = try await api.get("/api/memories")
            memories = response.memories
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Optimistic: the row goes at once and comes back if the server says no.
    func forget(_ memory: Memory) async {
        let snapshot = memories
        memories.removeAll { $0.id == memory.id }
        do {
            try await api.delete("/api/memories/\(memory.id)")
        } catch {
            memories = snapshot
            errorMessage = error.localizedDescription
        }
    }

    func update(_ memory: Memory, content: String) async {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != memory.content else { return }
        do {
            let response: MemoryResponse = try await api.patch(
                "/api/memories/\(memory.id)",
                body: UpdateMemoryBody(content: trimmed)
            )
            if let index = memories.firstIndex(where: { $0.id == memory.id }) {
                var updated = memories[index]
                updated.content = response.memory.content
                memories[index] = updated
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func forgetEverything() async throws {
        try await api.delete("/api/memories")
        memories = []
    }
}

/// Everything Erna remembers about the user: read it, fix it, forget it.
struct MemoriesView: View {
    @Environment(AppServices.self) private var services
    @State private var model: MemoriesViewModel?
    @State private var editing: Memory?
    @State private var showingForgetAll = false

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                ProgressView().tint(Theme.accent)
            }
        }
        .background(Theme.background)
        .navigationTitle("What Erna knows")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Forget all", role: .destructive) { showingForgetAll = true }
                    .disabled(model?.memories.isEmpty ?? true)
            }
        }
        .confirmationDialog(
            "Forget everything Erna knows about you?",
            isPresented: $showingForgetAll,
            titleVisibility: .visible
        ) {
            Button("Forget everything", role: .destructive) {
                Task {
                    do { try await model?.forgetEverything() } catch { model?.errorMessage = error.localizedDescription }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your chats, tasks and notes stay. Erna will simply start from a blank slate about you.")
        }
        .sheet(item: $editing) { memory in
            MemoryEditor(memory: memory) { newContent in
                await model?.update(memory, content: newContent)
            }
        }
        .task {
            if model == nil { model = MemoriesViewModel(api: services.api) }
            await model?.load()
        }
    }

    @ViewBuilder
    private func content(_ model: MemoriesViewModel) -> some View {
        @Bindable var model = model

        List {
            if let errorMessage = model.errorMessage {
                ErrorBanner(message: errorMessage) {
                    Task { await model.load() }
                }
                .listRowBackground(Color.clear)
            }

            Section {
                ForEach(model.memories) { memory in
                    Button {
                        editing = memory
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(memory.content)
                                .foregroundStyle(Theme.foreground)
                                .multilineTextAlignment(.leading)

                            HStack(spacing: 8) {
                                Text(memory.category.capitalized)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Theme.accent)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 2)
                                    .background(Theme.accent.opacity(0.12), in: Capsule())

                                Text(memory.originLine)
                                    .font(.caption)
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .listRowBackground(Theme.panel)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            Task { await model.forget(memory) }
                        } label: {
                            Label("Forget", systemImage: "trash")
                        }
                    }
                }
            } header: {
                if !model.memories.isEmpty {
                    Text("\(model.memories.count) \(model.memories.count == 1 ? "memory" : "memories") · tap to edit, swipe to forget")
                }
            }

            if model.memories.isEmpty && !model.isLoading {
                Text("Erna hasn't remembered anything about you yet. Tell her something worth keeping.")
                    .foregroundStyle(Theme.muted)
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .overlay {
            if model.isLoading && model.memories.isEmpty {
                ProgressView().tint(Theme.accent)
            }
        }
        .refreshable { await model.load() }
    }
}

/// Fix a fact Erna got slightly wrong.
private struct MemoryEditor: View {
    let memory: Memory
    let onSave: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var isSaving = false

    init(memory: Memory, onSave: @escaping (String) async -> Void) {
        self.memory = memory
        self.onSave = onSave
        _text = State(initialValue: memory.content)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Memory", text: $text, axis: .vertical)
                        .lineLimit(3...10)
                } footer: {
                    Text(memory.originLine)
                }
                .listRowBackground(Theme.panel)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Edit memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            isSaving = true
                            await onSave(text)
                            isSaving = false
                            dismiss()
                        }
                    }
                    .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
