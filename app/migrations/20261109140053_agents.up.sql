-- Agents: accounts for bots and AI agents. Every agent belongs to exactly
-- one owner, an admin or a user, and goes when its owner goes. An agent
-- signs in only with its one token, stored as a SHA-256 hash with its last
-- four characters. `capabilities` is a flat key-value object the owner
-- sets; Dopgate puts it in the agent's access token and never enforces it.
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT REFERENCES admins(id) ON DELETE CASCADE,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capabilities) = 'object'),
  token_hash BYTEA NOT NULL UNIQUE,
  last_four TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (num_nonnulls(owner_admin_id, owner_user_id) = 1),
  UNIQUE (owner_admin_id, name),
  UNIQUE (owner_user_id, name)
);

CREATE INDEX agents_created_idx ON agents(created_at DESC, id DESC);
CREATE INDEX agents_owner_user_idx ON agents(owner_user_id);
