---
title: "Admins and users"
description: "The two kinds of account in Dopgate: admins who run it from the console, and the users who sign in to your app. Who may manage whom, and how accounts are created, disabled, and deleted."
---

# Admins and users

Dopgate keeps two kinds of person, and they never mix. Each of them can also own [agents](/guide/agents), accounts for bots that sign in with a token.

| Kind | ID | Who it is for | Signs in at |
| --- | --- | --- | --- |
| Admin | `adm_` | People who run Dopgate: root and the admins root adds | The console, through `/api/v1/console` |
| User | `usr_` | The people who sign in to your app | Your app, through `/api/v1/auth` |
| Agent | `agt_` | Bots and AI agents, each owned by an admin or a user | Your app, by trading its token at `/api/v1/auth/token` |

Each kind lives in its own table, with its own sessions and emailed codes. An admin can't sign in to your app, and a user can't sign in to the console: credentials sent to the wrong side get the same `401` as a wrong password. The same email may belong to an admin and to a user. They are two separate accounts, with separate passwords.

## Admins

Admins have one of two roles.

| Role | What it may do |
| --- | --- |
| `root` | The instance owner. Exactly one exists. Everything admins can do, plus manage admins and rotate signing keys. |
| `admin` | Use the console and the admin API: manage users, settings, and email templates, and read keys and the audit log. |

Root is created at setup. See [the quick start](/guide/quick-start) and [`dopgate init`](/cli/commands#init). Root adds admins on the console's **Admins** page or with `POST /api/v1/admin/admins`:

```bash
curl -X POST https://auth.example.com/api/v1/admin/admins \
  -H "authorization: Bearer $ROOT_CONSOLE_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","displayName":"Ana"}'
```

No email is sent. Leave out `password` for an admin who signs in with emailed codes. Every admin can read the list of admins; only root adds, changes, disables, or removes them. Nobody changes root through the API: that answers `403 ROOT_PROTECTED`. Root changes its own profile, password, and email on the console's Account page.

Console tokens only work on Dopgate's own endpoints. They are signed with a secret that isn't in the JWKS, so a backend that verifies tokens against the key set can't accept an admin's token, even by mistake.

## Users

Users sign in to your app through `/api/v1/auth/*` and manage their own account there. Accounts come from three places:

- Sign-up through `POST /api/v1/auth/signup`, when sign-up is on.
- A first sign-in by emailed code for an unknown email, when **passwordless sign-up** is on. See [Sign-in with a password or a code](/guide/sign-in).
- `POST /api/v1/admin/users`, from the console or your backend. No email is sent. Leave out `password` for an account that signs in with codes only, and set `emailVerified: true` to skip verification.

```bash
curl -X POST https://auth.example.com/api/v1/admin/users \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY" \
  -H 'content-type: application/json' \
  -d '{"email":"sam@example.com","displayName":"Sam","emailVerified":true}'
```

User emails are stored lowercased and are unique among users. A second user with the same email answers `409 EMAIL_TAKEN`.

## Who can manage whom

| Actor | Users | Admins | Root |
| --- | --- | --- | --- |
| Root | Yes | Yes | No, root is protected from the API |
| Admin | Yes | Read only | Read only |
| Service key | Yes | Read only | Read only |

"Manage" covers updating, disabling, enabling, deleting, ending sessions, and sending a password reset code. Your backend can call the admin API with the [service key](/guide/admin-api). The service key acts as an admin. It has no account, so it can't call the endpoints for a signed-in user or admin, and it never acts as root.

## Account status

An account is `active` or `disabled`. Disabling a user (`POST /api/v1/admin/users/{id}/disable`) ends every session at once and refuses new sign-ins with `403 ACCOUNT_DISABLED`. Dopgate also refuses the user's access tokens right away, but a backend that verifies tokens offline accepts the last one until it expires. Enable the account again with `POST /api/v1/admin/users/{id}/enable`. Root disables and enables admins the same way under `/api/v1/admin/admins/{id}`.

## Deleting accounts

`DELETE /api/v1/admin/users/{id}` removes the user, their sessions, and their codes, and answers `204`. The audit log keeps a `user.deleted` event with the email. The same email can sign up again later as a new account with a new ID, so clean up your own rows keyed by the old `sub`. Root removes admins with `DELETE /api/v1/admin/admins/{id}`, which leaves an `admin.deleted` event.

## Listing and searching

`GET /api/v1/admin/users` returns users newest first, 50 per page by default and at most 200. Filter with `search` (matches the email or display name) and `status`, and pass `nextCursor` back as `cursor` for the next page.

```bash
curl "https://auth.example.com/api/v1/admin/users?search=ana&status=active&limit=20" \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY"
```

Admins see two fields users don't: `privateMetadata` and `lockedUntil`, which is set while the account is [locked out](/guide/rate-limits#account-lockout). `GET /api/v1/admin/admins` lists every admin, root first, without paging.
