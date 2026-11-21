---
title: "Commands"
description: "Reference for the dopgate serve, init, admin reset-password, keys rotate, and healthcheck commands, with every option."
---

# Commands

## serve

Start the server.

```bash
dopgate serve [--database-url URL] [--config PATH] [--port PORT] [--host IP]
              [--public-url URL] [--docs BOOL] [--web-ui BOOL]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--database-url` | `DOPGATE_DATABASE_URL` | PostgreSQL URL |
| `--config` | `DOPGATE_CONFIG` | Optional TOML configuration file |
| `--port` | `DOPGATE_PORT`, or `8850` | Port to listen on |
| `--host` | `DOPGATE_HOST`, or `127.0.0.1` | Interface to listen on, such as `0.0.0.0` |
| `--public-url` | `DOPGATE_PUBLIC_URL` | The URL apps and users reach Dopgate on, and the token issuer |
| `--docs` | `false` | Serve Swagger UI at `/api/docs` and the OpenAPI document at `/api/v1/openapi.json` |
| `--web-ui` | `true` | Serve the admin console at `/` |

On startup `serve` connects to PostgreSQL, runs migrations, applies audit retention, makes sure a signing key exists, and prints a banner with the version, the public URL, the bind address, the API and JWKS URLs, the database without its password, the schema, and the console and API docs URLs. Then it handles the root account:

- If root exists, nothing more happens.
- If `DOPGATE_ROOT_EMAIL` is set, it creates root and prints a generated password once, or uses `DOPGATE_ROOT_PASSWORD` if set and prints nothing.
- Otherwise it prints a one-time setup token. Paste it into the console at `/setup`, or send it to `POST /api/v1/bootstrap/root`. The token lives in memory, so a restart prints a new one.

The server stops on Ctrl-C or `SIGTERM`.

## init

Create the root account on a new instance without starting the server.

```bash
dopgate init [--database-url URL] [--config PATH] [--email EMAIL] [--password-stdin]
```

| Option | Meaning |
| --- | --- |
| `--email` | The root email. Default: `DOPGATE_ROOT_EMAIL`, or a prompt. |
| `--password-stdin` | Read the password from standard input instead of prompting. |

The password comes from `DOPGATE_ROOT_PASSWORD` when it is set, then standard input with `--password-stdin`, then a masked prompt. It needs at least 8 characters.

```bash
printf '%s' "$ROOT_PASSWORD" | dopgate init --email admin@example.com --password-stdin
```

`init` runs migrations first, so it works on an empty database. It fails if the instance already has a root account. In Docker, add `-it` for the prompts: `docker run --rm -it -e DOPGATE_DATABASE_URL=... dopbase/dopgate init`.

## admin reset-password

Set a new password for root or an admin who lost theirs. Run it on the machine that hosts the instance, with the server running or stopped.

```bash
dopgate admin reset-password EMAIL [--database-url URL] [--config PATH] [--password-stdin]
```

| Option | Meaning |
| --- | --- |
| `EMAIL` | The root or admin account to reset. |
| `--password-stdin` | Read the new password from standard input instead of generating one. |

By default it generates a password of 24 characters in groups of four and prints it once. Sign in with it, then pick your own on the console's Account page. `DOPGATE_ROOT_PASSWORD` is ignored here, since it often stays set from the first start and would put the old password back.

```bash
dopgate admin reset-password root@example.com
printf '%s' "$NEW_PASSWORD" | dopgate admin reset-password ops@example.com --password-stdin
```

Before it changes anything, it prints the instance it acts on (the database without its password, and the schema) to standard error. The reset clears a lockout from failed sign-ins, ends every console session of the account, and voids any code already emailed to it, so a password reset started earlier can't undo it. A disabled admin stays disabled. It sends no email, so it works without SMTP. The audit log records `admin.password_reset` with the actor `system` and the label `cli`.

It only resets root and admins. Your app's users reset their own password by email, or an admin sends them a code.

There is no check beyond reaching the database: anyone who can run it with the instance's `DOPGATE_DATABASE_URL` can take over any admin, root included. In Docker, run it in the server's container, where the URL is already set: `docker exec <container> dopgate admin reset-password root@example.com`. Dopbase has the same command, `dopbase admin reset-password`.

## keys rotate

Start signing access tokens with a new key.

```bash
dopgate keys rotate [--database-url URL] [--config PATH]
```

The new key becomes `active`. The old one becomes `retiring`: it stays in the JWKS and keeps verifying the tokens it signed for 24 hours, then it is retired. The secret that signs console tokens is replaced in the same step. The audit log records `key.rotated` with the actor `system` and the label `cli`.

A running server reloads its signing keys every minute, so it starts signing with the new key within a minute of `dopgate keys rotate`. It reads the console secret from the database on every request, so console tokens signed with the old secret stop working at once and the console refreshes them. Rotating from the console or with `POST /api/v1/admin/keys/rotate` as root updates the server you call at once.

## healthcheck

Check that a Dopgate server on this machine answers. Made for container health checks.

```bash
dopgate healthcheck [--port PORT]
```

It sends `GET http://127.0.0.1:<port>/api/v1/health` with a 3-second timeout and exits `0` on a `2xx` answer and `1` otherwise, including the `503` Dopgate sends while the database is unreachable. The port comes from `--port`, then `DOPGATE_PORT`, then `8850`. It prints nothing. Because it calls `127.0.0.1`, the server must listen on loopback or on `0.0.0.0`.
