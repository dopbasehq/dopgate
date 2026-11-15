---
title: "Calling the admin API from your backend"
description: "Use DOPGATE_SERVICE_KEY to manage users, metadata, and sessions from your app's backend, and what the service key can't do."
---

# Calling the admin API from your backend

Your backend calls the admin API (`/api/v1/admin/*`) with a service key. Typical uses are setting a user's plan in `publicMetadata` after a payment, disabling an account, or looking up a user by email with `?email=`, which matches one whole address. `?search=` matches part of one, so `ana@example.com` also finds `hana@example.com`.

## Set up the key

Generate a key and give it to Dopgate and to your backend, and nobody else:

```bash
openssl rand -base64 32
```

```bash
# .env for dopgate, and the same value in your backend's secrets
DOPGATE_SERVICE_KEY=<the output of the command above>
```

The key must be at least 32 characters, or Dopgate refuses to start. Leaving `DOPGATE_SERVICE_KEY` unset or empty turns service access off. Treat the key like a database password: it never goes to a browser or a mobile app.

Dopgate also uses the key to encrypt an SMTP password saved from the console. If you change or remove the key, enter that password again in **Settings**. See [Email (SMTP)](/self-hosting/smtp).

## Send it as a bearer token

```bash
curl https://auth.example.com/api/v1/admin/users?email=ana@example.com \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY"
```

Dopgate tells the two kinds of bearer token apart by shape: a JWT has three dot-separated parts, and anything else is compared with the service key in constant time. A wrong key answers `401 AUTHENTICATION_INVALID`.

A Node example that records a plan after a checkout:

```js
const dopgate = "https://auth.example.com/api/v1";

export async function setPlan(userId, plan) {
  const res = await fetch(`${dopgate}/admin/users/${userId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${process.env.DOPGATE_SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ publicMetadata: { plan } }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.error));
  return json.data; // the user, with privateMetadata and lockedUntil
}
```

`publicMetadata` replaces the whole object, so merge with the current value first if it holds other keys.

## What the service key can do

The service key acts as an admin. It can:

- list, read, create, update, disable, enable, and delete users,
- end a user's sessions and send them a password reset code,
- list and read admins,
- read and change settings, and send an SMTP test to an address you give in `to`,
- read, change, preview, and reset email templates,
- list and read agents, and list a user's personal tokens,
- list signing keys and read and verify the audit log.

It can't:

- add, change, disable, or remove admins, which only root can do (`403 AUTHORIZATION_DENIED`),
- rotate signing keys, which only root can do,
- make, change, turn off, or delete agents, or revoke a user's personal token, which need an admin signed in to the console (`403 AUTHORIZATION_DENIED`),
- call endpoints for a signed-in user or admin, such as `/api/v1/auth/me` or `/api/v1/console/me` (`403 AUTHORIZATION_DENIED`),
- send a template test email, because it has no inbox (`400 EMAIL_INVALID`). Preview the template instead.

Audit records written by the service key have the actor type `service` and the label `service`, so you can tell them apart from changes made in the console.

## Passing on the visitor

If your backend calls sign-in, sign-up, refresh, and the other `/api/v1/auth` endpoints for the people using your app, Dopgate sees your backend's address and `User-Agent` on every call. All your users then share one [per-address limit](/guide/rate-limits#the-per-address-limit), and the device list shows your server instead of their browsers.

Add three headers to those calls:

| Header | Value |
| --- | --- |
| `X-Dopgate-Backend-Key` | The service key |
| `X-Dopgate-Client-IP` | The visitor's IP address, with or without a port |
| `X-Dopgate-Client-Agent` | The visitor's `User-Agent`, cut to 512 characters |

```bash
curl -X POST https://auth.example.com/api/v1/auth/login \
  -H "x-dopgate-backend-key: $DOPGATE_SERVICE_KEY" \
  -H 'x-dopgate-client-ip: 198.51.100.7' \
  -H 'x-dopgate-client-agent: Mozilla/5.0 (Macintosh) Firefox/140.0' \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","password":"correct horse battery"}'
```

With a valid key, the rate limits, the device list and the audit log record the visitor. The key only vouches for these headers: it doesn't sign the request in as the service, so the call still needs the user's access token where the endpoint asks for one.

Without `X-Dopgate-Backend-Key`, Dopgate ignores the other two headers, so a browser can't pick its own address. A wrong key, or any key on an instance with no `DOPGATE_SERVICE_KEY`, answers `401 AUTHENTICATION_INVALID`. An `X-Dopgate-Client-IP` that isn't an address answers `400 REQUEST_INVALID`. Leaving it out keeps your backend's own address.

## Endpoints you'll use most

| Call | What it does |
| --- | --- |
| `GET /api/v1/admin/users?email=` | Find the one user with this email |
| `GET /api/v1/admin/users?search=` | Find users by part of an email or display name |
| `GET /api/v1/admin/users/{id}` | Read one user, including `privateMetadata` |
| `POST /api/v1/admin/users` | Create a user without sending email |
| `PATCH /api/v1/admin/users/{id}` | Change the profile, metadata, or `emailVerified` |
| `POST /api/v1/admin/users/{id}/disable` | Refuse sign-in and end every session |
| `DELETE /api/v1/admin/users/{id}/sessions` | Sign the user out everywhere |
| `DELETE /api/v1/admin/users/{id}` | Delete the account |

The [REST API reference](/reference/api#users) has every field and answer.
