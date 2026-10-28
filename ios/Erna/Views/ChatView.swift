import AVFoundation
import Observation
import PhotosUI
import Speech
import SwiftUI
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

    /// Set by the composer when the text came from the microphone, so the
    /// reply can be spoken back even with the Settings toggle off.
    var inputCameFromVoice = false
    /// The reply that just arrived and may want reading aloud; the view
    /// consumes it (see `.onChange`) and clears it.
    var replyToSpeak: (message: ChatMessage, askedByVoice: Bool)?

    /// Pending attachments for the next message.
    var attachments: [ChatAttachment] = []
    /// Attachments that travelled with the last sent message, kept for retry.
    private var inFlightAttachments: [ChatAttachment] = []

    /// How many files can ride on one message. Mirrors the server's limit.
    static let maxAttachments = 4
    /// One file's ceiling (a single PDF or photo). Base64 adds a third, and the
    /// whole request must stay under Netlify's ~6 MB body cap.
    static let maxAttachmentBytes = 3_500_000
    /// Budget for everything on one message together.
    static let maxTotalBytes = 3_800_000
    /// Photos are compressed to this so four of them still fit the total.
    static let photoBudgetBytes = 900_000

    var canAttachMore: Bool { attachments.count < Self.maxAttachments }
    var remainingAttachmentSlots: Int { max(0, Self.maxAttachments - attachments.count) }

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
        return (hasText || !attachments.isEmpty) && !isSending
    }

    /// True when the last turn failed and the user's message is still unanswered.
    var canRetry: Bool {
        !isSending && errorMessage != nil && messages.last?.role == .user
    }

    // MARK: - Sending

    func send() async {
        var trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }

        // The server requires non-empty text; attachments alone get a stub.
        if trimmed.isEmpty, let first = attachments.first {
            if attachments.count > 1 {
                trimmed = "What do you see in these?"
            } else {
                trimmed = first.isPDF ? "What is in this document?" : "What do you see in this image?"
            }
        }

        input = ""
        let askedByVoice = inputCameFromVoice
        inputCameFromVoice = false
        inFlightAttachments = attachments
        attachments = []

        let shown = inFlightAttachments.isEmpty
            ? trimmed
            : "\(trimmed)\n\n[attached: \(inFlightAttachments.map(\.name).joined(separator: ", "))]"
        messages.append(ChatMessage(role: .user, content: shown))
        await deliver(askedByVoice: askedByVoice)
    }

    // MARK: - Attachments

    /// Adds several photos at once (the picker allows up to the free slots).
    func attach(photos items: [PhotosPickerItem]) async {
        var failed = 0
        for item in items {
            guard canAttachMore else { break }
            do {
                guard let data = try await item.loadTransferable(type: Data.self),
                      let image = UIImage(data: data)
                else { failed += 1; continue }
                let name = "photo\(attachments.count + 1).jpg"
                guard let compressed = Self.compress(image, name: name, budget: Self.photoBudgetBytes) else {
                    failed += 1
                    continue
                }
                add(compressed)
            } catch {
                failed += 1
            }
        }
        if failed > 0 {
            errorMessage = failed == 1 ? "One photo couldn't be loaded." : "\(failed) photos couldn't be loaded."
        }
    }

    /// Appends if it still fits the per-message budget; explains if not.
    private func add(_ attachment: ChatAttachment) {
        let total = attachments.reduce(0) { $0 + $1.data.count } + attachment.data.count
        guard total <= Self.maxTotalBytes else {
            errorMessage = "That's too much for one message. Send these first, then add more."
            return
        }
        attachments.append(attachment)
    }

    func attach(filesAt urls: [URL]) {
        for url in urls where canAttachMore { attach(fileAt: url) }
    }

    func attach(fileAt url: URL) {
        guard canAttachMore else { return }
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
                add(ChatAttachment(name: url.lastPathComponent, mediaType: "application/pdf", data: data))
            } else if type.conforms(to: .image), let image = UIImage(data: data) {
                if let compressed = Self.compress(image, name: url.lastPathComponent, budget: Self.photoBudgetBytes) {
                    add(compressed)
                }
            } else {
                errorMessage = "Only images and PDFs are supported."
            }
        } catch {
            errorMessage = "Couldn't read that file."
        }
    }

    func removeAttachment(_ attachment: ChatAttachment) {
        attachments.removeAll { $0.id == attachment.id }
    }

    /// Downscale and re-encode as JPEG until it fits the size budget. Tries a
    /// 1536 px long side first (plenty for Erna to read), then smaller.
    private static func compress(_ image: UIImage, name: String, budget: Int) -> ChatAttachment? {
        let base = (name as NSString).deletingPathExtension
        for maxSide in [1536.0, 1024.0, 768.0] as [CGFloat] {
            var working = image
            let longest = max(image.size.width, image.size.height)
            if longest > maxSide, let scaled = image.resized(longestSide: maxSide) {
                working = scaled
            }
            for quality in stride(from: 0.8, through: 0.4, by: -0.2) {
                if let data = working.jpegData(compressionQuality: quality), data.count <= budget {
                    return ChatAttachment(name: "\(base).jpg", mediaType: "image/jpeg", data: data)
                }
            }
        }
        return nil
    }

    func retry() async {
        guard canRetry else { return }
        await deliver()
    }

    private func deliver(askedByVoice: Bool = false) async {
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
                    attachments: inFlightAttachments.isEmpty ? nil : inFlightAttachments
                )
            )
            inFlightAttachments = []
            conversationId = response.conversationId
            messages.append(response.message)
            replyToSpeak = (response.message, askedByVoice)
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

    /// Deletes one conversation (and its messages) on the server. Optimistic:
    /// the row disappears at once and comes back if the request fails.
    /// Long-term memories are untouched.
    func delete(_ conversation: Conversation) async {
        // Deleting the chat Erna is replying into would orphan her answer.
        guard !isSending else { return }
        let snapshot = conversations
        conversations.removeAll { $0.id == conversation.id }
        if conversationId == conversation.id { newChat() }

        do {
            try await api.delete("/api/conversations/\(conversation.id)")
        } catch {
            conversations = snapshot
            conversationsError = error.localizedDescription
        }
    }

    /// Clears the whole chat history on the server and starts a fresh chat.
    func clearHistory() async throws {
        guard !isSending else { return }
        try await api.delete("/api/conversations")
        conversations = []
        hasMoreConversations = false
        newChat()
    }
}

