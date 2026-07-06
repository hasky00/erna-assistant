export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type UserProfile = {
  id: string;
  display_name: string | null;
  timezone: string | null;
  preferences: Record<string, unknown> | null;
};

export type Memory = {
  id: string;
  content: string;
  category: string;
  importance: number;
  created_at: string;
};

export type Task = {
  id: string;
  title: string;
  status: "open" | "done" | "archived";
  due_at: string | null;
};

export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};
