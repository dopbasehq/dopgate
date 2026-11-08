-- Instance settings changed at runtime: SMTP, sign-up rules, token lifetimes,
-- the password policy, email templates, and branding. Plain values are JSON
-- in `value`. Secret values, such as the SMTP password, are encrypted with
-- the master key into `ciphertext` and `nonce` instead.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT CHECK (value IS NULL OR json_valid(value)),
  ciphertext BLOB,
  nonce BLOB,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((ciphertext IS NULL) = (nonce IS NULL)),
  CHECK (value IS NOT NULL OR ciphertext IS NOT NULL)
);
