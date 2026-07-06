# Memory

Long-term memory lives in the `memories`, `profiles`, `tasks`, and `knowledge_documents` Supabase tables.

The chat route retrieves relevant memories for the current user and injects them into Erna's system context. Erna can also call `save_memory` during a chat when the user shares a durable preference or important fact.
