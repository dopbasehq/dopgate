-- Refresh tokens, stored as SHA-256 hashes. Each refresh marks the presented
-- token used and issues a new row for the same session. A token presented
-- after it was used means someone copied it, so the whole session is
-- revoked.
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX refresh_tokens_session_idx ON refresh_tokens(session_id);
