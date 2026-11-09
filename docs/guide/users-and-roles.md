---
title: "Users and roles"
description: "The three roles in Dopgate, what root, admins, members, and the service key may do, and how accounts are created, disabled, and deleted."
---

# Users and roles

Everyone who signs in to Dopgate has one account, identified by an ID with the `usr_` prefix. Each account has one of three roles.

| Role | Who it is for | What it may do |
| --- | --- | --- |
| `root` | The instance owner. Exactly one exists. | Everything admins can do, plus manage admins, change roles, and rotate signing keys. |
| `admin` | People who run the app. | Use the admin API and the console: manage members, settings, email templates, and read keys and the audit log. |
| `member` | The end users of your app. | Sign in and manage their own account through `/api/v1/auth/*`. |

Your backend can also call the admin API with the [service key](/guide/admin-api). The service key acts as an admin. It has no account, so it can't call the endpoints for a signed-in user, and it never acts as root.

## Who can manage whom

| Actor | Members | Admins | Root |
| --- | --- | --- | --- |
| Root | Yes | Yes | No, root is protected from the API |
| Admin | Yes | No | No |
| Service key | Yes | No | No |

"Manage" covers updating, disabling, enabling, deleting, ending sessions, and sending a password reset code. Admins can still list and read every account, root included. Only root creates admins or changes an account's role.

Trying to change root through the admin API answers `403 ROOT_PROTECTED`. Root changes its own profile, password, and email through the same `/auth` endpoints any user has.

## Creating accounts

Accounts come from four places:

- Sign-up through `POST /api/v1/auth/signup`, when sign-up is on. New accounts are always members.
- A first sign-in by emailed code for an unknown email, when **passwordless sign-up** is on. See [Sign-in with a password or a code](/guide/sign-in).
- `POST /api/v1/admin/users`, from the console or your backend. No email is sent. Leave out `password` for an account that signs in with codes only, and set `emailVerified: true` to skip verification.
- The root account, created at setup. See [the quick start](/guide/quick-start) and [`dopgate init`](/cli/commands#init).

```bash
curl -X POST https://auth.example.com/api/v1/admin/users \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY" \
  -H 'content-type: application/json' \
  -d '{"email":"sam@example.com","displayName":"Sam","emailVerified":true}'
```

Emails are stored lowercased and must be unique. A second account with the same email answers `409 EMAIL_TAKEN`.

## Account status

An account is `active` or `disabled`. Disabling it (`POST /api/v1/admin/users/{id}/disable`) ends every session at once and refuses new sign-ins with `403 ACCOUNT_DISABLED`. Dopgate also refuses the account's access tokens right away, but a backend that verifies tokens offline accepts the last one until it expires. Enable the account again with `POST /api/v1/admin/users/{id}/enable`.

## Deleting accounts

`DELETE /api/v1/admin/users/{id}` removes the account, its sessions, and its codes, and answers `204`. The audit log keeps a `user.deleted` event with the email and role. The same email can sign up again later as a new account with a new ID, so clean up your own rows keyed by the old `sub`.

## Listing and searching

`GET /api/v1/admin/users` returns accounts newest first, 50 per page by default and at most 200. Filter with `search` (matches the email or display name), `role`, and `status`, and pass `nextCursor` back as `cursor` for the next page.

```bash
curl "https://auth.example.com/api/v1/admin/users?search=ana&role=member&limit=20" \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY"
```

Admins see two fields users don't: `privateMetadata` and `lockedUntil`, which is set while the account is [locked out](/guide/rate-limits#account-lockout).
