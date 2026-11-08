-- A value encrypted with the master key at first start. Startup decrypts it
-- to prove the configured key file belongs to this database.
CREATE TABLE instance_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  verification_ciphertext BLOB NOT NULL,
  verification_nonce BLOB NOT NULL,
  created_at TEXT NOT NULL
);
