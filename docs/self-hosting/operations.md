---
title: "Running in production"
description: "Run dopgate behind a reverse proxy, as a systemd service, with logs and health checks."
---

# Running in production

## Reverse proxy

dopgate does not terminate TLS. A Caddy example:

```text
auth.example.com {
  reverse_proxy 127.0.0.1:8850
}
```

And the matching `server.toml`:

```toml
host = "127.0.0.1"
port = 8850
public_url = "https://auth.example.com"
trusted_proxies = ["127.0.0.1"]
```

## systemd

```ini
[Unit]
Description=dopgate
After=network-online.target

[Service]
User=dopgate
ExecStart=/usr/local/bin/dopgate serve --data-dir /var/lib/dopgate
Restart=on-failure
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Create the root account once before enabling the service:

```bash
sudo -u dopgate dopgate init --data-dir /var/lib/dopgate --email you@example.com
```

## Health checks

`GET /api/v1/health` answers `200` with the version while the server runs. It does not need a token.

## Logs

dopgate logs to standard error. `RUST_LOG` sets the filter; the default is `app=info,tower_http=info`. Every response carries an `x-request-id` header that also appears in the logs.

At startup and shutdown dopgate logs the head of the audit chain. Your log collector then holds a copy outside the database, which helps prove later that the log was not rewritten.

## Upgrades

Stop the server, replace the binary, start it. Migrations run on start. Take a backup first.
