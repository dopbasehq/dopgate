-- OpenID Connect providers users can sign in with, such as Google or
-- Microsoft. The client secret is encrypted with the master key.
-- `verified_at` records a successful test sign-in, required before the
-- provider can be enabled; changing the issuer or client clears it.
-- `allow_signup` creates a member account for a first-time user.
-- `preset` is an ID from app/src/modules/sso/presets.toml.
CREATE TABLE sso_providers (
  id TEXT PRIMARY KEY,
  preset TEXT NOT NULL,
  display_name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_ciphertext BLOB NOT NULL,
  client_secret_nonce BLOB NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  allow_signup INTEGER NOT NULL DEFAULT 1 CHECK (allow_signup IN (0, 1)),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (issuer, client_id)
);
