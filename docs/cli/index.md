---
title: "CLI overview"
description: "The Dopgate command: its four commands, the global --json flag, exit codes, and how commands find the database."
---

# CLI overview

The `dopgate` binary is the server and its command line. In the Docker image it is the entrypoint, so `docker run dopgate <command>` runs a command.

```text
dopgate [--json] <command>

Commands:
  serve        Start the server
  init         Create the root account on a new instance
  keys rotate  Start signing with a new key
  healthcheck  Check that a server on this machine answers
```

`dopgate --help` and `dopgate <command> --help` print the options, and `dopgate --version` prints the version. [Commands](/cli/commands) describes each one.

## Finding the database

`serve`, `init`, and `keys rotate` read the same [configuration](/self-hosting/configuration) as the server: `DOPGATE_*` environment variables, an optional TOML file from `--config` or `DOPGATE_CONFIG`, and `--database-url` to override `DOPGATE_DATABASE_URL`. Each of them connects to PostgreSQL and runs any pending migrations first.

## JSON output

`--json` works before or after the command. `init` and `keys rotate` then print one JSON object to standard output on success:

```json
{"success":true,"data":{"userId":"usr_01JC8...","email":"admin@example.com","schema":"dopgate"}}
```

Errors from any command go to standard error, as JSON with `--json`:

```json
{"success":false,"error":{"CLI_ERROR":"this instance already has a root account (schema dopgate)"}}
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, or a healthy server for `healthcheck` |
| `1` | An error, or an unhealthy server for `healthcheck` |
| `130` | You cancelled a prompt with Ctrl-C or Esc. The JSON error code is `CLI_CANCELLED`. |
