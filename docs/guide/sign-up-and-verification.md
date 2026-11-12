---
title: "Sign-up and email verification"
description: "How sign-up works, how the 6-digit verification code is sent and confirmed, and how the sign-up settings change the flow."
---

# Sign-up and email verification

A user signs up with an email and a password. Dopgate creates the account and emails a 6-digit code that proves they own the address. Three settings decide what happens next. Admins change them on the console's **Settings** page or with `PATCH /api/v1/admin/settings`.

| Setting (`signup.*`) | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Anyone can sign up. When off, sign-up answers `403 SIGNUP_DISABLED` and only admins create accounts. |
| `requireEmailVerification` | `true` | Sign-in is refused until the email is confirmed. |
| `passwordlessSignup` | `false` | A sign-in code sent to an unknown email creates an account. See [Sign-in with a password or a code](/guide/sign-in#signing-up-with-a-code). |

## Sign up

```bash
curl -X POST https://auth.example.com/api/v1/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","password":"correct-horse-battery","displayName":"Ana"}'
```

The answer is `201` with:

```json
{
  "success": true,
  "message": "SIGNED_UP",
  "data": {
    "user": { "id": "usr_01JC8...", "email": "ana@example.com", "emailVerified": false, "...": "..." },
    "verificationRequired": true,
    "verificationSent": true,
    "tokens": null
  }
}
```

The password must have at least 8 characters, or the minimum length in settings if an admin raised it, and at most 1024 bytes. `displayName` is optional, one line, up to 255 characters.

When `requireEmailVerification` is on, `tokens` is `null`. Show a code field and confirm the code to sign the user in. When it is off, `tokens` holds an access token and a refresh token straight away. The code still works later: confirming it marks the email verified and returns a new set of tokens.

## Confirm the code

The code goes out with the `verify_email` [template](/guide/email-templates). It is valid for 10 minutes and allows 5 wrong tries by default.

```bash
curl -X POST https://auth.example.com/api/v1/auth/verification/confirm \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","purpose":"email_verify","code":"482913"}'
```

Dopgate ignores spaces and dashes in the code, so `482 913` works too. On success it marks the email verified, starts a session, and answers with tokens, the same shape as [sign-in](/guide/sign-in). Wrong codes answer `400 CODE_INVALID` with the number of tries left. An expired code answers `400 CODE_EXPIRED`. After the last wrong try the code is used up and the user has to ask for a new one.

## Send a new code

```bash
curl -X POST https://auth.example.com/api/v1/auth/verification/send \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","purpose":"email_verify"}'
```

The answer is always `200 CODE_SENT`, whether or not the email has an account, so the endpoint can't be used to find accounts. A code only goes out when the account exists, is active, and is not verified yet. A new code replaces the earlier one.

By default the same email can get one code per purpose every 60 seconds and 5 codes per hour across all purposes. Admins change these numbers, and the code's lifetime and tries, under `limits` in settings. Past that, the answer is `429 RATE_LIMITED` with a `Retry-After` header. [Rate limits and lockout](/guide/rate-limits) has the details.

## Signing in before verification

With `requireEmailVerification` on, a sign-in with the right password for an unverified account answers `403 EMAIL_NOT_VERIFIED`. Send a new `email_verify` code and confirm it. Users who sign in with an emailed code are verified by that sign-in, because the code proves they read the inbox. A [password reset](/guide/password-reset) also marks the email verified.

## Verifying accounts as an admin

Admins can mark an email verified without a code, either when creating the account (`"emailVerified": true`) or later with `PATCH /api/v1/admin/users/{id}` and `{"emailVerified": true}`. Setting it to `false` marks the email unverified again.

## In the token

Access tokens carry `email_verified`. If your backend should refuse unverified users even when sign-in allows them, check that claim. See [Token claims](/reference/token-claims).
