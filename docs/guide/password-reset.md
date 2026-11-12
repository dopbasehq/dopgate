---
title: "Password reset"
description: "Reset a forgotten password with a 6-digit emailed code, change a password while signed in, and send a reset code as an admin."
---

# Password reset

A user who forgot their password asks for a code, then sends the code with a new password. Both steps are public endpoints your frontend calls.

## 1. Ask for a code

```bash
curl -X POST https://auth.example.com/api/v1/auth/password/forgot \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com"}'
```

The answer is always `200 PASSWORD_RESET_SENT`, so the endpoint can't be used to find accounts. A code goes out with the `password_reset` [template](/guide/email-templates) only when the email belongs to an active account. Disabled accounts get nothing.

The usual code limits apply. By default that is one reset code per email every 60 seconds, 5 codes per email per hour, and the per-address limit. See [Rate limits and lockout](/guide/rate-limits).

## 2. Set the new password

```bash
curl -X POST https://auth.example.com/api/v1/auth/password/reset \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","code":"482913","newPassword":"a-new-long-password"}'
```

On success the answer is `200 PASSWORD_RESET` with no data, and Dopgate:

- sets the new password,
- ends every session of the account, so devices someone else signed in on are signed out,
- clears any [lockout](/guide/rate-limits#account-lockout),
- marks the email verified, since the user just proved they read that inbox,
- emails a `password_changed` notice.

The reset does not sign the user in. Send them to your sign-in screen.

| Answer | When |
| --- | --- |
| `400 CODE_INVALID` | The code is wrong, used up after 5 wrong tries, or there is no code for this email. |
| `400 CODE_EXPIRED` | The code is older than 10 minutes, or the lifetime set under `limits` in settings. |
| `403 ACCOUNT_DISABLED` | The account was disabled after the code went out. |
| `422 PASSWORD_INVALID` | The new password is too short or longer than 1024 bytes. |
| `429 RATE_LIMITED` | Too many requests from this address. |

## Changing a password while signed in

A signed-in user changes their password with the current one:

```bash
curl -X POST https://auth.example.com/api/v1/auth/password/change \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"currentPassword":"correct-horse-battery","newPassword":"a-new-long-password"}'
```

Every other session of the account ends, the session making the request stays signed in, and a `password_changed` notice goes to the account's email. A wrong current password answers `401 AUTHENTICATION_INVALID`. Accounts without a password, such as ones created by a code sign-in, leave out `currentPassword` to set their first one. The access token must come from a password or code sign-in. One from a [personal token](/guide/personal-tokens) gets `403 AUTHORIZATION_DENIED`.

## Sending a reset code as an admin

Admins and the service key can email a user a reset code from the console or with:

```bash
curl -X POST https://auth.example.com/api/v1/admin/users/usr_01JC8.../password-reset \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY"
```

The user then finishes with step 2. The audit log records `user.password_reset_sent`.

This endpoint only reaches users. An admin who forgot their password signs in to the console with an emailed code, or resets it with `POST /api/v1/console/password/forgot` and `POST /api/v1/console/password/reset`, which take the same bodies as steps 1 and 2.
