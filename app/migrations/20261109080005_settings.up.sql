-- Instance settings changed at runtime: sign-up rules, the password policy,
-- token lifetimes, limits, and branding. One JSON object per section. SMTP
-- is not here: it comes from the environment only.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
