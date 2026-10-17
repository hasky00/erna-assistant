import SwiftUI
import Observation
import PhotosUI
import UniformTypeIdentifiers

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

    /// Pending attachment for the next message (one at a time in v1).
    var attachment: ChatAttachment?
    /// Attachment that travelled with the last sent message, kept for retry.
    private var inFlightAttachment: ChatAttachment?

    /// Keep well under the server's ~4.5 MB cap once base64 adds a third.
    static let maxAttachmentBytes = 3_500_000

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
        let hasText = !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return (hasText || attachment != nil) && !isSending
    }

    /// True when the last turn failed and the user's message is still unanswered.
    var canRetry: Bool {
        !isSending && errorMessage != nil && messages.last?.role == .user
    }

    // MARK: - Sending

    func send() async {
        var trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }

        // The server requires non-empty text; an attachment alone gets a stub.
        if trimmed.isEmpty, let attachment {
            trimmed = attachment.isPDF ? "What is in this document?" : "What do you see in this image?"
        }

        input = ""
        inFlightAttachment = attachment
        attachment = nil

        let shown = inFlightAttachment.map { "\(trimmed)\n\n[attached: \($0.name)]" } ?? trimmed
        messages.append(ChatMessage(role: .user, content: shown))
        await deliver()
    }

    // MARK: - Attachments

    func attach(photo item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            guard let image = UIImage(data: data) else {
                errorMessage = "That image couldn't be read."
                return
            }
            attachment = Self.compress(image, name: "photo.jpg")
        } catch {
            errorMessage = "Couldn't load that photo."
        }
    }

    func attach(fileAt url: URL) {
        let secured = url.startAccessingSecurityScopedResource()
        defer { if secured { url.stopAccessingSecurityScopedResource() } }

        do {
            let data = try Data(contentsOf: url)
            let type = UTType(filenameExtension: url.pathExtension) ?? .data
            if type.conforms(to: .pdf) {
                guard data.count <= Self.maxAttachmentBytes else {
                    errorMessage = "That PDF is too large (max \(Self.maxAttachmentBytes / 1_000_000) MB)."
                    return
                }
                attachment = ChatAttachment(name: url.lastPathComponent, mediaType: "application/pdf", data: data)
            } else if type.conforms(to: .image), let image = UIImage(data: data) {
                attachment = Self.compress(image, name: url.lastPathComponent)
            } else {
                errorMessage = "Only images and PDFs are supported."
            }
        } catch {
            errorMessage = "Couldn't read that file."
        }
    }

    func removeAttachment() {
        attachment = nil
    }

    /// Downscale and re-encode as JPEG until it fits the size budget.
    private static func compress(_ image: UIImage, name: String) -> ChatAttachment? {
        var working = image
        let maxSide: CGFloat = 2048
        let longest = max(image.size.width, image.size.height)
        if longest > maxSide, let scaled = image.resized(longestSide: maxSide) {
            working = scaled
        }

        for quality in stride(from: 0.85, through: 0.4, by: -0.15) {
            if let data = working.jpegData(compressionQuality: quality), data.count <= maxAttachmentBytes {
                let base = (name as NSString).deletingPathExtension
                return ChatAttachment(name: "\(base).jpg", mediaType: "image/jpeg", data: data)
            }
        }
        return nil
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
                body: ChatRequest(
                    conversationId: conversationId,
                    messages: payload,
                    attachments: inFlightAttachment.map { [$0] }
                )
            )
            inFlightAttachment = nil
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
    @State private var showingPhotoPicker = false
    @State private var showingFilePicker = false
    @State private var pickedPhoto: PhotosPickerItem?

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

        return VStack(spacing: 8) {
            if let attachment = model.attachment {
                AttachmentChip(attachment: attachment) { model.removeAttachment() }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(alignment: .bottom, spacing: 10) {
                Menu {
                    Button {
                        showingPhotoPicker = true
                    } label: {
                        Label("Photo", systemImage: "photo")
                    }
                    Button {
                        showingFilePicker = true
                    } label: {
                        Label("File (PDF or image)", systemImage: "doc")
                    }
                } label: {
                    Image(systemName: "paperclip")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 38, height: 38)
                        .panel(strong: true)
                }
                .disabled(model.isSending)

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
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.background)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.border).frame(height: 1)
        }
        .photosPicker(isPresented: $showingPhotoPicker, selection: $pickedPhoto, matching: .images)
        .onChange(of: pickedPhoto) { _, item in
            Task {
                await model.attach(photo: item)
                pickedPhoto = nil
            }
        }
        .fileImporter(
            isPresented: $showingFilePicker,
            allowedContentTypes: [.pdf, .image],
            allowsMultipleSelection: false
        ) { result in
            if case .success(let urls) = result, let url = urls.first {
                model.attach(fileAt: url)
            }
        }
    }
}

private struct AttachmentChip: View {
    let attachment: ChatAttachment
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            if !attachment.isPDF, let image = UIImage(data: attachment.data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 28, height: 28)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                Image(systemName: "doc.richtext")
                    .foregroundStyle(Theme.accent)
            }

            Text(attachment.name)
                .font(.footnote)
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)

            Text(ByteCountFormatter.string(fromByteCount: Int64(attachment.data.count), countStyle: .file))
                .font(.caption2)
                .foregroundStyle(.secondary)

            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .panel(strong: true)
    }
}

private extension UIImage {
    func resized(longestSide: CGFloat) -> UIImage? {
        let scale = longestSide / max(size.width, size.height)
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}

private struct MessageBubble: View {
    let message: ChatMessage

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            Text(Self.render(message.content))
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

    /// Erna replies in light Markdown (bold, italics, links, inline code).
    /// SwiftUI's Text only parses inline Markdown, so block syntax like
    /// list markers and headings is normalised to plain text first.
    private static func render(_ raw: String) -> AttributedString {
        let cleaned = raw
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                var text = String(line)
                // "### Heading" -> "Heading"
                if let range = text.range(of: #"^\s{0,3}#{1,6}\s+"#, options: .regularExpression) {
                    text.removeSubrange(range)
                    text = "**\(text)**"
                }
                // "- item" / "* item" -> "• item"
                if let range = text.range(of: #"^\s*[-*]\s+"#, options: .regularExpression) {
                    text.replaceSubrange(range, with: "• ")
                }
                return text
            }
            .joined(separator: "\n")

        var options = AttributedString.MarkdownParsingOptions()
        options.interpretedSyntax = .inlineOnlyPreservingWhitespace
        if let parsed = try? AttributedString(markdown: cleaned, options: options) {
            return parsed
        }
        return AttributedString(raw)
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
