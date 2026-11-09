-- Admin overrides of the built-in email templates. A row exists only while
-- a template is customized; deleting it brings the built-in version back.
CREATE TABLE email_templates (
  name TEXT PRIMARY KEY
    CHECK (name IN ('verify_email', 'login_code', 'password_reset', 'email_change', 'email_changed', 'password_changed')),
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
