---
title: "Upgrading"
description: "Move Dopgate to a new version: back up, replace the image, and let migrations run at startup."
---

# Upgrading

Dopgate upgrades by replacing the binary or image and restarting. Migrations are built into the binary and run before the server starts listening.

## Steps

1. Read the changelog for the new version.
2. [Back up](/self-hosting/backups) the `dopgate` schema.
3. Build or pull the new image. From a checkout of the new version: `docker build -t dopgate .`
4. Restart the service: `docker compose up -d dopgate`.
5. Check `docker compose logs dopgate` and `GET /api/v1/health`.

Migrations only go forward. sqlx records each applied migration with a checksum in `_sqlx_migrations` inside the `dopgate` schema, and refuses to start if a recorded migration changed or is missing from the binary.

## Going back

An older binary can't start on a database that a newer one migrated, because the database has migrations the old binary doesn't know. To go back, restore the backup you took before upgrading, then start the old version.

## Several instances

Two Dopgate processes starting at once against the same schema is safe: sqlx takes a lock for migrations, and key generation locks the `signing_keys` table. Still, upgrade one at a time and keep in mind that [rate limit counters](/guide/rate-limits#counters-live-in-memory) are per process.

## Coming from a build before the admin split

Earlier development builds kept root and admins in the `users` table with a `role` column. The first start of a newer build moves them into `admins`, keeping their passwords. Their IDs change from `usr_` to `adm_`, the `role` column is dropped, and their old sessions and codes are deleted, so they sign in to the console again. Settings and templates keep the admin who last saved them.

## Coming from a 0.1.0 preview

Early 0.1.0 previews stored data in SQLite under a data directory, `.dev-data` during development, with a master key file. The current version reads none of that and has no import from it. Start with a fresh PostgreSQL database, and delete the old `.dev-data` folder.
