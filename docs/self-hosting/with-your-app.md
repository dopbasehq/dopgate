---
title: "Running with your app's stack"
description: "Add the Dopgate service to your app's Docker Compose file, share your app's PostgreSQL, and put Dopgate behind a reverse proxy on its own host name."
---

# Running with your app's stack

The usual way to run Dopgate is as one more service in your app's Compose file, pointed at the PostgreSQL your app already uses. Dopgate keeps its tables in the `dopgate` schema, so sharing a database is safe.

## Add the service

Copy the `dopgate` service from the repository's `docker-compose.yml` into your app's Compose file. A typical result:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    image: example/your-backend
    environment:
      DOPGATE_URL: http://dopgate:8850
      DOPGATE_ISSUER: https://auth.example.com
      DOPGATE_SERVICE_KEY: ${DOPGATE_SERVICE_KEY}

  dopgate:
    image: dopgate:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DOPGATE_DATABASE_URL: postgres://dopgate:${DOPGATE_DB_PASSWORD}@postgres:5432/app
      DOPGATE_PUBLIC_URL: https://auth.example.com
      DOPGATE_ALLOWED_ORIGINS: https://app.example.com
      DOPGATE_SERVICE_KEY: ${DOPGATE_SERVICE_KEY}
      DOPGATE_ROOT_EMAIL: admin@example.com
      DOPGATE_TRUSTED_PROXIES: 172.16.0.0/12
      DOPGATE_SMTP_HOST: smtp.example.com
      DOPGATE_SMTP_USERNAME: ${SMTP_USERNAME}
      DOPGATE_SMTP_PASSWORD: ${SMTP_PASSWORD}
      DOPGATE_SMTP_FROM_EMAIL: no-reply@example.com
      DOPGATE_SMTP_FROM_NAME: Acme

volumes:
  pgdata:
```

`DOPGATE_URL` and `DOPGATE_ISSUER` are names your backend would read; Dopgate doesn't use them. Your backend can fetch the JWKS and call the admin API over the internal network at `http://dopgate:8850`, but it must still check the issuer against the public URL, because that is what the tokens carry.

The example connects as a `dopgate` database role. The bundled Compose file uses the app's own role for both, which is fine on a laptop. [PostgreSQL and the schema](/self-hosting/postgres#give-dopgate-its-own-role) shows how to create the separate role.

## Put a proxy in front

Serve Dopgate on its own host name over HTTPS. The console uses absolute paths and a cookie scoped to `/api/v1/auth`, so it can't live under a path such as `app.example.com/auth`. With Caddy:

```text
auth.example.com {
	reverse_proxy dopgate:8850
}
```

Caddy gets a certificate and forwards `X-Forwarded-For`. Tell Dopgate to trust the proxy, or every client will seem to come from the proxy's address and share one [rate limit](/guide/rate-limits#the-per-address-limit). `DOPGATE_TRUSTED_PROXIES` takes addresses and CIDR ranges, comma-separated. Compose networks use private ranges such as `172.16.0.0/12`. If you know the proxy's fixed address, list only that.

Don't publish Dopgate's port to the internet directly once a proxy is in front. In the service above there is no `ports:` entry, so only containers on the same network reach it.

## Start order

`depends_on` with `service_healthy` waits for PostgreSQL's health check. Dopgate also retries the database for 30 seconds on its own, so it copes with a database that is slow to accept connections.

## One Dopgate per app

Each Dopgate serves one app: one set of users, settings, and keys. To run two apps, run two Dopgate services with different schemas (`DOPGATE_DATABASE_SCHEMA=dopgate_shop` and `DOPGATE_DATABASE_SCHEMA=dopgate_blog`) or different databases.
