-- Put root and admins back into `users` with their old roles.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('root', 'admin', 'member'));
CREATE UNIQUE INDEX users_single_root_idx ON users(role) WHERE role = 'root';

UPDATE settings SET updated_by = NULL;
UPDATE email_templates SET updated_by = NULL;
ALTER TABLE settings DROP CONSTRAINT settings_updated_by_fkey;
ALTER TABLE settings ADD CONSTRAINT settings_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE email_templates DROP CONSTRAINT email_templates_updated_by_fkey;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

-- An admin whose email also has a user account stays out: the user keeps it.
INSERT INTO users(id,email,email_verified_at,password_hash,display_name,avatar_url,role,status,failed_login_count,locked_until,last_sign_in_at,created_at,updated_at)
SELECT 'usr_' || substr(a.id, 5), a.email, a.email_verified_at, a.password_hash, a.display_name, a.avatar_url, a.role, a.status,
       a.failed_login_count, a.locked_until, a.last_sign_in_at, a.created_at, a.updated_at
FROM admins a
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = a.email);

DROP TABLE admin_codes;
DROP TABLE admin_refresh_tokens;
DROP TABLE admin_sessions;
DROP TABLE admins;
