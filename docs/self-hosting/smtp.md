---
title: "Email (SMTP)"
description: "Connect dopgate to an SMTP server so it can send verification codes, sign-in links, and password resets."
---

# Email (SMTP)

::: warning Partly built
dopgate stores SMTP settings and sends mail through them. The admin endpoints below answer `501` until access tokens land in phase 2, because nothing can verify an admin token before then. Until then, set SMTP in [`server.toml`](#in-server-toml). The emails themselves (verification codes, sign-in links, password resets) arrive with the rest of phase 3.
:::

dopgate sends mail for email verification, passwordless sign-in, and password resets. It talks to any SMTP server: your own, or a provider such as Amazon SES, Postmark, Mailgun, or Resend.

There are two places to set SMTP. Runtime settings change through the admin API without a restart. `server.toml` and `DOPGATE_SMTP_*` variables are read at startup. When both have a host, the runtime settings win.

## Runtime settings

```bash
curl -X PATCH https://auth.example.com/api/v1/admin/settings \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"smtp":{"host":"smtp.example.com","port":587,"username":"dopgate","password":"...","security":"starttls","fromEmail":"no-reply@example.com","fromName":"Example"}}'
```

| Field | Meaning |
| --- | --- |
| `host` | Host name or IP address, without a scheme or port. |
| `port` | Defaults to the usual port for `security`: 587, 465, or 25. |
| `security` | `starttls` (the default), `tls` for TLS from the first byte, or `none` for a relay on the same host or a private network. |
| `username`, `password` | Optional. dopgate signs in only when a username is set. |
| `fromEmail` | The sender address. Required while `host` is set. |
| `fromName` | Optional display name for the sender. |

Fields you leave out keep their saved value. An empty string clears `host`, `username`, `password`, `fromEmail`, or `fromName`. Clearing `host` hands mail back to `server.toml`, or to the server log when that has no host either.

The password is encrypted with the master key and never returned. `GET /api/v1/admin/settings` shows `passwordSet` instead, and `smtp.source` says where mail goes right now: `settings`, `server_config`, or `log`. Every change is recorded in the audit log as `settings.updated`, without the values.

## In server.toml

The generated `server.toml` has a commented `[smtp]` table. Uncomment the header and the lines you need, then restart:

```toml
[smtp]
host = "smtp.example.com"
security = "starttls"
port = 587
username = "dopgate"
password = "change-me"
from_email = "no-reply@example.com"
from_name = "Example"
```

The fields mean the same as above, in snake case. Each one also has an environment variable, which wins over the file: `DOPGATE_SMTP_HOST`, `DOPGATE_SMTP_PORT`, `DOPGATE_SMTP_SECURITY`, `DOPGATE_SMTP_USERNAME`, `DOPGATE_SMTP_PASSWORD`, `DOPGATE_SMTP_FROM_EMAIL`, and `DOPGATE_SMTP_FROM_NAME`. An empty variable clears the file's value.

dopgate writes `server.toml` readable only by its owner, but the password sits there in plain text. To keep it out of the file, set `DOPGATE_SMTP_PASSWORD` instead. A bad value, such as a host with a port in it or a host without `from_email`, stops the server at startup with a message naming the field.

dopgate checks the server certificate against the operating system's trusted roots.

## Test the settings

```bash
curl -X POST https://auth.example.com/api/v1/admin/settings/smtp/test \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"to":"you@example.com"}'
```

This sends a short message through whichever SMTP server is in use, runtime settings or `server.toml`. If the server refuses it or cannot be reached, the response is `502 SMTP_SEND_FAILED` with the server's answer in the message. Without a host it answers `400 SMTP_NOT_CONFIGURED`.

## Without SMTP

With no SMTP host in either place, dopgate writes each message to the server log instead of sending it. That is enough for local development: the code or link is right there in the terminal.
