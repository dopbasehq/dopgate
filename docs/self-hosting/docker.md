---
title: "Docker image"
description: "Pull the Dopgate image from Docker Hub or build it yourself, run it against PostgreSQL, and use it for one-off commands such as `dopgate init` and `dopgate keys rotate`."
---

# Docker image

The Dopgate image holds the `dopgate` binary with the admin console built in. It needs nothing at runtime except a PostgreSQL URL. Every release is on Docker Hub as [`dopbase/dopgate`](https://hub.docker.com/r/dopbase/dopgate), and the repository's `Dockerfile` builds one from source.

## Pull it

```bash
docker pull dopbase/dopgate:{{version}}
```

Each release has three tags: its version (`{{version}}`), its minor line (such as `0.1`), which moves to the newest patch, and `latest`, which follows the highest version. Pin the version or the minor line for anything you keep running. The image is built for `linux/amd64` and `linux/arm64`.

The published image holds the same static binary as the Linux archive of the GitHub release, on a distroless base with CA certificates, no shell, and a non-root user. It is about 8 MB to pull.

## Build it

To run a change of your own, or a commit that has no release yet, build the image from the repository root:

```bash
docker build -t dopgate .
```

`bun run docker:build` does the same, and both name the image `dopgate`. Use that name in place of `dopbase/dopgate` in the commands below. The build has three stages: Bun builds the console into `ui/dist`, Rust builds the binary with the console embedded, and the result is copied into a small distroless image with glibc and CA certificates, no shell, and a non-root user.

## What the image sets

| Setting | Value |
| --- | --- |
| Entrypoint | `/usr/local/bin/dopgate` |
| Default command | `serve` |
| `DOPGATE_HOST` | `0.0.0.0`, so the server listens on every interface in the container |
| `DOPGATE_PORT` | `8850` |
| `RUST_LOG` | `app=info,tower_http=warn` |
| Exposed port | `8850` |
| User | `nonroot` |
| Health check | `dopgate healthcheck` every 15 seconds, after a 40-second start period |

To reach Dopgate on another port, change the published port (`-p 9000:8850`) and leave `DOPGATE_PORT` alone. The bundled `docker-compose.yml` pins `DOPGATE_PORT` to 8850 inside the container and publishes it on `DOPGATE_HOST_PORT`, 8850 by default. Set `DOPGATE_HOST_PORT` in `.env` to use another port on the host.

## Run it

```bash
docker run -d --name dopgate -p 8850:8850 \
  -e DOPGATE_DATABASE_URL=postgres://dopgate:secret@db.internal:5432/app \
  -e DOPGATE_PUBLIC_URL=https://auth.example.com \
  -e DOPGATE_ROOT_EMAIL=admin@example.com \
  dopbase/dopgate
```

Always set `DOPGATE_PUBLIC_URL`. Because the image listens on `0.0.0.0`, Dopgate can't guess the address people reach it on, and without the variable it uses `http://SERVER_HOST:8850` and prints a warning. That value becomes the `iss` claim of every access token, so your backend's issuer check would fail.

On startup Dopgate waits up to 30 seconds for PostgreSQL, creates its schema if needed, runs migrations, and generates a signing key on a fresh database. With `DOPGATE_ROOT_EMAIL` set and no root account yet, it creates root and prints a generated password once. Read it with `docker logs dopgate`.

## One-off commands

The entrypoint is the `dopgate` binary, so anything after the image name is a Dopgate command:

```bash
# Create root interactively instead of using DOPGATE_ROOT_EMAIL
docker run --rm -it -e DOPGATE_DATABASE_URL=postgres://... dopbase/dopgate init

# Rotate the signing key
docker run --rm -e DOPGATE_DATABASE_URL=postgres://... dopbase/dopgate keys rotate
```

In a Compose stack, use `docker compose run --rm dopgate init` or `docker compose exec dopgate dopgate keys rotate`. The running server picks up a key rotated from the CLI within a minute; see [the command reference](/cli/commands#keys-rotate).

## Stopping

Dopgate stops on `SIGTERM` or Ctrl-C. It stops accepting connections, finishes the requests in flight, writes an audit checkpoint to the log, and closes its database connections, waiting at most `DOPGATE_SHUTDOWN_GRACE_SECONDS` (10 by default) for that last step.
