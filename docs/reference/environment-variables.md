---
title: "Environment variables"
description: "Every DOPGATE_* environment variable, its config file key, its default, and what it accepts."
---

# Environment variables

Dopgate reads these at startup. Environment variables win over the [config file](/self-hosting/configuration#config-file), and `dopgate serve` flags win over both. Empty values count as unset for the service key, the root email, and the SMTP settings.

## Server

| Variable | File key | Default | Meaning |
| --- | --- | --- | --- |
| `DOPGATE_DATABASE_URL` | `database_url` | none, required | PostgreSQL URL starting with `postgres://` or `postgresql://` |
| `DOPGATE_DATABASE_SCHEMA` | `database_schema` | `dopgate` | Schema for every Dopgate table. Lowercase letters, digits, and underscores; not starting with `pg_`; at most 63 bytes. |
| `DOPGATE_DATABASE_MAX_CONNECTIONS` | none | `10` | Most connections the pool opens, 1 to 1000 |
| `DOPGATE_PUBLIC_URL` | `public_url` | `http://localhost:<port>` on loopback, `http://SERVER_HOST:<port>` otherwise | The URL apps and users reach Dopgate on, and the `iss` of every access token. Absolute `http://` or `https://`. |
| `DOPGATE_HOST` | `host` | `127.0.0.1` (`0.0.0.0` in the image) | IP address to listen on, or `localhost` |
| `DOPGATE_PORT` | `port` | `8850` | Port to listen on |
| `DOPGATE_SHUTDOWN_GRACE_SECONDS` | `shutdown_grace_seconds` | `10` | Seconds to wait for database connections to close at shutdown, 1 to 300 |
| `DOPGATE_TRUSTED_PROXIES` | `trusted_proxies` | none | Comma-separated addresses or CIDR ranges of reverse proxies whose `X-Forwarded-For` is trusted |
| `DOPGATE_ALLOWED_ORIGINS` | `allowed_origins` | none | Comma-separated browser origins allowed to call the API, such as `https://app.example.com` |
| `DOPGATE_AUDIT_RETENTION_DAYS` | `audit_retention_days` | `365` | Days audit records are kept. `0` keeps them forever. |
| `DOPGATE_DOCS` | `docs` | `true` | Serve Swagger UI at `/api/docs` and OpenAPI at `/api/v1/openapi.json` |
| `DOPGATE_WEB_UI` | `web_ui` | `true` | Serve the admin console at `/` |
| `DOPGATE_CONFIG` | none | none | Path to an optional TOML config file. `--config` wins over it. |
| `RUST_LOG` | none | `app=info,tower_http=info` (`app=info,tower_http=warn` in the image) | Log levels, in `tracing` filter syntax |

## Access

| Variable | File key | Default | Meaning |
| --- | --- | --- | --- |
| `DOPGATE_SERVICE_KEY` | `service_key` | none | Bearer token your backend uses for the admin API. At least 32 characters. Unset turns service access off. |
| `DOPGATE_ROOT_EMAIL` | `root_email` | none | On a database without root, create root with this email at startup. Ignored once root exists. Also the default email for `dopgate init`. |
| `DOPGATE_ROOT_PASSWORD` | none | none | The password for root created from `DOPGATE_ROOT_EMAIL`, instead of a generated one. Also read by `dopgate init`. |

## SMTP

| Variable | File key | Default | Meaning |
| --- | --- | --- | --- |
| `DOPGATE_SMTP_HOST` | `smtp.host` | none | SMTP host name or IP address. Unset writes emails to the log. |
| `DOPGATE_SMTP_PORT` | `smtp.port` | `587`, `465`, or `25` by security mode | SMTP port |
| `DOPGATE_SMTP_SECURITY` | `smtp.security` | `starttls` | `starttls`, `tls`, or `none` |
| `DOPGATE_SMTP_USERNAME` | `smtp.username` | none | Sign in to the SMTP server with this username |
| `DOPGATE_SMTP_PASSWORD` | `smtp.password` | none | The SMTP password |
| `DOPGATE_SMTP_FROM_EMAIL` | `smtp.from_email` | none | Sender address. Required when a host is set. |
| `DOPGATE_SMTP_FROM_NAME` | `smtp.from_name` | none | Sender display name |

## Values that stop startup

Dopgate refuses to start, with a message naming the problem, when:

- `DOPGATE_DATABASE_URL` is missing or isn't a PostgreSQL URL,
- the schema name, a number, a boolean, a proxy entry, or an origin can't be parsed,
- `DOPGATE_SERVICE_KEY` is shorter than 32 characters,
- `DOPGATE_ROOT_EMAIL` isn't a valid email,
- the SMTP host has a scheme or port in it, or a host is set without a from address,
- the config file has an unknown key or a `version` other than `1`.

Booleans take `true` or `false`.

## Used by the tooling

| Variable | Used by | Meaning |
| --- | --- | --- |
| `POSTGRES_PASSWORD`, `POSTGRES_PORT` | `docker-compose.yml` | Password and published port of the bundled PostgreSQL |
| `DOPGATE_TEST_DATABASE_URL` | `bun run test:app` | PostgreSQL for the backend tests. Default `postgres://postgres:dopgate@localhost:55432/postgres`. |
| `DOPGATE_API_URL` | the console's Vite dev server | Where `/api` is proxied during development. Default `http://localhost:8850`. |
| `DOPGATE_DOCS_URL` | `bun run build:docs` | Published address of this site, for canonical links and the sitemap |
