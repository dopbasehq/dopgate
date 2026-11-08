---
title: "Backup and restore"
description: "Back up a dopgate instance, restore it, and move users in and out with export and import."
---

# Backup and restore

::: warning Planned
The backup, restore, export, and import endpoints and CLI commands arrive in phase 7. Until then, back up the data directory as described in [Storage and backups](/self-hosting/storage-backups).
:::

## Backups

A backup is a consistent copy of the whole database, encrypted with the master key, written to the `backups` folder of the data directory. Root creates, downloads, deletes, and restores backups:

```bash
dopgate backup create
dopgate backup restore backups/<file>
```

The same actions are under `/api/v1/admin/backups`. During a restore the API answers `503` and every session ends.

A backup is useless without the master key that encrypted it. Store a copy of `master.key` separately from the backups.

## Export and import

Export writes every user to JSON or CSV. Import creates users from a JSON list, which is how you move users in from another service:

```bash
dopgate users export users.json
dopgate users import users.json
```

Imported users keep their password if you supply an Argon2 hash. Other hash formats, such as the scrypt variant Firebase exports, are on the roadmap.
