# Tool Modules

Erna's MVP tool system is implemented in `lib/erna/tools.ts`.

Included server-side tools:
- `save_memory`: stores durable user memories in Supabase.
- `create_task`: creates private user tasks.
- `list_tasks`: lists tasks by status (`open`/`done`/`archived`/`all`) with ids.
- `complete_task`: marks a task done by id.
- `reschedule_task`: changes or clears a task's due date by id.
- `save_note`: saves a note/document to the private knowledge base (`knowledge_documents`).
- `search_knowledge`: keyword-searches saved notes/documents.
- `delete_note`: deletes a note by id (find it with `search_knowledge` first).
- `search_memory`: keyword-searches long-term memories, returning ids.
- `delete_memory`: deletes a memory by id (find it with `search_memory` first).
- `convert_currency`: converts between fiat currencies via the free Frankfurter API (ECB rates, no key).
- `update_preferences`: updates the user's saved preferences object.
- `web_search`: optional Tavily-backed search when `TAVILY_API_KEY` is configured.
- `integration_status`: reports optional calendar, email, and task provider connections.

Task management, knowledge-base, and currency tools require no extra configuration.
The system prompt now also injects the current date/time in the user's timezone so
relative dates ("tomorrow", "next Friday") resolve correctly.

Calendar, email, and external task providers should be added as OAuth modules that write connection state to `tool_connections`. Keep provider tokens encrypted before storing them.
