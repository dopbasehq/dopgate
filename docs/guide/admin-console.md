---
title: "Admin console"
description: "The admin console built into Dopgate: who can use it, what each page does, how it keeps you signed in, and how to turn it off."
---

# Admin console

The Dopgate binary has an admin console built in. It is served at the root of the public URL, such as `https://auth.example.com/`, next to the API. Root and admins sign in to it. Your app's users can't: the console only knows admin accounts, and a user's email and password get the same answer as a wrong password. See [Admins and users](/guide/admins-and-users).

## First visit

While the database has no root account, every page sends you to `/setup`. Paste the one-time setup token that the server printed at startup, then choose the root email and password. If you set `DOPGATE_ROOT_EMAIL`, root already exists and you go straight to the sign-in page; use the generated password from the log, as in the [quick start](/guide/quick-start#_3-copy-the-root-password).

The sign-in page accepts a password or an emailed code.

## Pages

| Page | Path | What you do there |
| --- | --- | --- |
| Users | `/users` | Search your app's users by email or name, filter by status, and create users. |
| User | `/users/{id}` | Edit the profile and the three metadata objects, see and end sessions, disable, enable, or delete the account, and send a password reset code. |
| Admins | `/admins` | See root and every admin. Root adds admins and turns them off, back on, or removes them. |
| Email templates | `/templates` | See the six emails and which ones are customized. |
| Template | `/templates/{name}` | Edit the subject, HTML, and text, insert variables, preview the result, send yourself a test, or reset to the built-in version. |
| Settings | `/settings` | Sign-up rules, the minimum password length, token lifetimes, limits, and branding. The SMTP section is editable unless `DOPGATE_SMTP_HOST` is set, and has a button that sends a test email. |
| Signing keys | `/keys` | See the active, retiring, and retired keys. Root can rotate the key here. |
| Audit log | `/audit` | Page through every recorded event, filter by action or actor, and verify the hash chain. |
| Account | `/account` | Your own profile, password, email, and signed-in sessions. |

The console only shows what your role allows. Every admin manages every user. Only root sees the actions on the Admins page and the rotate button, and nobody can change root from the console.

## How it keeps you signed in

The console signs in through `/api/v1/console` and uses cookie sessions. It sends `X-Dopgate-Session: cookie` when it signs in and refreshes, and Dopgate keeps the refresh token in an HttpOnly cookie named `dopgate_console`, limited to the `/api/v1/console` path with `SameSite=Strict`. The cookie is marked `Secure` when the public URL starts with `https://`. The access token lives only in the page's memory and is refreshed when the page loads.

Because of the cookie, the console has to run on Dopgate's own origin. Serve Dopgate on its own host name, such as `auth.example.com`, rather than under a path of another site.

## Turning it off

Set `DOPGATE_WEB_UI=false`, or start with `dopgate serve --web-ui false`. The API keeps working, and every non-API path answers `404`. The Swagger UI at `/api/docs` is controlled separately by `DOPGATE_DOCS`.

## Running the console from source

During development the console runs on Vite at `http://localhost:5174` and proxies `/api` and `/.well-known` to the API on port 8850. See the repository README for `bun run dev`.
