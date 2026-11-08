-- Emailed proofs: a numeric code (`otp`) or a link token (`link`). Only the
-- SHA-256 hash of the secret is stored. A row is single-use: confirming it
-- sets `consumed_at`, and a code is burned after too many wrong `attempts`.
-- `user_id` is NULL when the email has no account yet, as in passwordless
-- sign-up.
CREATE TABLE verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('email_verify', 'login', 'email_change', 'password_reset')),
  method TEXT NOT NULL CHECK (method IN ('otp', 'link')),
  secret_hash BLOB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  redirect_url TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX verification_tokens_lookup_idx ON verification_tokens(email, purpose);
CREATE INDEX verification_tokens_expiry_idx ON verification_tokens(expires_at);
-- A link is looked up by its secret alone, so link secrets must be unique.
CREATE UNIQUE INDEX verification_tokens_link_idx ON verification_tokens(secret_hash)
  WHERE method = 'link';
