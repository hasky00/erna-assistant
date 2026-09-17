import SwiftUI
import Observation

@MainActor
@Observable
final class ChatViewModel {
    /// Matches the web client's opening line so both surfaces feel the same.
    static let greeting = ChatMessage(
        role: .assistant,
        content: "I'm Erna. I can remember what matters, manage tasks, use tools, and keep you sharp. What are we doing?"
    )

    var messages: [ChatMessage] = [greeting]
    var input = ""
    var isSending = false
    var errorMessage: String?

    var conversationId: String?
    var conversations: [Conversation] = []
    var hasMoreConversations = false
    var isLoadingConversations = false
    var conversationsError: String?

    private let api: ErnaAPI

    init(api: ErnaAPI) {
        self.api = api
    }

    var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    /// True when the last turn failed and the user's message is still unanswered.
    var canRetry: Bool {
        !isSending && errorMessage != nil && messages.last?.role == .user
    }

    // MARK: - Sending

    func send() async {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }

        input = ""
        messages.append(ChatMessage(role: .user, content: trimmed))
        await deliver()
    }

    func retry() async {
        guard canRetry else { return }
        await deliver()
    }

    private func deliver() async {
        isSending = true
        errorMessage = nil
        defer { isSending = false }

        // The route accepts at most 20 turns; the server rebuilds the rest of
        // the context from memories, tasks, and the system prompt anyway.
        let payload = Array(messages.suffix(20))

        do {
            let response: ChatResponse = try await api.post(
                "/api/chat",
                body: ChatRequest(conversationId: conversationId, messages: payload)
            )
            conversationId = response.conversationId
            messages.append(response.message)
            await loadConversations()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - History

    func newChat() {
        guard !isSending else { return }
        messages = [Self.greeting]
        conversationId = nil
        input = ""
        errorMessage = nil
    }

    func loadConversations(before: Date? = nil) async {
        isLoadingConversations = true
        conversationsError = nil
        defer { isLoadingConversations = false }

        var query = [URLQueryItem(name: "limit", value: "15")]
        if let before {
            query.append(URLQueryItem(name: "before", value: ISODate.string(from: before)))
        }

        do {
            let response: ConversationsResponse = try await api.get("/api/conversations", query: query)
            if before == nil {
                conversations = response.conversations
            } else {
                conversations.append(contentsOf: response.conversations)
            }
            hasMoreConversations = response.hasMore
        } catch {
            conversationsError = error.localizedDescription
        }
    }

    func loadMoreConversations() async {
        guard hasMoreConversations, let oldest = conversations.last?.updatedAt else { return }
        await loadConversations(before: oldest)
    }

    func open(_ conversation: Conversation) async {
        guard !isSending else { return }

        errorMessage = nil
        do {
            let response: ConversationMessagesResponse = try await api.get(
                "/api/conversations/\(conversation.id)/messages"
            )
            messages = response.messages.isEmpty ? [Self.greeting] : response.messages
            conversationId = response.conversationId
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct ChatView: View {
    @Environment(AppServices.self) private var services
    @State private var model: ChatViewModel?
    @State private var showingHistory = false

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
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 7) {
                        Image(.ernaLogo)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 24, height: 24)

                        Text("Erna")
                            .font(.headline)
                            .foregroundStyle(Theme.foreground)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Erna")
                }

                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showingHistory = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                    .disabled(model == nil)
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        model?.newChat()
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .disabled(model?.isSending ?? true)
                }
            }
            .sheet(isPresented: $showingHistory) {
                if let model {
                    ConversationHistoryView(model: model)
                }
            }
        }
        .task {
            // Built here rather than in an initializer so it can capture the
            // shared API client from the environment.
            if model == nil { model = ChatViewModel(api: services.api) }
            await model?.loadConversations()
        }
    }

    @ViewBuilder
    private func content(_ model: ChatViewModel) -> some View {
        @Bindable var model = model

        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(model.messages) { message in
                            MessageBubble(message: message).id(message.id)
                        }

                        if model.isSending {
                            TypingIndicator().id("typing")
                        }
                    }
                    .padding(16)
                }
                .onChange(of: model.messages.count) { scrollToEnd(proxy, model) }
                .onChange(of: model.isSending) { scrollToEnd(proxy, model) }
            }

            if let errorMessage = model.errorMessage {
                ErrorBanner(message: errorMessage) {
                    Task { await model.retry() }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }

            composer(model)
        }
    }

    private func scrollToEnd(_ proxy: ScrollViewProxy, _ model: ChatViewModel) {
        let target: (any Hashable)? = model.isSending ? "typing" : model.messages.last?.id
        guard let target else { return }

        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(AnyHashable(target), anchor: .bottom)
        }
    }

    private func composer(_ model: ChatViewModel) -> some View {
        @Bindable var model = model

        return HStack(alignment: .bottom, spacing: 10) {
            TextField("Message Erna", text: $model.input, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .foregroundStyle(Theme.foreground)
                .panel(strong: true)

            Button {
                Task { await model.send() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.background)
                    .frame(width: 38, height: 38)
                    .background(model.canSend ? Theme.accent : Theme.accentMuted)
                    .clipShape(Circle())
            }
            .disabled(!model.canSend)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.background)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.border).frame(height: 1)
        }
    }
}

private struct MessageBubble: View {
    let message: ChatMessage

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            Text(message.content)
                .font(.body)
                .foregroundStyle(Theme.foreground)
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(isUser ? Theme.accent.opacity(0.18) : Theme.panel)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(isUser ? Theme.accent.opacity(0.35) : Theme.border, lineWidth: 1)
                )

            if !isUser { Spacer(minLength: 40) }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }
}

private struct TypingIndicator: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(Theme.muted)
                    .frame(width: 7, height: 7)
                    .opacity(phase == Double(index) ? 1 : 0.35)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .panel()
        .onAppear {
            withAnimation(.easeInOut(duration: 0.45).repeatForever()) { phase = 2 }
        }
        .accessibilityLabel("Erna is thinking")
    }
}

private struct ConversationHistoryView: View {
    @Bindable var model: ChatViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let error = model.conversationsError {
                    ErrorBanner(message: error) {
                        Task { await model.loadConversations() }
                    }
                    .listRowBackground(Color.clear)
                }

                ForEach(model.conversations) { conversation in
                    Button {
                        Task {
                            await model.open(conversation)
                            dismiss()
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(conversation.title)
                                .font(.body)
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(2)

                            Text(conversation.updatedAt, format: .relative(presentation: .named))
                                .font(.caption)
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    .listRowBackground(Theme.panel)
                }

                if model.hasMoreConversations {
                    Button("Load more") {
                        Task { await model.loadMoreConversations() }
                    }
                    .foregroundStyle(Theme.accent)
                    .listRowBackground(Theme.panel)
                }

                if model.conversations.isEmpty && !model.isLoadingConversations {
                    Text("No conversations yet.")
                        .foregroundStyle(Theme.muted)
                        .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .overlay {
                if model.isLoadingConversations && model.conversations.isEmpty {
                    ProgressView().tint(Theme.accent)
                }
            }
            .refreshable { await model.loadConversations() }
        }
    }
}
