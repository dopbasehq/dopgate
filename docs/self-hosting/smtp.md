---
title: "Email (SMTP)"
description: "Connect Dopgate to an SMTP server from the console or with DOPGATE_SMTP_URL, check it with a test email, and read codes from the log during development."
---

# Email (SMTP)

Dopgate sends six kinds of email: verification codes, sign-in codes, password reset codes, email change codes, and two notices. It talks to any SMTP server, your own or a provider such as Amazon SES, Postmark, Mailgun, or Resend.

## Where the settings come from

Dopgate picks one source for the whole SMTP setup, in this order:

1. The server config. When `DOPGATE_SMTP_URL` (or `url` in the `[smtp]` table of the [config file](/self-hosting/configuration#config-file)) is set, every SMTP value comes from the environment and the file, read at startup. The console shows them read-only, and a `PATCH /api/v1/admin/settings` that includes `smtp` answers `422 SETTINGS_INVALID`.
2. The console. Without a URL in the server config, an admin sets SMTP under **Settings**, and Dopgate stores it in the database. Changes apply to the next email, with no restart. `DOPGATE_SMTP_FROM_EMAIL` and `DOPGATE_SMTP_FROM_NAME` are ignored while `DOPGATE_SMTP_URL` is empty.
3. Neither. With no server anywhere, emails go to the [log](#without-smtp).

The two sources don't mix. A URL from the environment never picks up a password saved in the console.

When nothing sets a sender address, mail comes from `no-reply@dopgate.com`. The port defaults to the usual one for the security mode.

## Set it in the console

Open **Settings** and fill in **Email delivery (SMTP)**: host, port, security, username, password, and the sender address and name. Save, then send a test email from the same card.

The password is encrypted with a key derived from `DOPGATE_SERVICE_KEY` before it reaches the database, and the API never returns it. That means:

- Saving a password needs `DOPGATE_SERVICE_KEY` set on the server. Without it, the console disables the password field, and the API answers `422 SETTINGS_INVALID`. A server that takes no username works without one.
- Changing or removing the service key makes the saved password unreadable. Sends fail, the test email answers `400 SMTP_PASSWORD_UNREADABLE`, and you enter the password again.
- Leaving the password field empty keeps the saved password. **Remove the saved password** clears it.

Over the API, send the whole section:

```bash
curl -X PATCH https://auth.example.com/api/v1/admin/settings \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"smtp":{"host":"smtp.example.com","port":587,"security":"starttls","username":"dopgate","password":"change-me","fromEmail":"no-reply@example.com","fromName":"Acme"}}'
```

Leave out `password`, or send `null`, to keep the saved one. Send `""` to remove it. An empty `host` turns SMTP off.

## Set it with variables

```bash
DOPGATE_SMTP_URL=smtp://dopgate:change-me@smtp.example.com:587
DOPGATE_SMTP_FROM_EMAIL=no-reply@example.com
DOPGATE_SMTP_FROM_NAME=Acme
```

| Variable | Meaning |
| --- | --- |
| `DOPGATE_SMTP_URL` | The server, as `smtp://username:password@host:port`. Leave it empty to manage SMTP in the console instead. |
| `DOPGATE_SMTP_FROM_EMAIL` | The sender address. Defaults to `no-reply@dopgate.com`. |
| `DOPGATE_SMTP_FROM_NAME` | Optional display name for the sender, such as your app's name. |

### The URL

The start of the URL sets how the connection is protected, and the port when you leave it out:

| URL | Security | Port |
| --- | --- | --- |
| `smtp://host` | STARTTLS, which upgrades a plain connection | 587 |
| `smtps://host` | TLS from the first byte | 465 |
| `smtp://host?security=none` | Unencrypted, only for a relay on the same host or a private network | 25 |

The username and password are optional. Dopgate signs in to the server only when the URL has a username. The host is a name or an IP address, and an IPv6 address goes in brackets, as in `smtp://[::1]:2525`.

Some characters in a username or password have to be percent-encoded, or the URL reads differently: `@` as `%40`, `:` as `%3A`, `/` as `%2F`, `?` as `%3F`, `#` as `%23`, and `%` as `%25`. Many providers use an email address as the username:

```bash
DOPGATE_SMTP_URL=smtps://user%40example.com:p%40ss%2Fword@smtp.example.com
```

Empty values count as unset. A bad value stops Dopgate at startup with a message that names the setting and leaves the URL out, since it can hold the password. That covers a URL that doesn't start with `smtp://` or `smtps://`, one without a host, one with a path, an option other than `security=none`, an invalid from address, and a username or sender name with a line break.

### Coming from 0.1.0

Dopgate 0.1.0 read the server from `DOPGATE_SMTP_HOST`, `DOPGATE_SMTP_PORT`, `DOPGATE_SMTP_SECURITY`, `DOPGATE_SMTP_USERNAME`, and `DOPGATE_SMTP_PASSWORD`, and from the same keys under `[smtp]` in the config file. The URL replaces all five. Dopgate ignores the old variables, so move the server into `DOPGATE_SMTP_URL` when you upgrade. Until you do, emails go to the log or through the server saved in the console. An old key in the file is an unknown key, which stops startup.

Dopgate checks the server's certificate against the trusted roots of the image and waits up to 15 seconds for each SMTP command.

## Check it with a test email

From the console, open **Settings** and use **Send test email** in the SMTP section. From the API:

```bash
curl -X POST https://auth.example.com/api/v1/admin/settings/smtp/test \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"to":"you@dopgate.com"}'
```

Without `to`, the message goes to the test email address, which is root's email until you save another. Set it in the console under **Send test emails to**, or with the API:

```bash
curl -X PATCH https://auth.example.com/api/v1/admin/settings \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"testEmail":{"recipient":"qa@example.com"}}'
```

Template tests go to the same address. Save `null` or an empty string to send them to root again. `GET /api/v1/admin/settings` shows the saved address in `testEmail.recipient` and root's in `testEmail.rootEmail`.

| Answer | Meaning |
| --- | --- |
| `200 SMTP_TEST_SENT` | The SMTP server accepted the message. |
| `400 SMTP_NOT_CONFIGURED` | No host is set, in the server config or the console. |
| `400 SMTP_PASSWORD_UNREADABLE` | The password saved in the console can't be decrypted because the service key changed. Enter it again. |
| `422 EMAIL_INVALID` | `to` is not a valid address. |
| `502 SMTP_SEND_FAILED` | The server refused the message or couldn't be reached. The message holds the server's answer. |

`GET /api/v1/admin/settings` returns the settings in use under `smtp`, without the password: `host`, `port`, `security`, `username`, `passwordSet`, `fromEmail`, `fromName`, `source`, and `canStorePassword`. `source` is `server_config` when the server config sets a host, `database` when the console does, and `log` when neither does. `canStorePassword` is `false` until `DOPGATE_SERVICE_KEY` is set.

## Without SMTP

With no host in the server config or the console, Dopgate writes each email's recipient, subject, and plain text to its log at the `info` level instead of sending it. That covers local development: the 6-digit code is right there in the terminal or in `docker compose logs dopgate`. Don't run a public instance this way, since anyone who can read the logs can read the codes.

## Failures don't block requests

Dopgate sends emails in the background. A sign-up, a code request, or a password reset answers right away, and a failed send is written to the log with the template name and recipient. Watch the log after changing SMTP settings, or use the test email above.
