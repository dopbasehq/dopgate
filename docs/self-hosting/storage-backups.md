---
title: "Storage and backups"
description: "How dopgate stores data in SQLite and how to back it up safely today."
---

# Storage and backups

Everything dopgate knows is in `dopgate.db`, a SQLite database in WAL mode. Migrations are built into the binary and run at every start before the server listens.

## Backing up today

Until the [backup commands](/guide/backups-and-restore) land, use SQLite's own online backup. It is safe while the server runs:

```bash
sqlite3 ~/.dopgate/dopgate.db ".backup '/backups/dopgate-$(date +%F).db'"
```

Copy `master.key` to a different place than the database backups, once. Without it, encrypted values in a backup cannot be read. With it, anyone holding the backup can read them, so the two should not travel together.

Do not copy `dopgate.db` with `cp` while the server runs. Recent writes may still sit in the `-wal` file, and the copy can be inconsistent.

## Restoring

Stop the server, replace `dopgate.db` with the backup, delete any leftover `dopgate.db-wal` and `dopgate.db-shm`, and start it again with the original `master.key`. A wrong key stops startup with "configured master key does not match this database".

## Audit retention

With `audit_retention_days` set, dopgate moves older audit records to `audit-archive/` as JSON Lines files, once at startup and then daily. The chain still verifies, because retention leaves an anchor where it cut.
