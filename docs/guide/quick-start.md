---
title: "Quick start"
description: "Run PostgreSQL and Dopgate with Docker Compose, sign in to the admin console, and create a first user."
---

# Quick start

This page runs Dopgate and PostgreSQL on your machine with Docker Compose, signs you in to the admin console as root, and makes a first API call. It takes a few minutes. You need Docker with the Compose plugin and a clone of the Dopgate repository.

## 1. Fill in the environment file

From the repository root:

```bash
cp .env.example .env
```

Open `.env` and change at least these values:

| Variable | What to put there |
| --- | --- |
| `POSTGRES_PASSWORD` | A password for the bundled PostgreSQL server. |
| `DOPGATE_PUBLIC_URL` | The URL your app reaches Dopgate on. Keep `http://localhost:8850` on your machine. |
| `DOPGATE_ROOT_EMAIL` | Your email. The first start creates the root account for it. |
| `DOPGATE_ALLOWED_ORIGINS` | Your frontend's origin, such as `http://localhost:3000`. |

Leave `DOPGATE_SMTP_HOST` empty for now. Without an SMTP server, Dopgate writes every email, codes included, to its log. [Environment variables](/reference/environment-variables) lists everything else you can set.

## 2. Start the stack

```bash
docker compose up -d
```

Compose builds the Dopgate image from the `Dockerfile` on the first run, starts PostgreSQL, waits until it is healthy, and then starts Dopgate. On startup Dopgate creates the `dopgate` schema, runs its migrations, and generates a signing key.

## 3. Copy the root password

Because `DOPGATE_ROOT_EMAIL` is set and the database has no root account yet, Dopgate creates root and prints a generated password once:

```bash
docker compose logs dopgate
```

```text
Root account created for admin@example.com.
Password: k7Hq-3xPm-Rt9a-WcZe-8nVb-Xf2u

This password is shown once. Sign in and change it, and clear DOPGATE_ROOT_EMAIL if you like; later starts ignore it.
```

Copy the password now. Later starts see that root exists and print nothing.

::: tip Lost the password?
Reset it with a code, like any user. Ask for one with `POST /api/v1/auth/password/forgot` and the root email, then send the code and a new password to `POST /api/v1/auth/password/reset`. Without SMTP, the code is in `docker compose logs dopgate`. [Password reset](/guide/password-reset) shows both calls.
:::

## 4. Sign in to the console

Open `http://localhost:8850` in a browser and sign in with the root email and the password from the log. Change the password on the **Account** page.

From the console you can create users, edit the email templates, and change sign-up rules. The [admin console](/guide/admin-console) page walks through each screen.

## 5. Try the API

Check that the server is healthy:

```bash
curl http://localhost:8850/api/v1/health
```

Sign up a user. Your frontend makes the same call:

```bash
curl -X POST http://localhost:8850/api/v1/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","password":"correct-horse-battery","displayName":"Ana"}'
```

Sign-up requires a verified email by default, so the answer has `"tokens": null` and Dopgate sends a code. With no SMTP server, the email shows up in `docker compose logs dopgate`. Confirm it:

```bash
curl -X POST http://localhost:8850/api/v1/auth/verification/confirm \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","purpose":"email_verify","code":"482913"}'
```

Use the code from the log in place of `482913`. The answer holds an `accessToken` and a `refreshToken`. The user now shows up on the console's **Users** page.

The running server also describes its own API in Swagger UI at `http://localhost:8850/api/docs`.

## Next steps

- [Add Dopgate to your app](/guide/add-to-your-app): the frontend calls and backend token checks.
- [Email (SMTP)](/self-hosting/smtp): send real email.
- [Running with your app's stack](/self-hosting/with-your-app): move the Dopgate service into your app's compose file.
