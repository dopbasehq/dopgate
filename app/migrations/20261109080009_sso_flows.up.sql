-- Sign-ins in progress with a provider. A row holds the PKCE verifier and
-- nonce between the redirect and the callback. The callback consumes it
-- once; a successful sign-in then leaves a short-lived handoff code that
-- the app exchanges for tokens, and the exchange deletes the row.
CREATE TABLE sso_flows (
  id TEXT PRIMARY KEY,
  state_hash BYTEA NOT NULL UNIQUE,
  provider_id TEXT NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'link')),
  nonce TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  redirect_url TEXT,
  client_ip TEXT,
  consumed_at TIMESTAMPTZ,
  handoff_hash BYTEA UNIQUE,
  handoff_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sso_flows_expires_idx ON sso_flows(expires_at);
