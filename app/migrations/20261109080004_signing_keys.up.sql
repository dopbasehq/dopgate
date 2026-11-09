-- Keys that sign access tokens. The ID is the JWT `kid`. The private key is
-- a PKCS#8 PEM; guard this schema, since anyone who reads it can sign
-- tokens. The public half is published at /.well-known/jwks.json. Rotation
-- moves the active key to `retiring`, where it still verifies tokens it
-- signed until they expire, then to `retired`.
CREATE TABLE signing_keys (
  id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL CHECK (algorithm = 'ES256'),
  public_jwk JSONB NOT NULL,
  private_pem TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retiring', 'retired')),
  created_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ
);

-- One active key at a time.
CREATE UNIQUE INDEX signing_keys_active_idx ON signing_keys(algorithm) WHERE status = 'active';
