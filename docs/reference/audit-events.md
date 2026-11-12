---
title: "Audit events"
description: "Every action Dopgate records in its audit log, the fields of a record, how to read and filter the log, retention, and verifying the hash chain."
---

# Audit events

Dopgate records sign-ins, account changes, and admin actions in the `audit_events` table. Each record is written in the same transaction as the change it describes, so a change and its record commit together. Root and admins read the log on the console's **Audit log** page or through the API.

## A record

```json
{
  "id": "aud_01JC8Z3V7QK2N4R6T8W0Y2A4C6",
  "actorType": "user",
  "actorId": "usr_01JC8Z3V7QK2N4R6T8W0Y2A4C7",
  "actorLabel": "ana@example.com",
  "action": "user.signed_in",
  "resourceType": "user",
  "resourceId": "usr_01JC8Z3V7QK2N4R6T8W0Y2A4C7",
  "ipAddress": "203.0.113.7",
  "metadata": { "method": "password", "sessionId": "ses_01JC8Z3V7QK2N4R6T8W0Y2A4C8" },
  "createdAt": "2026-11-09T08:15:42.123456Z",
  "seq": 1284,
  "prevHash": "9f2c...",
  "recordHash": "4b7a..."
}
```

| Field | Meaning |
| --- | --- |
| `actorType` | `root` or `admin` for an admin; `user` for a user of your app; `service` for the service key; `anonymous`; or `system` for setup, retention, and the CLI |
| `actorId`, `actorLabel` | The admin or user ID and email, `service` for the service key, or a label such as `setup`, `cli`, `retention`, or `refresh` |
| `resourceType`, `resourceId` | What the action touched: `admin`, `user`, `session`, `agent`, `personal_token`, `settings`, `email_template`, `signing_key`, or `audit` |
| `ipAddress` | The client address, through any [trusted proxies](/self-hosting/configuration#behind-a-reverse-proxy). Absent outside a request. |
| `metadata` | Extra details per action, listed below. Never holds passwords, codes, or tokens. |
| `seq`, `prevHash`, `recordHash` | The record's place in the hash chain |

## Actions

### Accounts

| Action | Actor | Metadata |
| --- | --- | --- |
| `user.signed_up` | The new user | `method`: `password` or `otp` |
| `user.signed_in` | The user | `method`, `sessionId` |
| `user.sign_in_failed` | The user whose email was given | `reason`: `password` or `locked`; `locked`: whether this attempt locked the account |
| `user.signed_out` | The user | `allSessions`, `sessionId` |
| `user.email_verified` | The user | none |
| `user.profile_updated` | The user | none |
| `user.password_changed` | The user | `otherSessionsEnded` |
| `user.password_reset` | The user | `sessionsEnded` |
| `user.email_changed` | The user | `from`, `to` |

Admins signing in to the console leave the same events with an `admin.` prefix, such as `admin.signed_in`, `admin.sign_in_failed`, `admin.signed_out`, `admin.password_changed`, `admin.password_reset`, `admin.email_changed`, and `admin.profile_updated`. The actor type is the admin's role.

A failed sign-in for an email with no account isn't recorded, because there is no account to attach it to.

### Personal tokens

| Action | Actor | Metadata |
| --- | --- | --- |
| `personal_token.created` | The user | `name`, `expiresAt`; the token is the resource |
| `personal_token.deleted` | The user, or the admin who revoked it | `name`, and `userId` when an admin revoked it |
| `token.rejected` | `anonymous`, label `token` | `kind` (`personal` or `unknown`) and `lastFour`. A token traded at `/auth/token` matched nothing. |

### Agents

| Action | Actor | Metadata |
| --- | --- | --- |
| `agent.created` | The owner, an admin or a user | `name`; the agent is the resource |
| `agent.updated` | The owner | `fields` that changed |
| `agent.token_regenerated` | The owner | `name` |
| `agent.disabled`, `agent.enabled` | The owner or an admin | `name`, `ownerId` |
| `agent.deleted` | The owner or an admin | `name`, `ownerId` |
| `agent.token_rejected` | `anonymous`, label `token` | `kind` (`agent`) and `lastFour`. A `dga_` token matched no agent. |

Successful trades of personal and agent tokens aren't recorded; they update `lastUsedAt`, at most once a minute.

### Sessions

| Action | Actor | Metadata |
| --- | --- | --- |
| `session.revoked` | The user or admin, ending one of their sessions | none; the session is the resource |
| `session.revoked_all` | The user or admin, signing out everywhere | `sessions`, `keptCurrent` |
| `session.refresh_reused` | `anonymous`, label `refresh` | `accountId`; the session is the resource. A spent refresh token came back and the session was ended. |

### Admin actions

| Action | Actor | Metadata |
| --- | --- | --- |
| `user.created` | Admin, root, or service | `email` |
| `user.updated` | Admin, root, or service | `fields` that changed |
| `user.deleted` | Admin, root, or service | `email` |
| `user.disabled` | Admin, root, or service | `sessionsEnded` |
| `user.enabled` | Admin, root, or service | `sessionsEnded` (always 0) |
| `user.sessions_revoked` | Admin, root, or service | `sessionsEnded` |
| `user.password_reset_sent` | Admin, root, or service | none |
| `admin.created` | Root | `email` |
| `admin.updated` | Root | `fields` that changed |
| `admin.disabled` | Root | `sessionsEnded` |
| `admin.enabled` | Root | `sessionsEnded` (always 0) |
| `admin.deleted` | Root | `email` |
| `settings.updated` | Admin, root, or service | `sections` that changed, such as `["signup", "limits"]` |
| `email_template.updated` | Admin, root, or service | none; the template name is the resource |
| `email_template.reset` | Admin, root, or service | none; only recorded when an override existed |
| `key.rotated` | Root, or `system` with label `cli` | none; the new key is the resource |

### Instance

| Action | Actor | Metadata |
| --- | --- | --- |
| `instance.initialized` | `system`, label `setup` | `email` of the new root account |
| `audit.pruned` | `system`, label `retention` | `records`, `legacyRecords`, `fromSeq`, `throughSeq`, `throughHash` |

## Reading the log

```bash
curl "https://auth.example.com/api/v1/admin/audit-events?action=user.signed_in&limit=100" \
  -H "authorization: Bearer $TOKEN"
```

Records come newest first, 50 per page by default and at most 200. Filter with `action` (an exact action name) and `actor` (an admin or user ID, or an actor label such as an email or `service`). Pass `nextCursor` back as `cursor` for the next page.

## Retention

Records older than `DOPGATE_AUDIT_RETENTION_DAYS` (365 by default) are deleted at startup and once a day while the server runs. `0` keeps everything. Each pass that removes records appends an `audit.pruned` record that names the last removed position and its hash, so the remaining records still verify as one chain.

## Verifying the chain

Every record stores its position (`seq`), the hash of the record before it, and a SHA-256 hash of its own stored contents. Changing, inserting, or deleting a record in the middle breaks the chain.

```bash
curl https://auth.example.com/api/v1/admin/audit-events/verify \
  -H "authorization: Bearer $TOKEN"
```

```json
{
  "ok": true,
  "records": 1284,
  "headSeq": 1284,
  "headHash": "4b7a...",
  "legacy": 0,
  "unsequenced": 0,
  "prunedSeq": null,
  "broken": null,
  "anchor": null
}
```

`broken` names the first record that doesn't match, with its `seq`, `id`, and a `reason`. `unsequenced` counts records with no chain position, which only appear if something wrote to the table directly; it should stay 0.

The chain alone can't tell a log rewritten from start to end, or one with its newest records removed, from an honest one. For that, save `headSeq` and `headHash` somewhere outside the database, then pass them back later:

```bash
curl "https://auth.example.com/api/v1/admin/audit-events/verify?anchorSeq=1284&anchorHash=4b7a..." \
  -H "authorization: Bearer $TOKEN"
```

`anchor.status` is `matched` when the record at that position still has that hash, `mismatch` when it changed, `missing` when the record is gone, and `pruned` when retention removed it. `mismatch` and `missing` make `ok` false.

Dopgate also writes the chain head to its log as an `audit checkpoint` at startup, at shutdown, and on every verification. Logs shipped somewhere else are a ready source of anchors.
