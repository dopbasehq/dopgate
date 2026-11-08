---
title: "Command reference"
description: "Every dopgate command and flag."
---

# Command reference

## Global flags

| Flag | Meaning |
| --- | --- |
| `--json` | Print results and errors as JSON. |
| `--help` | Show help for any command. |
| `--version` | Print the version. |

## Instance flags

`serve` and `init` take these:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--data-dir PATH` | `~/.dopgate` or `DOPGATE_DATA_DIR` | Where the database, key, and config live. |
| `--config PATH` | `server.toml` in the data directory | The server configuration file. |
| `--master-key PATH` | `master.key` in the data directory | The master key file. |

## `dopgate serve`

Run the server until Ctrl-C or `SIGTERM`. It applies migrations and audit retention, then listens. If no root account exists, it prints a one-time setup token.

| Flag | Meaning |
| --- | --- |
| `--port PORT` | Port to listen on. Default `8850`. |
| `--host HOST` | Interface, such as `127.0.0.1` or `0.0.0.0`. Default `127.0.0.1`. |
| `--public-url URL` | The URL apps and users reach the server on. |
| `--docs BOOL` | Serve Swagger UI at `/api/docs`. Default `true`. |
| `--web-ui BOOL` | Serve the Admin UI. Default `false`; the UI is not built yet. |

Only one server can run on a database at a time. A second one exits with an error.

## `dopgate init`

Create the root account without starting the server. It refuses an instance that already has one, and it refuses to run while the server holds the database.

| Flag | Meaning |
| --- | --- |
| `--email EMAIL` | Root email. Falls back to `DOPGATE_ROOT_EMAIL`, then a prompt. |
| `--password-stdin` | Read the password from standard input. |

The password comes from `DOPGATE_ROOT_PASSWORD` when set, then standard input with `--password-stdin`, then a prompt.

```bash
printf '%s' "$ROOT_PASSWORD" | dopgate init --email you@example.com --password-stdin
```

## Planned commands

These exit with code `2` for now.

| Command | Phase |
| --- | --- |
| `dopgate backup create` | 7 |
| `dopgate backup restore FILE` | 7 |
| `dopgate users export FILE` | 7 |
| `dopgate users import FILE` | 7 |
| `dopgate keys rotate` | 2 |
