import SwiftUI
import Observation

@MainActor
@Observable
final class NotesViewModel {
    var notes: [Note] = []
    var query = ""
    var isLoading = false
    var errorMessage: String?

    private let api: ErnaAPI
    private var searchTask: Task<Void, Never>?

    init(api: ErnaAPI) {
        self.api = api
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let params = trimmed.isEmpty ? [] : [URLQueryItem(name: "q", value: trimmed)]

        do {
            let response: NotesResponse = try await api.get("/api/notes", query: params)
            notes = response.notes
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Debounced so typing in the search field doesn't fire a request per keystroke.
    func queryChanged() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    func create(title: String, body: String, sourceURL: String?) async {
        errorMessage = nil
        do {
            let payload = CreateNoteBody(
                title: title,
                body: body,
                source_url: sourceURL?.isEmpty == true ? nil : sourceURL
            )
            let response: NoteResponse = try await api.post("/api/notes", body: payload)

            // The create response omits the body, so keep the text we just sent.
            var note = response.note
            note.body = body
            notes.insert(note, at: 0)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func delete(_ note: Note) async {
        let snapshot = notes
        notes.removeAll { $0.id == note.id }

        do {
            try await api.delete("/api/notes/\(note.id)")
        } catch {
            notes = snapshot
            errorMessage = error.localizedDescription
        }
    }
}

struct NotesView: View {
    @Environment(AppServices.self) private var services
    @State private var model: NotesViewModel?
    @State private var showingComposer = false

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
            .navigationTitle("Notes")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingComposer = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .disabled(model == nil)
                }
            }
            .sheet(isPresented: $showingComposer) {
                NoteComposer { title, body, source in
                    await model?.create(title: title, body: body, sourceURL: source)
                }
            }
        }
        .task {
            if model == nil { model = NotesViewModel(api: services.api) }
            await model?.load()
        }
    }

    @ViewBuilder
    private func content(_ model: NotesViewModel) -> some View {
        @Bindable var model = model

        VStack(spacing: 0) {
            if let errorMessage = model.errorMessage {
                ErrorBanner(message: errorMessage) {
                    Task { await model.load() }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }

            List {
                ForEach(model.notes) { note in
                    NavigationLink {
                        NoteDetailView(note: note)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(note.title)
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(2)

                            if let body = note.body, !body.isEmpty {
                                Text(body)
                                    .font(.footnote)
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(2)
                            }

                            if let createdAt = note.createdAt {
                                Text(createdAt, format: .dateTime.day().month(.abbreviated).year())
                                    .font(.caption2)
                                    .foregroundStyle(Theme.muted)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .listRowBackground(Theme.panel)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            Task { await model.delete(note) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .listStyle(.insetGrouped)
            .searchable(text: $model.query, prompt: "Search notes")
            .onChange(of: model.query) { model.queryChanged() }
            .refreshable { await model.load() }
            .overlay {
                if model.notes.isEmpty && !model.isLoading {
                    ContentUnavailableView(
                        model.query.isEmpty ? "No notes yet" : "No matches",
                        systemImage: "note.text",
                        description: Text(
                            model.query.isEmpty
                                ? "Save reference material here, or ask Erna to keep a note for you."
                                : "Search looks at titles and bodies, word by word."
                        )
                    )
                } else if model.isLoading && model.notes.isEmpty {
                    ProgressView().tint(Theme.accent)
                }
            }
        }
    }
}

private struct NoteDetailView: View {
    let note: Note

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(note.title)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.foreground)

                if let source = note.sourceURL, let url = URL(string: source) {
                    Link(destination: url) {
                        Label(source, systemImage: "link")
                            .font(.footnote)
                            .lineLimit(1)
                    }
                    .foregroundStyle(Theme.accent)
                }

                Text(note.body ?? "")
                    .font(.body)
                    .foregroundStyle(Theme.foreground)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(20)
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct NoteComposer: View {
    let onCreate: (String, String, String?) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var noteBody = ""
    @State private var source = ""
    @State private var isSaving = false

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
            && !noteBody.trimmingCharacters(in: .whitespaces).isEmpty
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Note") {
                    TextField("Title", text: $title)
                    TextField("Body", text: $noteBody, axis: .vertical)
                        .lineLimit(5...14)
                }

                Section("Source") {
                    TextField("https://… (optional)", text: $source)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("New note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        isSaving = true
                        Task {
                            await onCreate(
                                title.trimmingCharacters(in: .whitespacesAndNewlines),
                                noteBody.trimmingCharacters(in: .whitespacesAndNewlines),
                                source.trimmingCharacters(in: .whitespacesAndNewlines)
                            )
                            dismiss()
                        }
                    }
                    .disabled(!canSave)
                }
            }
        }
    }
}
