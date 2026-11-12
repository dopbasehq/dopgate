-- Personal tokens: a user's own tokens that sign in as that user, for
-- scripts and other systems. Only the SHA-256 hash is stored, with the last
-- four characters to tell tokens apart. `expires_at` is NULL for a token
-- that never expires. Deleting a token revokes it; deleting the user
-- deletes their tokens.
CREATE TABLE personal_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE,
  last_four TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, name)
);

CREATE INDEX personal_tokens_user_idx ON personal_tokens(user_id, created_at DESC);
