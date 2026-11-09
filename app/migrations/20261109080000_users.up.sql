-- Every account: the instance owner (root), admins, and the members who use
-- your app. `email` is stored lowercased by the application, so a plain
-- unique index is enough and no extension is needed. `password_hash` is an
-- Argon2id PHC string, or NULL for accounts that sign in with emailed codes
-- only. The user writes `user_metadata`; `public_metadata` (readable by the
-- user) and `private_metadata` (admins only) are set by admins and backends.
-- `failed_login_count` and `locked_until` back the account lockout.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  password_hash TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('root', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  user_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(user_metadata) = 'object'),
  public_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(public_metadata) = 'object'),
  private_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(private_metadata) = 'object'),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (email = lower(email))
);

CREATE UNIQUE INDEX users_email_idx ON users(email);
-- There is exactly one root account.
CREATE UNIQUE INDEX users_single_root_idx ON users(role) WHERE role = 'root';
CREATE INDEX users_created_idx ON users(created_at DESC, id DESC);
