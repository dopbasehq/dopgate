-- One row per sign-in on a device. Access tokens carry the session ID, and
-- a revoked or expired session stops refreshing. `method` records how the
-- user signed in.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK (method IN ('password', 'otp', 'link', 'sso')),
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT
);

CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(absolute_expires_at);
