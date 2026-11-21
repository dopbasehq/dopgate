-- Provider identities linked to accounts. After the first link a sign-in is
-- matched on (issuer, subject) only, never on email again, so a changed
-- email at the provider cannot move the identity to another account.
CREATE TABLE user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email_at_link TEXT,
  linked_via TEXT NOT NULL CHECK (linked_via IN ('signup', 'auto', 'manual')),
  created_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ,
  UNIQUE (issuer, subject),
  UNIQUE (user_id, provider_id)
);
