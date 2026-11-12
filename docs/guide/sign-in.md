---
title: "Sign-in with a password or a code"
description: "Sign users in with an email and password, or with a 6-digit code sent to their email, and create accounts on a first code sign-in."
---

# Sign-in with a password or a code

Dopgate signs users in two ways: an email and a password, or a 6-digit code sent to their email. Both end the same way, with a new session and a pair of tokens. `GET /api/v1/auth/methods` reports `password: true` and `emailOtp: true`; both are always on.

## With a password

```bash
curl -X POST https://auth.example.com/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","password":"correct-horse-battery"}'
```

A successful sign-in answers `200 SIGNED_IN`:

```json
{
  "success": true,
  "message": "SIGNED_IN",
  "data": {
    "accessToken": "eyJhbGciOiJFUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "refreshToken": "dgr_Jq3...",
    "user": { "id": "usr_01JC8...", "email": "ana@example.com", "...": "..." }
  }
}
```

| Answer | When |
| --- | --- |
| `401 AUTHENTICATION_INVALID` | The email has no account, the password is wrong, the account has no password, or the account is locked. |
| `403 ACCOUNT_DISABLED` | The password is right but an admin disabled the account. |
| `403 EMAIL_NOT_VERIFIED` | The password is right but the email is not confirmed and settings require it. |
| `429 RATE_LIMITED` | Too many requests from this address. |

A wrong email and a wrong password get the same answer and take about the same time, so the endpoint doesn't reveal which emails have accounts. Disabled and unverified accounts are only reported after the right password.

By default, 5 wrong passwords in a row lock the account for 15 minutes. Admins change both numbers under `limits` in settings. While it is locked, even the right password gets `401 AUTHENTICATION_INVALID`. See [Rate limits and lockout](/guide/rate-limits#account-lockout).

## With an emailed code

Ask for a code with the purpose `login`:

```bash
curl -X POST https://auth.example.com/api/v1/auth/verification/send \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","purpose":"login"}'
```

The answer is always `200 CODE_SENT`. The code goes out with the `login_code` [template](/guide/email-templates) when the email belongs to an active account. Then confirm it:

```bash
curl -X POST https://auth.example.com/api/v1/auth/verification/confirm \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","purpose":"login","code":"482913"}'
```

The answer has the same tokens as a password sign-in. A code sign-in also marks the email verified, and it works for accounts created without a password. A wrong code answers `400 CODE_INVALID`, an expired one `400 CODE_EXPIRED`, and a disabled account `403 ACCOUNT_DISABLED`. The session's `method` is `otp`, where a password sign-in records `password`.

The code limits from [sign-up](/guide/sign-up-and-verification#confirm-the-code) apply here too. By default that is 10 minutes, 5 wrong tries, one code per purpose every 60 seconds, and 5 codes per email per hour.

## Signing up with a code

When both `signup.enabled` and `signup.passwordlessSignup` are on, a `login` code also goes to emails that have no account yet. Confirming it creates a user with a verified email and no password, and signs the user in. The audit log records `user.signed_up` with `"method": "otp"`.

With `passwordlessSignup` off, no code is sent to unknown emails and confirming anything for them answers `400 CODE_INVALID`.

A user without a password can set one later through `POST /api/v1/auth/password/change`, leaving out `currentPassword`. The `hasPassword` field on the user tells you which accounts have one.

## Cookie sessions

A client on Dopgate's own origin can send `X-Dopgate-Session: cookie` with sign-in, code confirmation, and refresh. Dopgate then puts the refresh token in an HttpOnly cookie named `dopgate_refresh` (path `/api/v1/auth`, `SameSite=Strict`, `Secure` when the public URL is HTTPS) and returns `refreshToken: null` in the body. This mode only works on Dopgate's own origin, because CORS never allows credentials. Your app uses the default mode and keeps the refresh token from the response body.

Admins don't sign in here. The console signs them in at `/api/v1/console/login` and keeps its own cookie, `dopgate_console`. An admin's email and password sent to `/api/v1/auth/login` get the same `401` as a wrong password. See [Admins and users](/guide/admins-and-users).
