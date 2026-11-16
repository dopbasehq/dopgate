---
title: "Profile and metadata"
description: "The profile fields every account has, the three metadata objects and who can read and write each, which one travels in the access token, and how users change their email."
---

# Profile and metadata

Every account has a small profile and three JSON objects for your own data.

| Field | Who writes it | Who reads it |
| --- | --- | --- |
| `displayName` | The user, admins | The user, admins |
| `avatarUrl` | The user, admins | The user, admins |
| `userMetadata` | The user | The user, admins |
| `publicMetadata` | Admins, your backend | The user, admins, and anyone who holds the user's access token |
| `privateMetadata` | Admins, your backend | Admins and your backend only |

"Your backend" means calls made with the [service key](/guide/admin-api).

## Which metadata to use

Use `userMetadata` for things the user is allowed to change, such as a theme or a language. Anything the user sends through `PATCH /api/v1/auth/me` lands here, so never trust it for decisions.

Use `publicMetadata` for facts your app decides and the user may see, such as `{"role": "manager"}` or `{"plan": "pro"}`. The user reads it in their own account but can't change it. It also travels in the user's access token, so your backend can read it without calling Dopgate.

Use `privateMetadata` for facts the user should never see, such as a billing customer ID or an internal note. It only appears in admin API responses.

`userMetadata` and `privateMetadata` are never in the access token. Your backend reads them with `GET /api/v1/admin/users/{id}`, and your frontend reads `userMetadata` and `publicMetadata` from `GET /api/v1/auth/me`.

Each must be a JSON object. `publicMetadata` holds at most 1 KB when serialized, because it is sent with every request. The other two hold at most 16 KB. A wrong type or a larger object answers `422 METADATA_INVALID`. An update replaces the whole object, so read it, change it, and write all of it back.

## Reading publicMetadata from the token

A person's access token carries their `publicMetadata` in the `public_metadata` claim. When the object is empty, the claim is left out.

```js
const { payload } = await jwtVerify(token, jwks, { issuer, algorithms: ["ES256"] });
if (payload.kind !== "human") throw new Error("Not a person's token");
const role = payload.public_metadata?.role ?? "customer";
```

Three things to know before you rely on it:

- The claim is a copy made when the token was issued. A change reaches the token on the next refresh, 15 minutes later at most with the default `accessTokenMinutes`. To take something away at once, also sign the user out with `DELETE /api/v1/admin/users/{id}/sessions`.
- A token issued before you set the value doesn't have it. After a sign-up, set the metadata and have your app call `POST /api/v1/auth/refresh` once, or create the user through the admin API with `publicMetadata` already filled in.
- Anyone who holds the token can decode it. Keep secrets in `privateMetadata`.

Tokens traded from a [personal token](/guide/personal-tokens) carry the claim too. An [agent's](/guide/agents) token never does.

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

An access token from a [personal token](/guide/personal-tokens) can read and update the profile too. Changing the email or the password needs a token from a password or code sign-in.

## Setting metadata from your backend

```bash
curl -X PATCH https://auth.example.com/api/v1/admin/users/usr_01JC8... \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY" \
  -H 'content-type: application/json' \
  -d '{"publicMetadata":{"plan":"pro"},"privateMetadata":{"stripeCustomerId":"cus_123"}}'
```

The admin update accepts `displayName`, `avatarUrl`, `emailVerified`, `publicMetadata`, and `privateMetadata`. It does not change `userMetadata`.

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
