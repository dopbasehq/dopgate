---
title: "Glossary"
description: "Terms used in the Dopgate documentation."
---

# Glossary

| Term | Meaning |
| --- | --- |
| Access token | A signed JWT that proves who the user is. Lives 15 minutes by default. |
| Admin | A role for people who run the app. Manages members, settings, and templates. |
| Admin console | The web interface built into Dopgate, served at `/` for root and admins. |
| Audit chain | The hash chain over audit records that shows edits and deletions. |
| Code | A 6-digit number sent by email to verify an address, sign in, reset a password, or change an email. Lives 10 minutes by default. |
| Cookie mode | How the console keeps its refresh token: in the HttpOnly `dopgate_refresh` cookie, asked for with `X-Dopgate-Session: cookie`. |
| Issuer | The `iss` claim of every access token: `DOPGATE_PUBLIC_URL` without a trailing slash. |
| JWKS | JSON Web Key Set. The public keys at `/.well-known/jwks.json` that verify access tokens. |
| Lockout | The pause on password sign-in after too many wrong passwords in a row. |
| Member | The role of an end user of your app. |
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
