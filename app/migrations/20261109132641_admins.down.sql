-- Since the split, an admin and a user may share an email. `users` allows
-- each email once, so rolling back would have to drop one of them. Stop
-- instead and let the operator change or delete one side first.
DO $$
DECLARE
  conflicts INTEGER;
BEGIN
  SELECT count(*) INTO conflicts FROM admins a JOIN users u ON u.email = a.email;
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'cannot roll back: % admin email(s) also belong to app users; change or delete them first', conflicts;
  END IF;
END $$;

-- Put root and admins back into `users` with their old roles.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('root', 'admin', 'member'));
CREATE UNIQUE INDEX users_single_root_idx ON users(role) WHERE role = 'root';

INSERT INTO users(id,email,email_verified_at,password_hash,display_name,avatar_url,role,status,failed_login_count,locked_until,last_sign_in_at,created_at,updated_at)
SELECT 'usr_' || substr(a.id, 5), a.email, a.email_verified_at, a.password_hash, a.display_name, a.avatar_url, a.role, a.status,
       a.failed_login_count, a.locked_until, a.last_sign_in_at, a.created_at, a.updated_at
FROM admins a;

-- Settings and templates point at the same people under their old IDs.
ALTER TABLE settings DROP CONSTRAINT settings_updated_by_fkey;
ALTER TABLE email_templates DROP CONSTRAINT email_templates_updated_by_fkey;
UPDATE settings SET updated_by = 'usr_' || substr(updated_by, 5) WHERE updated_by IS NOT NULL;
UPDATE email_templates SET updated_by = 'usr_' || substr(updated_by, 5) WHERE updated_by IS NOT NULL;
ALTER TABLE settings ADD CONSTRAINT settings_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

DROP TABLE admin_codes;
DROP TABLE admin_refresh_tokens;
DROP TABLE admin_sessions;
DROP TABLE admins;
