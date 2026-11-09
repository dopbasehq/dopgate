---
title: "Profile and metadata"
description: "The profile fields every account has, the three metadata objects and who can read and write each, and how users change their email."
---

# Profile and metadata

Every account has a small profile and three JSON objects for your own data.

| Field | Who writes it | Who reads it |
| --- | --- | --- |
| `displayName` | The user, admins | The user, admins |
| `avatarUrl` | The user, admins | The user, admins |
| `userMetadata` | The user | The user, admins |
| `publicMetadata` | Admins, your backend | The user, admins |
| `privateMetadata` | Admins, your backend | Admins and your backend only |

"Your backend" means calls made with the [service key](/guide/admin-api).

## Which metadata to use

Use `userMetadata` for things the user is allowed to change, such as a theme or a language. Anything the user sends through `PATCH /api/v1/auth/me` lands here, so never trust it for decisions.

Use `publicMetadata` for facts your app decides and the user may see, such as `{"plan": "pro"}`. The user reads it in their own account but can't change it.

Use `privateMetadata` for facts the user should never see, such as a billing customer ID or an internal note. It only appears in admin API responses.

None of the three are in the access token. Your backend reads them with `GET /api/v1/admin/users/{id}`, or your frontend reads `userMetadata` and `publicMetadata` from `GET /api/v1/auth/me`.

Each object must be a JSON object, at most 16 KB when serialized. A wrong type or a larger object answers `422 METADATA_INVALID`. An update replaces the whole object, so read it, change it, and write all of it back.

## The user's own profile

```bash
curl https://auth.example.com/api/v1/auth/me \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

```bash
curl -X PATCH https://auth.example.com/api/v1/auth/me \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"displayName":"Ana Silva","avatarUrl":"https://cdn.example.com/ana.png","userMetadata":{"theme":"dark"}}'
```

Fields you leave out stay as they are. An empty string clears `displayName` or `avatarUrl`. The display name is one line of at most 255 characters. The avatar URL must start with `https://` or `http://` and be at most 2048 characters. Other values answer `422 PROFILE_INVALID`.

## Setting metadata from your backend

```bash
curl -X PATCH https://auth.example.com/api/v1/admin/users/usr_01JC8... \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY" \
  -H 'content-type: application/json' \
  -d '{"publicMetadata":{"plan":"pro"},"privateMetadata":{"stripeCustomerId":"cus_123"}}'
```

The admin update accepts `displayName`, `avatarUrl`, `emailVerified`, `role` (root only), `publicMetadata`, and `privateMetadata`. It does not change `userMetadata`.

## Changing the email

A signed-in user moves their account to a new email in two steps. First they ask for a code at the new address, with their current password:

```bash
curl -X POST https://auth.example.com/api/v1/auth/email/change \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"newEmail":"ana.silva@example.com","password":"correct-horse-battery"}'
```

The password is required when the account has one, so a stolen access token alone can't move the account. The code goes to the new address with the `email_change` template. Then they confirm it, with the new address as `email`:

```bash
curl -X POST https://auth.example.com/api/v1/auth/verification/confirm \
  -H 'content-type: application/json' \
  -d '{"email":"ana.silva@example.com","purpose":"email_change","code":"482913"}'
```

The answer is `200 EMAIL_CHANGED` with the updated user. The new email counts as verified, and an `email_changed` notice goes to the old address. Sessions stay signed in. Access tokens issued before the change still carry the old `email` claim until they are refreshed, so key your data on `sub`.

| Answer | When |
| --- | --- |
| `401 AUTHENTICATION_INVALID` | The password is wrong. |
| `409 EMAIL_TAKEN` | Another account uses the new email. |
| `422 EMAIL_INVALID` | The new email is not valid, or it is already this account's email. |
| `429 RATE_LIMITED` | Too many codes for the new address. |

Admins can't change a user's email through the API.
