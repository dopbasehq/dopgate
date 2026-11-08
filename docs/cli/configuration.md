---
title: "Server configuration"
description: "The server.toml file, every setting it accepts, and how settings combine with flags and environment variables."
---

# Server configuration

The first `dopgate init` or `dopgate serve` writes `server.toml` to the data directory, with every setting commented out. dopgate never rewrites it after that.

A setting comes from the first of these that has it:

1. A command-line flag
2. An environment variable
3. `server.toml`
4. The default

Restart the server after editing the file.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `version` | `1` | Schema version of the file. |
| `host` | `"127.0.0.1"` | Interface to listen on. |
| `port` | `8850` | Port to listen on. |
| `public_url` | `http://localhost:<port>` | The URL apps and users reach the server on. Token issuers, emailed links, and single sign-on redirects are built from it. |
| `shutdown_grace_seconds` | `10` | How long shutdown waits for requests in flight, 1 to 300. |
| `audit_retention_days` | `365` in the generated file | Days to keep audit records before archiving them. Remove the line to keep them forever. |
| `trusted_proxies` | none | Reverse proxies whose `X-Forwarded-For` header is trusted. IPs or CIDR ranges. |
| `web_ui` | `false` | Serve the Admin UI. |
| `docs` | `true` | Serve Swagger UI and the OpenAPI document. |
| `[master_key] provider` | `"file"` | Where the master key lives. Only `file` exists. |
| `[master_key] path` | `master.key` in the data directory | The master key file. |
| `[smtp] host` | none | SMTP server for outgoing email. Without one, messages go to the server log. |
| `[smtp] security` | `"starttls"` | `starttls`, `tls`, or `none`. |
| `[smtp] port` | 587, 465, or 25 by `security` | SMTP port. |
| `[smtp] username`, `password` | none | SMTP login. Prefer `DOPGATE_SMTP_PASSWORD` for the password. |
| `[smtp] from_email` | none | Sender address. Required with a host. |
| `[smtp] from_name` | none | Sender display name. |

## Example

```toml
host = "0.0.0.0"
port = 8850
public_url = "https://auth.example.com"
audit_retention_days = 365
trusted_proxies = ["127.0.0.1"]

[smtp]
host = "smtp.example.com"
from_email = "no-reply@example.com"

[master_key]
path = "/etc/dopgate/master.key"
```

## Runtime settings

Sign-up rules, token lifetimes, password policy, and branding are not in this file. They live in the database and change through the admin API at `/api/v1/admin/settings`, without a restart. SMTP can be set in both places. An SMTP host saved through the admin API wins over `[smtp]` here. See [Email (SMTP)](/self-hosting/smtp).