struct ChatView: View {
    @Environment(AppServices.self) private var services
    @State private var model: ChatViewModel?
    @State private var showingHistory = false
    @State private var showingPhotoPicker = false
    @State private var showingFilePicker = false
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var speech = SpeechRecognizer()
    @State private var voice = SpeechPlayer()
    /// Settings → "Spoken replies". Replies to a spoken question are always read aloud.
    @AppStorage("spokenReplies") private var spokenReplies = false

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
                            MessageBubble(
                                message: message,
                                voiceState: voice.state(for: message.id),
                                onSpeak: message.role == .assistant
                                    ? { voice.toggle(message, api: services.api) }
                                    : nil
                            )
                            .id(message.id)
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

    /// Tap once to talk, tap again to stop; the words land in the text box so
    /// the user can fix a word before sending.
    private func toggleListening(_ model: ChatViewModel) {
        if speech.isListening {
            let heard = speech.stop()
            if !heard.isEmpty {
                model.input = heard
                model.inputCameFromVoice = true
            }
        } else {
            Task { await speech.start() }
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
            if !model.attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.attachments) { attachment in
                            AttachmentChip(attachment: attachment) { model.removeAttachment(attachment) }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(alignment: .bottom, spacing: 10) {
                Menu {
                    Button {
                        showingPhotoPicker = true
                    } label: {
                        Label("Photos", systemImage: "photo.on.rectangle")
                    }
                    Button {
                        showingFilePicker = true
                    } label: {
                        Label("Files (PDF or image)", systemImage: "doc")
                    }
                } label: {
                    Image(systemName: "paperclip")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 38, height: 38)
                        .panel(strong: true)
                }
                .disabled(model.isSending || !model.canAttachMore)

                TextField(speech.isListening ? "Listening…" : "Message Erna", text: $model.input, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .foregroundStyle(Theme.foreground)
                    .panel(strong: true)
                    .disabled(speech.isListening)

                Button {
                    toggleListening(model)
                } label: {
                    Image(systemName: speech.isListening ? "stop.fill" : "mic.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(speech.isListening ? Theme.background : Theme.accent)
                        .frame(width: 38, height: 38)
                        .background(speech.isListening ? Theme.accent : Color.clear)
                        .clipShape(Circle())
                        .panel(strong: !speech.isListening)
                }
                .disabled(model.isSending)
                .accessibilityLabel(speech.isListening ? "Stop listening" : "Talk to Erna")

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
        .onChange(of: model.replyToSpeak?.message.id) { _, _ in
            guard let pending = model.replyToSpeak else { return }
            model.replyToSpeak = nil
            if spokenReplies || pending.askedByVoice {
                voice.toggle(pending.message, api: services.api)
            }
        }
        .onChange(of: speech.transcript) { _, text in
            if speech.isListening { model.input = text }
        }
        .onChange(of: speech.state) { _, state in
            if case .denied(let reason) = state {
                model.errorMessage = reason
                speech.clearError()
            }
        }
        .photosPicker(
            isPresented: $showingPhotoPicker,
            selection: $pickedPhotos,
            maxSelectionCount: model.remainingAttachmentSlots,
            matching: .images
        )
        .onChange(of: pickedPhotos) { _, items in
            guard !items.isEmpty else { return }
            Task {
                await model.attach(photos: items)
                pickedPhotos = []
            }
        }
        .fileImporter(
            isPresented: $showingFilePicker,
            allowedContentTypes: [.pdf, .image],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                model.attach(filesAt: urls)
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
    var voiceState: SpeechPlayer.State = .idle
    var onSpeak: (() -> Void)? = nil

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            VStack(alignment: .leading, spacing: 6) {
                Text(Self.render(message.content))
                    .font(.body)
                    .foregroundStyle(Theme.foreground)
                    .textSelection(.enabled)

                if let onSpeak {
                    Button(action: onSpeak) {
                        HStack(spacing: 5) {
                            if voiceState == .loading {
                                ProgressView().controlSize(.mini)
                            } else {
                                Image(systemName: voiceState == .playing ? "stop.fill" : "speaker.wave.2.fill")
                            }
                            Text(voiceState == .playing ? "Stop" : "Listen")
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.accent)
                    }
                    .buttonStyle(.plain)
                    .disabled(voiceState == .loading)
                    .accessibilityLabel(voiceState == .playing ? "Stop Erna" : "Hear Erna say this")
                }
            }
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
    @State private var showingClearAll = false
    @State private var isClearing = false

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
                    .swipeActions(edge: .trailing, allowsFullSwipe: !model.isSending) {
                        Button(role: .destructive) {
                            Task { await model.delete(conversation) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        .disabled(model.isSending)
                    }
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
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear all", role: .destructive) { showingClearAll = true }
                        .disabled(model.conversations.isEmpty || isClearing || model.isSending)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog(
                "Delete all conversations?",
                isPresented: $showingClearAll,
                titleVisibility: .visible
            ) {
                Button("Delete all history", role: .destructive) {
                    Task {
                        isClearing = true
                        defer { isClearing = false }
                        do {
                            try await model.clearHistory()
                        } catch {
                            model.conversationsError = error.localizedDescription
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes every chat and its messages. What Erna has learned about you (memories, tasks, notes) is kept.")
            }
            .overlay {
                if (model.isLoadingConversations && model.conversations.isEmpty) || isClearing {
                    ProgressView().tint(Theme.accent)
                }
            }
            .refreshable { await model.loadConversations() }
        }
    }
}

// MARK: - Speech recognition


/// Turns the microphone into text for the composer. On-device where the
/// phone supports it (iOS 17+ does for most languages), so nothing is sent
/// anywhere until the user taps send. Recognises in the phone's language.
@MainActor
@Observable
final class SpeechRecognizer {
    enum State: Equatable {
        case idle
        case listening
        case denied(String)
    }

    private(set) var state: State = .idle
    /// Live transcript while listening; the composer mirrors it.
    private(set) var transcript = ""

    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    var isListening: Bool { state == .listening }

    /// Ask for both permissions up front; returns false with a reason if either is refused.
    private func authorize() async -> Bool {
        let speech = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        guard speech == .authorized else {
            state = .denied("Allow speech recognition in Settings to talk to Erna.")
            return false
        }

        let mic = await AVAudioApplication.requestRecordPermission()
        guard mic else {
            state = .denied("Allow microphone access in Settings to talk to Erna.")
            return false
        }
        return true
    }

    func start() async {
        guard !isListening else { return }
        guard await authorize() else { return }

        let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
        guard let recognizer, recognizer.isAvailable else {
            state = .denied("Speech recognition isn't available right now.")
            return
        }
        self.recognizer = recognizer

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition {
                request.requiresOnDeviceRecognition = true
            }
            self.request = request

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()

            transcript = ""
            state = .listening

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                    }
                    if error != nil || (result?.isFinal ?? false) {
                        self.teardown()
                    }
                }
            }
        } catch {
            teardown()
            state = .denied("Couldn't start the microphone.")
        }
    }

    /// Stops listening and returns what was heard.
    @discardableResult
    func stop() -> String {
        request?.endAudio()
        teardown()
        return transcript
    }

    private func teardown() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if state == .listening { state = .idle }
    }

    func clearError() {
        if case .denied = state { state = .idle }
    }
}

// MARK: - Spoken replies

/// Plays one of Erna's replies through the server's text-to-speech route
/// (`POST /api/tts`, ElevenLabs behind it). One reply at a time; tapping the
/// same one again stops it, tapping another switches to it.
@MainActor
@Observable
final class SpeechPlayer: NSObject, AVAudioPlayerDelegate {
    enum State: Equatable { case idle, loading, playing }

    private(set) var currentId: UUID?
    private(set) var current: State = .idle
    private var player: AVAudioPlayer?
    private var task: Task<Void, Never>?

    func state(for id: UUID) -> State {
        currentId == id ? current : .idle
    }

    func toggle(_ message: ChatMessage, api: ErnaAPI) {
        if currentId == message.id, current != .idle {
            stop()
            return
        }
        stop()
        currentId = message.id
        current = .loading

        struct Body: Encodable { let text: String }
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let data = try await api.postData("/api/tts", body: Body(text: message.content))
                guard !Task.isCancelled, currentId == message.id else { return }

                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
                try session.setActive(true)

                let player = try AVAudioPlayer(data: data, fileTypeHint: AVFileType.mp3.rawValue)
                player.delegate = self
                self.player = player
                player.prepareToPlay()
                player.play()
                current = .playing
            } catch {
                print("[erna] tts failed:", error.localizedDescription)
                reset()
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        player?.stop()
        reset()
    }

    private func reset() {
        player = nil
        currentId = nil
        current = .idle
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.reset() }
    }
}
