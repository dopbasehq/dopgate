# Dopgate: modern auth for people and AI agents

Dopgate is an auth server for one app, made by [Dopbase](https://dopbase.com). It signs users up and in, confirms their email with 6-digit codes, resets passwords, and gives AI agents accounts of their own. Every access token is an ES256 JWT that says whether a person or an agent is calling, and your backend verifies it offline against a public key set.

Dopgate runs in your infrastructure as one container next to your app. It keeps every table in a PostgreSQL schema (`dopgate` by default), so it can share your app's database.

## Quick reference

- Source, docs, and issues: [github.com/dopbasehq/dopgate](https://github.com/dopbasehq/dopgate)
- Tags: `latest`, and for every release its version and its minor line, such as `0.1.0` and `0.1`
- Platforms: `linux/amd64` and `linux/arm64`
- Needs: a PostgreSQL database
- Port: `8850`
- License: Apache-2.0

## What you get

- Auth for AI agents. Each agent has an account of its own and signs in with its own token. Its JWT carries `kind: agent`, its owner, and the capabilities the owner gave it.
- User authentication: sign-up and sign-in by password or emailed 6-digit code, email verification, password reset, sessions, and single-use refresh tokens.
- JWT authentication your backend checks offline, against the key set at `/.well-known/jwks.json`.
- A hash-chained audit log, so an edited or deleted record shows up when you verify the chain.
- Argon2id password hashes, tokens and codes stored only as hashes, rate limits, and account lockout.
- An admin console built into the binary, served at `/`.

Single sign-on and multi-factor authentication are planned and are not in this image yet. [Product status](https://github.com/dopbasehq/dopgate/blob/main/docs/guide/product-status.md) lists what works today.

## Start Dopgate with Docker Compose

Save this as `compose.yaml`, and change the password and the root email:

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: change-me
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 10

  dopgate:
    image: dopbase/dopgate
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DOPGATE_DATABASE_URL: postgres://app:change-me@postgres:5432/app
      DOPGATE_PUBLIC_URL: http://localhost:8850
      DOPGATE_ROOT_EMAIL: admin@example.com
    ports:
      - "8850:8850"

volumes:
  pgdata:
```

Then start it and read the log:

```bash
docker compose up -d
docker compose logs dopgate
```

The log shows the root password once. Open http://localhost:8850, sign in with the root email and that password, and change the password on the Account page. The API is at http://localhost:8850/api/v1.

Without SMTP settings, Dopgate writes every email, codes included, to its log. For anything you keep running, pin a version such as `dopbase/dopgate:0.1` in place of `latest`.

## Run it against a database you already have

```bash
docker run -d --name dopgate -p 8850:8850 \
  -e DOPGATE_DATABASE_URL=postgres://user:password@db.example.com:5432/app \
  -e DOPGATE_PUBLIC_URL=https://auth.example.com \
  -e DOPGATE_ROOT_EMAIL=admin@example.com \
  dopbase/dopgate
```

On startup Dopgate waits up to 30 seconds for PostgreSQL, creates its schema if needed, runs migrations, and generates a signing key on a fresh database. Read the root password with `docker logs dopgate`.

Always set `DOPGATE_PUBLIC_URL`. It becomes the `iss` claim of every access token, so your backend's issuer check fails when it is wrong.

## Environment variables

| Variable | What it does |
| --- | --- |
| `DOPGATE_DATABASE_URL` | PostgreSQL URL. Required. |
| `DOPGATE_PUBLIC_URL` | The URL your app and users reach Dopgate on, and the issuer of every access token. |
| `DOPGATE_ROOT_EMAIL` | On a database without a root account, creates root for this email and prints a generated password once. |
| `DOPGATE_ALLOWED_ORIGINS` | Browser origins allowed to call the API, comma-separated, such as `https://app.example.com`. |
| `DOPGATE_SERVICE_KEY` | Bearer token your backend uses for the admin API. At least 32 characters. |
| `DOPGATE_TRUSTED_PROXIES` | Addresses or CIDR ranges of reverse proxies whose `X-Forwarded-For` is trusted. |
| `DOPGATE_DATABASE_SCHEMA` | Schema for every Dopgate table. `dopgate` by default. |
| `DOPGATE_SMTP_URL` | The SMTP server, as `smtp://username:password@host:587`. Unset leaves SMTP to the console, or sends emails to the log. |
| `DOPGATE_DOCS` | Set to `true` to serve Swagger UI at `/api/docs`. |

The [environment variable reference](https://github.com/dopbasehq/dopgate/blob/main/docs/reference/environment-variables.md) has the full list with defaults.

## One-off commands

The entrypoint is the `dopgate` binary, so anything after the image name is a Dopgate command:

```bash
# Create the root account interactively instead of using DOPGATE_ROOT_EMAIL
docker run --rm -it -e DOPGATE_DATABASE_URL=postgres://... dopbase/dopgate init

# Rotate the key that signs access tokens
docker run --rm -e DOPGATE_DATABASE_URL=postgres://... dopbase/dopgate keys rotate

# Set a new password for root or an admin who lost theirs
docker run --rm -e DOPGATE_DATABASE_URL=postgres://... dopbase/dopgate admin reset-password admin@example.com
```

In a Compose stack, `docker compose run --rm dopgate init` does the same with the service's own settings.

## What is in the image

- One static binary on a distroless base, about 8 MB to pull. There is no shell, and it runs as the `nonroot` user.
- The same binary as the Linux archive of the matching [GitHub release](https://github.com/dopbasehq/dopgate/releases).
- A health check, `dopgate healthcheck`, that runs every 15 seconds.
- No volumes. Accounts, sessions, signing keys, settings, and the audit log all live in PostgreSQL, so you can replace the container as long as it points at the same database.

Dopgate stops on `SIGTERM`: it finishes the requests in flight and closes its database connections.

## Documentation

- [Quick start](https://github.com/dopbasehq/dopgate/blob/main/docs/guide/quick-start.md)
- [Auth for AI agents](https://github.com/dopbasehq/dopgate/blob/main/docs/ai-agents/index.md) and how to [check an agent in your backend](https://github.com/dopbasehq/dopgate/blob/main/docs/ai-agents/verify-in-your-backend.md)
- [Add Dopgate to your app](https://github.com/dopbasehq/dopgate/blob/main/docs/guide/add-to-your-app.md)
- [Running with your app's stack](https://github.com/dopbasehq/dopgate/blob/main/docs/self-hosting/with-your-app.md), with a reverse proxy in front
- [REST API](https://github.com/dopbasehq/dopgate/blob/main/docs/reference/api.md)
- [Security model](https://github.com/dopbasehq/dopgate/blob/main/docs/reference/security.md)
- [Benchmarks](https://github.com/dopbasehq/dopgate/blob/main/docs/reference/benchmarks.md), with the hardware and the script that measured them
- [Upgrading](https://github.com/dopbasehq/dopgate/blob/main/docs/self-hosting/upgrading.md) and the [changelog](https://github.com/dopbasehq/dopgate/blob/main/CHANGELOG.md)

## License

Apache-2.0. See [LICENSE](https://github.com/dopbasehq/dopgate/blob/main/LICENSE).
