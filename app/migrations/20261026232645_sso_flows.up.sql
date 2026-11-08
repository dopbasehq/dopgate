-- Sign-ins in progress with a provider. A row holds the PKCE verifier and
-- nonce between the redirect and the callback. The callback consumes it
-- once; a successful sign-in then leaves a short-lived handoff code that
-- the app exchanges for tokens, and the exchange deletes the row.
-- `client_ip` lets the server cap pending flows per address.
CREATE TABLE sso_flows (
  id TEXT PRIMARY KEY,
  state_hash BLOB NOT NULL UNIQUE,
  provider_id TEXT NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'link')),
  nonce TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  redirect_url TEXT,
  client_ip TEXT,
  consumed_at TEXT,
  handoff_hash BLOB UNIQUE,
  handoff_expires_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX sso_flows_expires_idx ON sso_flows(expires_at);
