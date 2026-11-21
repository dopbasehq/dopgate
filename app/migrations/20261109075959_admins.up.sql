-- The people who run Dopgate: root and admins. They sign in to the console
-- only, and have their own sessions, refresh tokens, and emailed codes, so
-- no query can mix them with your app's users. The same email may belong to
-- an admin and to a user. Settings and email templates record which admin
-- saved them, so this pair runs before theirs.

CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  password_hash TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('root', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (email = lower(email))
);

CREATE UNIQUE INDEX admins_email_idx ON admins(email);
-- There is exactly one root account.
CREATE UNIQUE INDEX admins_single_root_idx ON admins(role) WHERE role = 'root';
CREATE INDEX admins_created_idx ON admins(created_at DESC, id DESC);

-- Console sessions, the same shape as `sessions`.
CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('password', 'otp', 'sso')),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE INDEX admin_sessions_admin_idx ON admin_sessions(admin_id);
CREATE INDEX admin_sessions_expiry_idx ON admin_sessions(absolute_expires_at);

-- Refresh tokens of console sessions, with the same reuse rule and the
-- same sealed next token as `refresh_tokens`.
CREATE TABLE admin_refresh_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES admin_sessions(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  next_sealed TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX admin_refresh_tokens_session_idx ON admin_refresh_tokens(session_id);

-- Emailed codes for admins: console sign-in, password reset, and email
-- change. Root creates admins, so there is no sign-up or verify purpose.
CREATE TABLE admin_codes (
  id TEXT PRIMARY KEY,
  admin_id TEXT REFERENCES admins(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'email_change', 'password_reset')),
  secret_hash BYTEA NOT NULL,
  new_email TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX admin_codes_lookup_idx ON admin_codes(email, purpose);
CREATE INDEX admin_codes_expiry_idx ON admin_codes(expires_at);
