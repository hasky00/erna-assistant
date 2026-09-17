import Foundation

// MARK: - Auth

struct SupabaseUser: Codable, Identifiable, Equatable {
    let id: String
    let email: String?
}

/// A GoTrue session, persisted in the keychain between launches.
struct StoredSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var user: SupabaseUser

    /// Refresh slightly early so a request never races the expiry.
    var needsRefresh: Bool { expiresAt.timeIntervalSinceNow < 60 }
}

// MARK: - Chat

struct ChatMessage: Codable, Identifiable, Equatable {
    enum Role: String, Codable { case user, assistant }

    /// Local identity only — the API exchanges plain `{role, content}` pairs.
    var id = UUID()
    var role: Role
    var content: String

    enum CodingKeys: String, CodingKey { case role, content }
}

struct Conversation: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, title
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct ToolResult: Decodable {
    let name: String
}

struct ChatRequest: Encodable {
    let conversationId: String?
    let messages: [ChatMessage]
}

struct ChatResponse: Decodable {
    let conversationId: String
    let message: ChatMessage
    let toolResults: [ToolResult]?
}

struct ConversationsResponse: Decodable {
    let conversations: [Conversation]
    let hasMore: Bool
}

struct ConversationMessagesResponse: Decodable {
    let conversationId: String
    let title: String?
    let messages: [ChatMessage]
}

// MARK: - Tasks

struct ErnaTask: Codable, Identifiable, Equatable {
    enum Status: String, Codable { case open, done, archived }

    let id: String
    var title: String
    var notes: String?
    var status: Status
    var dueAt: Date?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, title, notes, status
        case dueAt = "due_at"
        case createdAt = "created_at"
    }
}

struct TasksResponse: Decodable { let tasks: [ErnaTask] }
struct TaskResponse: Decodable { let task: ErnaTask }

struct CreateTaskBody: Encodable {
    let title: String
    let notes: String?
    let due_at: String?
}

struct UpdateTaskBody: Encodable {
    var status: ErnaTask.Status?
    /// `.some(nil)` clears the due date; `nil` leaves it untouched, matching the
    /// route's `due_at !== undefined` check.
    var due_at: String??

    enum CodingKeys: String, CodingKey { case status, due_at }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(status, forKey: .status)
        if let due = due_at {
            try container.encode(due, forKey: .due_at)
        }
    }
}

// MARK: - Notes

struct Note: Codable, Identifiable, Equatable {
    let id: String
    var title: String
    /// `POST /api/notes` echoes the note back without its body, so this is
    /// optional even though the list endpoint always includes it.
    var body: String?
    var sourceURL: String?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, title, body
        case sourceURL = "source_url"
        case createdAt = "created_at"
    }
}

struct NotesResponse: Decodable { let notes: [Note] }
struct NoteResponse: Decodable { let note: Note }

struct CreateNoteBody: Encodable {
    let title: String
    let body: String
    let source_url: String?
}

// MARK: - Personality prompt

struct PromptResponse: Decodable {
    let personalityPrompt: String
    let defaultPrompt: String
}

struct UpdatePromptBody: Encodable { let personalityPrompt: String }
