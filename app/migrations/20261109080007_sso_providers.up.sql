-- OpenID Connect providers users can sign in with, such as Google or
-- Microsoft. Single sign-on is planned; the table is in place for it.
-- `verified_at` records a successful test sign-in, required before the
-- provider can be enabled. `preset` is an ID from
-- app/src/modules/sso/presets.toml.
CREATE TABLE sso_providers (
  id TEXT PRIMARY KEY,
  preset TEXT NOT NULL,
  display_name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  allow_signup BOOLEAN NOT NULL DEFAULT true,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (issuer, client_id)
);
