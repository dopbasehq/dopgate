---
title: "Configuration"
description: "How Dopgate reads its configuration from DOPGATE_* environment variables, an optional TOML file, and command-line flags, and the settings that live in the database."
---

# Configuration

Dopgate has two kinds of configuration:

- Server configuration, read once at startup: the database, the address, the public URL, CORS, the service key, SMTP. It comes from environment variables, an optional TOML file, and command-line flags.
- Runtime settings, stored in the database and changed without a restart: sign-up rules, the password policy, token lifetimes, limits, and branding. Admins change them in the console or with `PATCH /api/v1/admin/settings`. See [the REST API](/reference/api#settings).

## Environment first

Most deployments only need environment variables. The full list with defaults is in [Environment variables](/reference/environment-variables). A typical production set:

```bash
DOPGATE_DATABASE_URL=postgres://dopgate:secret@postgres:5432/app
DOPGATE_PUBLIC_URL=https://auth.example.com
DOPGATE_ALLOWED_ORIGINS=https://app.example.com
DOPGATE_SERVICE_KEY=<32 or more random characters>
DOPGATE_ROOT_EMAIL=admin@example.com
DOPGATE_TRUSTED_PROXIES=172.16.0.0/12
DOPGATE_SMTP_HOST=smtp.example.com
DOPGATE_SMTP_FROM_EMAIL=no-reply@example.com
```

Booleans such as `DOPGATE_WEB_UI` take `true` or `false`. Lists such as `DOPGATE_ALLOWED_ORIGINS` and `DOPGATE_TRUSTED_PROXIES` are comma-separated.

## Config file

If you prefer a file, point `DOPGATE_CONFIG` or `--config` at a TOML file. Every key is optional, and an unknown key is an error, so typos don't go unnoticed.

```toml
version = 1
database_url = "postgres://dopgate:secret@postgres:5432/app"
database_schema = "dopgate"
public_url = "https://auth.example.com"
host = "0.0.0.0"
port = 8850
shutdown_grace_seconds = 10
audit_retention_days = 365
trusted_proxies = ["172.16.0.0/12"]
allowed_origins = ["https://app.example.com"]
service_key = "..."
root_email = "admin@example.com"
docs = true
web_ui = true

[smtp]
host = "smtp.example.com"
port = 587
security = "starttls"
username = "dopgate"
password = "..."
from_email = "no-reply@example.com"
from_name = "Acme"
```

`version` must be `1` when present. A relative path is resolved from the working directory, and `~/` means your home directory. `DOPGATE_DATABASE_MAX_CONNECTIONS` and `DOPGATE_ROOT_PASSWORD` have no file key and only work as environment variables.

The file holds secrets in plain text, so prefer environment variables for the service key and passwords, or keep the file readable only by the user that runs Dopgate.

## Which value wins

From strongest to weakest:

1. Command-line flags of `dopgate serve`: `--database-url`, `--port`, `--host`, `--public-url`, `--docs`, `--web-ui`, `--config`
2. `DOPGATE_*` environment variables
3. The config file
4. Built-in defaults

`--config` wins over `DOPGATE_CONFIG` for choosing the file.

## The address and the public URL

Dopgate listens on `127.0.0.1:8850` by default. `DOPGATE_HOST` takes an IP address such as `0.0.0.0` or `localhost`, and `DOPGATE_PORT` a port. The Docker image sets `DOPGATE_HOST=0.0.0.0`.

`DOPGATE_PUBLIC_URL` is the URL your app and users reach Dopgate on. It is also the `iss` claim of every access token and decides whether the console's cookie is marked `Secure`. When you don't set it:

- on a loopback address it is `http://localhost:<port>`,
- on any other address it is `http://SERVER_HOST:<port>`, and Dopgate prints a warning telling you to set it.

Dopgate also warns when the public URL uses `http://` on anything but localhost, because passwords and tokens would travel unencrypted.

## Behind a reverse proxy

Without `DOPGATE_TRUSTED_PROXIES`, Dopgate uses the connection's address as the client address for rate limits, session records, and the audit log, and ignores `X-Forwarded-For`. That is the safe default when clients connect directly.

Behind a proxy, list the proxy's addresses or CIDR ranges:

```bash
DOPGATE_TRUSTED_PROXIES=10.0.0.5,172.16.0.0/12
```

When a request comes from a trusted address, Dopgate reads `X-Forwarded-For` from the right and skips every trusted hop, so a client can't pick its own address by sending the header.

## CORS

`DOPGATE_ALLOWED_ORIGINS` lists the browser origins allowed to call the API, such as `https://app.example.com`. Each entry is a scheme, a host, and an optional port, with no path or query. Empty means no cross-origin browser calls. The console doesn't need an entry, because Dopgate serves it on its own origin. [Add Dopgate to your app](/guide/add-to-your-app#allow-your-frontend-s-origin) has the details.

## Root on first start

`DOPGATE_ROOT_EMAIL` creates the root account on a database that has none yet. Dopgate generates a password and prints it once. To choose the password instead, also set `DOPGATE_ROOT_PASSWORD`; Dopgate then prints nothing. Once root exists, both variables are ignored, so you can remove them. Without either, Dopgate prints a one-time setup token for the console's `/setup` page.

## Audit retention

Audit records older than `DOPGATE_AUDIT_RETENTION_DAYS` (365 by default) are deleted at startup and once a day after that. `0` keeps them forever. See [Audit events](/reference/audit-events#retention).
