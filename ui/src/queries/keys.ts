import type { EntryKey } from "@pinia/colada";

/**
 * First key part of reads made before anyone signs in (sign-in methods).
 * Clearing the cache on a session change keeps these.
 */
export const PUBLIC = "public";

/**
 * Every query key in the console. Keys are arrays so a change can refresh
 * a whole group by prefix: `keys.users.root` covers every user read.
 * A missing value is `null`, never `undefined`, because keys are JSON.
 */
export const keys = {
  public: {
    methods: [PUBLIC, "auth-methods"] as EntryKey,
  },
  users: {
    root: ["users"] as EntryKey,
    list: (filters: Record<string, string | null>): EntryKey => [
      "users",
      "list",
      filters,
    ],
    one: (id: string): EntryKey => ["users", "one", id],
    sessions: (id: string): EntryKey => ["users", "sessions", id],
    tokens: (id: string): EntryKey => ["users", "tokens", id],
  },
  agents: {
    root: ["agents"] as EntryKey,
    list: (filters: Record<string, string | null>): EntryKey => [
      "agents",
      "list",
      filters,
    ],
    one: (id: string): EntryKey => ["agents", "one", id],
  },
  admins: ["admins"] as EntryKey,
  templates: {
    root: ["templates"] as EntryKey,
    list: ["templates", "list"] as EntryKey,
    one: (name: string): EntryKey => ["templates", "one", name],
  },
  settings: ["settings"] as EntryKey,
  signingKeys: ["signing-keys"] as EntryKey,
  audit: {
    root: ["audit"] as EntryKey,
    events: (filters: Record<string, string>): EntryKey => [
      "audit",
      "events",
      filters,
    ],
  },
  account: {
    root: ["account"] as EntryKey,
    sessions: ["account", "sessions"] as EntryKey,
  },
};
