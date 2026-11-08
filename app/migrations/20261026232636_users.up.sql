-- Every account: the instance owner (root), admins, and the members who use
-- your apps. `password_hash` is an Argon2id PHC string, or NULL for accounts
-- that only sign in with single sign-on or emailed codes. Both metadata
-- columns hold JSON objects: the user can read `public_metadata`, only
-- admins see `private_metadata`. `failed_login_count` and `locked_until`
-- back the account lockout.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified_at TEXT,
  password_hash TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('root', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  public_metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(public_metadata)),
  private_metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(private_metadata)),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_sign_in_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- There is exactly one root account.
CREATE UNIQUE INDEX users_single_root_idx ON users(role) WHERE role = 'root';
CREATE INDEX users_created_idx ON users(created_at DESC, id DESC);
