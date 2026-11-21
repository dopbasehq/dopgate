-- Emailed 6-digit codes. Only the SHA-256 hash of the code is stored. A row
-- is single-use: confirming it sets `consumed_at`, asking again replaces it,
-- and it is burned after too many wrong `attempts`. `user_id` is NULL when
-- the email has no account yet, as in passwordless sign-up. `new_email`
-- holds the address an email change moves the account to.
CREATE TABLE verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('email_verify', 'login', 'email_change', 'password_reset')),
  secret_hash BYTEA NOT NULL,
  new_email TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX verification_tokens_lookup_idx ON verification_tokens(email, purpose);
CREATE INDEX verification_tokens_expiry_idx ON verification_tokens(expires_at);
