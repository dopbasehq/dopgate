-- The apps that use this instance. A browser or mobile app sends the
-- publishable key; a backend calls the admin API with the secret key, of
-- which only a SHA-256 hash and the last four characters are kept. Sign-in
-- links and single sign-on only redirect to `redirect_urls`, and only
-- `allowed_origins` pass CORS. Both are JSON arrays of strings.
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  publishable_key TEXT NOT NULL UNIQUE,
  secret_key_hash BLOB UNIQUE,
  secret_key_hint TEXT,
  redirect_urls TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(redirect_urls)),
  allowed_origins TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_origins)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
