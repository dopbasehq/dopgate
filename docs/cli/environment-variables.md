---
title: "Environment variables"
description: "Every DOPGATE_ environment variable the server and CLI read."
---

# Environment variables

Environment variables override `server.toml` and are overridden by flags.

| Variable | Matches | Example |
| --- | --- | --- |
| `DOPGATE_DATA_DIR` | `--data-dir` | `/var/lib/dopgate` |
| `DOPGATE_HOST` | `host` | `0.0.0.0` |
| `DOPGATE_PORT` | `port` | `8850` |
| `DOPGATE_PUBLIC_URL` | `public_url` | `https://auth.example.com` |
| `DOPGATE_SHUTDOWN_GRACE_SECONDS` | `shutdown_grace_seconds` | `20` |
| `DOPGATE_AUDIT_RETENTION_DAYS` | `audit_retention_days` | `365` |
| `DOPGATE_TRUSTED_PROXIES` | `trusted_proxies`, comma-separated | `127.0.0.1,10.0.0.0/8` |
| `DOPGATE_DOCS` | `docs` | `false` |
| `DOPGATE_WEB_UI` | `web_ui` | `false` |
| `DOPGATE_MASTER_KEY_PATH` | `[master_key] path` | `/etc/dopgate/master.key` |
| `DOPGATE_SMTP_HOST` | `[smtp] host` | `smtp.example.com` |
| `DOPGATE_SMTP_PORT` | `[smtp] port` | `587` |
| `DOPGATE_SMTP_SECURITY` | `[smtp] security` | `starttls` |
| `DOPGATE_SMTP_USERNAME` | `[smtp] username` | `dopgate` |
| `DOPGATE_SMTP_PASSWORD` | `[smtp] password` | |
| `DOPGATE_SMTP_FROM_EMAIL` | `[smtp] from_email` | `no-reply@example.com` |
| `DOPGATE_SMTP_FROM_NAME` | `[smtp] from_name` | `Example` |
| `DOPGATE_ROOT_EMAIL` | `init --email` | `you@example.com` |
| `DOPGATE_ROOT_PASSWORD` | the `init` password | |
| `RUST_LOG` | log filter | `app=debug,tower_http=info` |

`DOPGATE_ROOT_PASSWORD` ends up in the process environment and possibly your shell history. Prefer `--password-stdin` or the prompt outside of throwaway setups.
