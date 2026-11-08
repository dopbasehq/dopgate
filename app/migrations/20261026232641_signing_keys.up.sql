-- Keys that sign access tokens. The ID is the JWT `kid`. The private key is
-- encrypted with the master key; the public half is published at
-- /.well-known/jwks.json. Rotation moves the active key to `retiring`, where
-- it still verifies tokens it signed until they expire, then to `retired`.
CREATE TABLE signing_keys (
  id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL CHECK (algorithm IN ('ES256', 'RS256')),
  public_jwk TEXT NOT NULL CHECK (json_valid(public_jwk)),
  private_ciphertext BLOB NOT NULL,
  private_nonce BLOB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retiring', 'retired')),
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  retired_at TEXT
);

-- One active key per algorithm.
CREATE UNIQUE INDEX signing_keys_active_idx ON signing_keys(algorithm) WHERE status = 'active';
