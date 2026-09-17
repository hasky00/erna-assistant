import SwiftUI
import Observation

@MainActor
@Observable
final class TasksViewModel {
    enum Filter: String, CaseIterable, Identifiable {
        case open, done, all
        var id: String { rawValue }
        var label: String { rawValue.capitalized }
    }

    var tasks: [ErnaTask] = []
    var filter: Filter = .open { didSet { Task { await load() } } }
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
            let response: TasksResponse = try await api.get(
                "/api/tasks",
                query: [URLQueryItem(name: "status", value: filter.rawValue)]
            )
            tasks = response.tasks
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func create(title: String, notes: String?, dueAt: Date?) async {
        errorMessage = nil
        do {
            let body = CreateTaskBody(
                title: title,
                notes: notes?.isEmpty == true ? nil : notes,
                due_at: dueAt.map(ISODate.string(from:))
            )
            let response: TaskResponse = try await api.post("/api/tasks", body: body)

            // A new task is open, so only surface it when the filter shows those.
            if filter != .done {
                tasks.insert(response.task, at: 0)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggle(_ task: ErnaTask) async {
        let next: ErnaTask.Status = task.status == .done ? .open : .done
        await patch(task, body: UpdateTaskBody(status: next, due_at: nil))
    }

    func reschedule(_ task: ErnaTask, to date: Date?) async {
        // `.some(nil)` sends an explicit null, which clears the due date.
        await patch(task, body: UpdateTaskBody(status: nil, due_at: .some(date.map(ISODate.string(from:)))))
    }

    private func patch(_ task: ErnaTask, body: UpdateTaskBody) async {
        errorMessage = nil
        do {
            let response: TaskResponse = try await api.patch("/api/tasks/\(task.id)", body: body)

            if let index = tasks.firstIndex(where: { $0.id == task.id }) {
                // Drop it from the list when it no longer matches the filter.
                if filter == .all || response.task.status.rawValue == filter.rawValue {
                    tasks[index] = response.task
                } else {
                    tasks.remove(at: index)
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func delete(_ task: ErnaTask) async {
        let snapshot = tasks
        tasks.removeAll { $0.id == task.id }

        do {
            try await api.delete("/api/tasks/\(task.id)")
        } catch {
            // Put it back so the list keeps matching the server.
            tasks = snapshot
            errorMessage = error.localizedDescription
        }
    }
}

struct TasksView: View {
    @Environment(AppServices.self) private var services
    @State private var model: TasksViewModel?
    @State private var showingComposer = false
    @State private var rescheduling: ErnaTask?

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
            .navigationTitle("Tasks")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingComposer = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(model == nil)
                }
            }
            .sheet(isPresented: $showingComposer) {
                TaskComposer { title, notes, dueAt in
                    await model?.create(title: title, notes: notes, dueAt: dueAt)
                }
            }
            .sheet(item: $rescheduling) { task in
                RescheduleSheet(task: task) { date in
                    await model?.reschedule(task, to: date)
                }
            }
        }
        .task {
            if model == nil { model = TasksViewModel(api: services.api) }
            await model?.load()
        }
    }

    @ViewBuilder
    private func content(_ model: TasksViewModel) -> some View {
        @Bindable var model = model

        VStack(spacing: 0) {
            Picker("Filter", selection: $model.filter) {
                ForEach(TasksViewModel.Filter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if let errorMessage = model.errorMessage {
                ErrorBanner(message: errorMessage) {
                    Task { await model.load() }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }

            List {
                ForEach(model.tasks) { task in
                    TaskRow(task: task) {
                        Task { await model.toggle(task) }
                    }
                    .listRowBackground(Theme.panel)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            Task { await model.delete(task) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }

                        Button {
                            rescheduling = task
                        } label: {
                            Label("Due", systemImage: "calendar")
                        }
                        .tint(Theme.accent)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
            .overlay {
                if model.tasks.isEmpty && !model.isLoading {
                    ContentUnavailableView(
                        "No \(model.filter == .all ? "" : model.filter.rawValue) tasks",
                        systemImage: "checklist",
                        description: Text("Add one here, or just ask Erna in chat.")
                    )
                } else if model.isLoading && model.tasks.isEmpty {
                    ProgressView().tint(Theme.accent)
                }
            }
        }
    }
}

private struct TaskRow: View {
    let task: ErnaTask
    let toggle: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: toggle) {
                Image(systemName: task.status == .done ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(task.status == .done ? Theme.accent : Theme.muted)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .foregroundStyle(Theme.foreground)
                    .strikethrough(task.status == .done, color: Theme.muted)

                if let notes = task.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(3)
                }

                if let dueAt = task.dueAt {
                    Label {
                        Text(dueAt, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
                    } icon: {
                        Image(systemName: "calendar")
                    }
                    .font(.caption)
                    .foregroundStyle(isOverdue ? Theme.danger : Theme.muted)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var isOverdue: Bool {
        guard let dueAt = task.dueAt, task.status == .open else { return false }
        return dueAt < Date()
    }
}

private struct TaskComposer: View {
    let onCreate: (String, String?, Date?) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var notes = ""
    @State private var hasDueDate = false
    @State private var dueDate = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    TextField("Title", text: $title)
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }

                Section {
                    Toggle("Set a due date", isOn: $hasDueDate.animation())
                    if hasDueDate {
                        DatePicker("Due", selection: $dueDate)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        isSaving = true
                        Task {
                            await onCreate(
                                title.trimmingCharacters(in: .whitespacesAndNewlines),
                                notes.trimmingCharacters(in: .whitespacesAndNewlines),
                                hasDueDate ? dueDate : nil
                            )
                            dismiss()
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                }
            }
        }
    }
}

private struct RescheduleSheet: View {
    let task: ErnaTask
    let onSave: (Date?) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var date: Date

    init(task: ErnaTask, onSave: @escaping (Date?) async -> Void) {
        self.task = task
        self.onSave = onSave
        _date = State(initialValue: task.dueAt ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(task.title) {
                    DatePicker("Due", selection: $date)
                }

                if task.dueAt != nil {
                    Button("Clear due date", role: .destructive) {
                        Task {
                            await onSave(nil)
                            dismiss()
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Reschedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave(date)
                            dismiss()
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
