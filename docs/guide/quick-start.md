---
title: "Quick start"
description: "Build dopgate, create the root account, start the server, and open the API docs."
---

# Quick start

This page takes you from source code to a running server with a root account. It needs Rust 1.89 or newer. [Bun](https://bun.sh) is only needed for the docs and the dev script.

## Build the binary

From the repository root:

```bash
cargo build --release --manifest-path app/Cargo.toml
```

The binary is `app/target/release/dopgate`. Copy it anywhere; it carries its own migrations.

## Create the root account

The root account owns the instance. Create it before the first start:

```bash
./app/target/release/dopgate init --email you@example.com
```

dopgate asks for a password of at least 8 characters, then creates `~/.dopgate` with the database, the master key, and a commented `server.toml`.

To script it, pass the password through the environment instead:

```bash
DOPGATE_ROOT_PASSWORD='a long password' ./app/target/release/dopgate init --email you@example.com
```

## Start the server

```bash
./app/target/release/dopgate serve
```

The server listens on `http://localhost:8850`. Check it:

```bash
curl http://localhost:8850/api/v1/health
```

```json
{"success":true,"message":"HEALTH_OK","data":{"product":"dopgate","version":"{{version}}","apiVersion":"v1","status":"ok"}}
```

Open `http://localhost:8850/api/docs` for the Swagger UI. It lists every endpoint, including the ones that are still placeholders.

::: tip Skipped `init`?
If you start the server without a root account, it prints a one-time setup token and a `curl` command that creates the account through `POST /api/v1/bootstrap/root`. The token works once, and five wrong guesses from one address lock that address out for 15 minutes.
:::

## Run everything in development

With Bun installed, one command starts the API and these docs together:

```bash
bun install
bun run dev
```

The API uses `./.dev-data` as its data directory, so it never touches `~/.dopgate`. Create its root account with:

```bash
cargo run --manifest-path app/Cargo.toml -- init --data-dir .dev-data --email you@example.com
```

## What to try next

Sign-up and sign-in are the next features on the [roadmap](/about/roadmap). Until they land, those endpoints answer `501` with the error code `NOT_IMPLEMENTED`. [Product status](/guide/product-status) tracks each one.
