-- The secret that signs console access tokens (HS256). It never leaves
-- Dopgate and is not in the JWKS, so a backend that trusts the JWKS can't
-- accept an admin's token. Rotating the signing keys replaces it, and the
-- console refreshes its token. One active secret at a time.
CREATE TABLE console_keys (
  id TEXT PRIMARY KEY,
  secret BYTEA NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  created_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX console_keys_active_idx ON console_keys(status) WHERE status = 'active';
