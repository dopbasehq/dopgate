---
title: "Email (SMTP)"
description: "Connect Dopgate to an SMTP server with DOPGATE_SMTP_* variables, check it with a test email, and read codes from the log during development."
---

# Email (SMTP)

Dopgate sends six kinds of email: verification codes, sign-in codes, password reset codes, email change codes, and two notices. It talks to any SMTP server, your own or a provider such as Amazon SES, Postmark, Mailgun, or Resend.

SMTP is set with environment variables, or the `[smtp]` table of the [config file](/self-hosting/configuration#config-file), and read at startup. The admin API and the console only show the SMTP settings; they can't change them. A `PATCH /api/v1/admin/settings` that includes `smtp` answers `422 SETTINGS_INVALID`.

## Variables

```bash
DOPGATE_SMTP_HOST=smtp.example.com
DOPGATE_SMTP_PORT=587
DOPGATE_SMTP_SECURITY=starttls
DOPGATE_SMTP_USERNAME=dopgate
DOPGATE_SMTP_PASSWORD=change-me
DOPGATE_SMTP_FROM_EMAIL=no-reply@example.com
DOPGATE_SMTP_FROM_NAME=Acme
```

| Variable | Meaning |
| --- | --- |
| `DOPGATE_SMTP_HOST` | Host name or IP address, with no scheme, port, or `@`. Leave it empty to write emails to the log. |
| `DOPGATE_SMTP_PORT` | Defaults to the usual port for the security mode: 587 for `starttls`, 465 for `tls`, 25 for `none`. |
| `DOPGATE_SMTP_SECURITY` | `starttls` (the default) upgrades a plain connection. `tls` uses TLS from the first byte. `none` sends unencrypted, only for a relay on the same host or a private network. |
| `DOPGATE_SMTP_USERNAME` | Optional. Dopgate signs in to the server only when a username is set. |
| `DOPGATE_SMTP_PASSWORD` | The password for that username. Spaces are kept. |
| `DOPGATE_SMTP_FROM_EMAIL` | The sender address. Required when a host is set. |
| `DOPGATE_SMTP_FROM_NAME` | Optional display name for the sender, such as your app's name. |

Empty values count as unset. A bad value stops Dopgate at startup with a message that names it: a host with a port or scheme in it, a host without a from address, an unknown security mode, or a username or name with a line break.

Dopgate checks the server's certificate against the trusted roots of the image and waits up to 15 seconds for each SMTP command.

## Check it with a test email

From the console, open **Settings** and use **Send a test email** in the SMTP section. From the API:

```bash
curl -X POST https://auth.example.com/api/v1/admin/settings/smtp/test \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"to":"you@example.com"}'
```

Without `to`, the message goes to the signed-in admin's own email. The service key has no email, so it must give `to`.

| Answer | Meaning |
| --- | --- |
| `200 SMTP_TEST_SENT` | The SMTP server accepted the message. |
| `400 SMTP_NOT_CONFIGURED` | No host or no from address is set. |
| `400 EMAIL_INVALID` | `to` is not a valid address, or the service key left it out. |
| `502 SMTP_SEND_FAILED` | The server refused the message or couldn't be reached. The message holds the server's answer. |

`GET /api/v1/admin/settings` returns the settings in use under `smtp`, without the password: `host`, `port`, `security`, `username`, `passwordSet`, `fromEmail`, `fromName`, and `source`. `source` is `server_config` when a host is set and `log` when it isn't.

## Without SMTP

With no host, Dopgate writes each email's recipient, subject, and plain text to its log at the `info` level instead of sending it. That covers local development: the 6-digit code is right there in the terminal or in `docker compose logs dopgate`. Don't run a public instance this way, since anyone who can read the logs can read the codes.

## Failures don't block requests

Dopgate sends emails in the background. A sign-up, a code request, or a password reset answers right away, and a failed send is written to the log with the template name and recipient. Watch the log after changing SMTP settings, or use the test email above.
