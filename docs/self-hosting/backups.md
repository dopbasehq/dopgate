---
title: "Backups"
description: "Back up Dopgate's schema with pg_dump --schema=Dopgate, restore it, and what a backup contains."
---

# Backups

All of Dopgate's state is in its PostgreSQL schema, so a backup is a dump of that schema. If you already back up the whole database, Dopgate is included.

## Back up the schema

```bash
pg_dump --schema=dopgate --format=custom --file=dopgate.dump \
  "postgres://dopgate:secret@localhost:5432/app"
```

With the bundled Compose file:

```bash
docker compose exec -T postgres pg_dump -U app -d app --schema=dopgate --format=custom > dopgate.dump
```

`-T` keeps Docker from adding a terminal, which would damage the binary dump. Use your own schema name if you set `DOPGATE_DATABASE_SCHEMA`.

## What a backup holds

The dump contains every account with its password hash, sessions, hashed refresh tokens and codes, settings, templates, the audit log, and the private signing key. Anyone with the dump can sign access tokens that your backend will accept. Encrypt backups and store them with the same care as the database itself.

## Restore

Stop Dopgate first, so nothing writes while you restore. Then replace the schema:

```bash
pg_restore --clean --if-exists --dbname="postgres://dopgate:secret@localhost:5432/app" dopgate.dump
```

Start Dopgate again. It runs any migrations the dump is missing, so a dump from an older version restores into a newer binary. After a restore:

- Sessions started after the backup are gone, so those users sign in again.
- Refresh tokens issued after the backup no longer work.
- Accounts created after the backup are gone, but their IDs may still be in your app's tables.
- If the signing key was rotated after the backup, tokens signed with the newer key fail until users sign in again.

Run **Verify chain** on the console's audit log page, or `GET /api/v1/admin/audit-events/verify`, to confirm the restored log is intact.

## How often

Sessions and codes change all the time, but losing a day of them only means some users sign in again. Accounts and settings change less often and matter more. A nightly dump along with your app's own backups is enough for most apps.
