---
title: "Self-hosting"
description: "What a dopgate server needs and how to put it on the internet."
---

# Self-hosting

A dopgate server is one binary and one data directory. It needs no database server, no cache, and no queue.

## The data directory

`~/.dopgate` by default, or whatever `--data-dir` or `DOPGATE_DATA_DIR` names:

| File | What it is |
| --- | --- |
| `dopgate.db` | The SQLite database, with `-wal` and `-shm` files next to it while running. |
| `master.key` | 32 random bytes that encrypt secrets in the database. See [Encryption keys](/self-hosting/encryption-keys). |
| `server.toml` | Server configuration. See [Server configuration](/cli/configuration). |
| `dopgate.db.lock` | Stops a second server from opening the same database. |
| `audit-archive/` | Audit records moved out by retention. |
| `backups/` | Backups, once that feature lands. |

dopgate creates the directory with mode `0700` and the database and key with mode `0600`.

## Exposing the server

dopgate speaks plain HTTP. In production, put it behind a reverse proxy that terminates TLS, and:

- Set `public_url` to the HTTPS address. Tokens, links, and single sign-on depend on it.
- Bind to `127.0.0.1` if the proxy runs on the same machine.
- Add the proxy's address to `trusted_proxies`, so rate limits and the audit log see the real client address.

See [Running in production](/self-hosting/operations) for a proxy example and a systemd unit.
