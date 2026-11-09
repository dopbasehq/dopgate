---
title: "Security checklist"
description: "What to check before a Dopgate deployment goes live: HTTPS, the service key, the database role, trusted proxies, CORS, SMTP, and the root account."
---

# Security checklist

Go through this list before real users sign in.

## The public URL uses HTTPS

Set `DOPGATE_PUBLIC_URL` to an `https://` URL and terminate TLS at your proxy. Passwords, codes, and tokens travel in request bodies and headers, and the console's refresh cookie is only marked `Secure` when the public URL is HTTPS. Dopgate prints a warning at startup when the public URL uses `http://` on anything but localhost.

The public URL is also the `iss` claim. Settle it before you go live: changing it later means updating the issuer check in every backend, and tokens issued before the change carry the old value.

## The service key is long and private

`DOPGATE_SERVICE_KEY` must be at least 32 characters; generate it with `openssl rand -base64 32`. It acts as an admin, so keep it in your backend's secret store and never in frontend code, a mobile app, or a repository. Leave it unset if no backend needs the admin API.

## The `dopgate` schema is guarded

The `signing_keys` table holds the private key that signs access tokens. Anyone who reads it can sign a valid token for any user, root included.

- Give Dopgate its own database role and keep your app's role out of the schema. See [PostgreSQL and the schema](/self-hosting/postgres#give-dopgate-its-own-role).
- Don't let your app, analytics tools, or support staff connect as a superuser.
- Treat database dumps as secrets. See [Backups](/self-hosting/backups).
- If you suspect the key leaked, rotate it as root and end every session. The old key keeps verifying for 24 hours after rotation, so tokens signed with it stay valid that long.

## Trusted proxies match your setup

Behind a proxy, set `DOPGATE_TRUSTED_PROXIES` to the proxy's address or network. Without it, every request seems to come from the proxy and all users share one rate limit. Don't list networks that clients can connect from directly, or they could choose the address Dopgate records by sending `X-Forwarded-For`. Don't publish Dopgate's port directly once a proxy is in front.

## CORS lists only your frontends

`DOPGATE_ALLOWED_ORIGINS` should hold your production frontends only. Remove `http://localhost:3000` and other development origins from the production environment.

## SMTP is set

Without `DOPGATE_SMTP_HOST`, Dopgate writes emails, codes included, to the log. On a public instance, anyone who can read the logs could take over accounts. Set SMTP and send a test email from the console.

## The root account is yours alone

- Change the generated root password after the first sign-in, and remove `DOPGATE_ROOT_EMAIL` and `DOPGATE_ROOT_PASSWORD` from the environment once root exists.
- Use admin accounts for day-to-day work and keep root for rotating keys and managing admins.
- If you run without `DOPGATE_ROOT_EMAIL`, finish `/setup` right after the first start. Until root exists, anyone with the setup token from the log can claim the instance.

## Sign-up rules fit your app

Check the settings: whether anyone may sign up, whether a verified email is required (on by default), and whether a code sign-in may create accounts (off by default). Raise the minimum password length if your app needs it.

## Optional extras

- Turn off the Swagger UI with `DOPGATE_DOCS=false` if you don't want the API description public.
- Turn off the console with `DOPGATE_WEB_UI=false` if nobody uses it, and manage users through the admin API.
- Shorten `accessTokenMinutes` if the [offline verification gap](/guide/tokens-and-sessions#the-offline-verification-gap) matters for your app.
- Keep server logs outside the database, so the audit checkpoints they hold can later prove the audit log wasn't rewritten.
