-- Split the people who run Dopgate from your app's users. Root and admins
-- move into `admins` and sign in to the console only; `users` keeps the
-- people who sign in to your app and loses its `role` column. Each side has
-- its own sessions, refresh tokens, and emailed codes, so no query can mix
-- the two. The same email may belong to an admin and to a user.

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

-- Refresh tokens of console sessions, with the same reuse rule.
CREATE TABLE admin_refresh_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES admin_sessions(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
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

-- Move root and admins across, keeping their passwords. Their app sessions
-- and codes go with the old rows; they sign in to the console again.
INSERT INTO admins(id,email,email_verified_at,password_hash,display_name,avatar_url,role,status,failed_login_count,locked_until,last_sign_in_at,created_at,updated_at)
SELECT 'adm_' || substr(id, 5), email, email_verified_at, password_hash, display_name, avatar_url, role, status,
       failed_login_count, locked_until, last_sign_in_at, created_at, updated_at
FROM users WHERE role IN ('root', 'admin');

-- Settings and templates are saved by admins now. Whoever last saved one
-- keeps the credit under their new admin ID. Only admins could save them,
-- so a member's ID there can only be stale, and it is cleared.
ALTER TABLE settings DROP CONSTRAINT settings_updated_by_fkey;
ALTER TABLE email_templates DROP CONSTRAINT email_templates_updated_by_fkey;
UPDATE settings SET updated_by = CASE
  WHEN updated_by IN (SELECT id FROM users WHERE role IN ('root', 'admin'))
  THEN 'adm_' || substr(updated_by, 5) END
WHERE updated_by IS NOT NULL;
UPDATE email_templates SET updated_by = CASE
  WHEN updated_by IN (SELECT id FROM users WHERE role IN ('root', 'admin'))
  THEN 'adm_' || substr(updated_by, 5) END
WHERE updated_by IS NOT NULL;
DELETE FROM users WHERE role IN ('root', 'admin');
ALTER TABLE settings ADD CONSTRAINT settings_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL;

DROP INDEX users_single_root_idx;
ALTER TABLE users DROP COLUMN role;
