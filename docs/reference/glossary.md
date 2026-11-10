---
title: "Glossary"
description: "Terms used in the Dopgate documentation."
---

# Glossary

| Term | Meaning |
| --- | --- |
| Access token | A signed JWT that proves who the user is. Lives 15 minutes by default. |
| Admin | An account for someone who runs Dopgate, with an `adm_` ID and the role `root` or `admin`. Signs in to the console only and manages users, settings, and templates. |
| Admin console | The web interface built into Dopgate, served at `/` for root and admins. |
| Audit chain | The hash chain over audit records that shows edits and deletions. |
| Code | A 6-digit number sent by email to verify an address, sign in, reset a password, or change an email. Lives 10 minutes by default. |
| Console token | The access token an admin gets from `/api/v1/console`. Signed with HS256 and a secret that isn't in the JWKS, so only Dopgate can verify it. |
| Cookie mode | Keeping the refresh token in an HttpOnly cookie instead of the response body, asked for with `X-Dopgate-Session: cookie`: `dopgate_refresh` for `/api/v1/auth`, `dopgate_console` for the console. |
| Issuer | The `iss` claim of every access token: `DOPGATE_PUBLIC_URL` without a trailing slash. |
| JWKS | JSON Web Key Set. The public keys at `/.well-known/jwks.json` that verify access tokens. |
| Lockout | The pause on password sign-in after too many wrong passwords in a row. |
| User | An account for someone who signs in to your app, with a `usr_` ID. Separate from admins, even when the email is the same. |
| Metadata | Three JSON objects on each account: `userMetadata`, `publicMetadata`, and `privateMetadata`. |
| OTP | One-time password. Here, the 6-digit emailed code. Sessions started with one have the method `otp`. |
| Public URL | The URL your app and users reach Dopgate on, set with `DOPGATE_PUBLIC_URL`. |
| Refresh token | A single-use `dgr_` token that gets a new access token and a new refresh token. |
| Root | The instance owner. Exactly one exists, and the admin API can't change it. |
| Schema | The PostgreSQL schema that holds every Dopgate table, `dopgate` by default. |
| Service key | `DOPGATE_SERVICE_KEY`. Your backend sends it as a bearer token to use the admin API as an admin. |
| Session | One signed-in device. Ends on sign-out, after 30 idle days, or 90 days after sign-in, by default. |
| Setup token | A one-time `setup_` token printed at startup while no root account exists. |
| Signing key | The ES256 key pair that signs access tokens. `active`, `retiring` for 24 hours after a rotation, then `retired`. |
