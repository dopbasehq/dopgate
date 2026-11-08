---
title: "Audit events"
description: "What the dopgate audit log records, the fields of a record, and how to verify the chain."
---

# Audit events

dopgate records security-relevant actions in an append-only, hash-chained log. Admins read it at `GET /api/v1/admin/audit-events` and check it at `GET /api/v1/admin/audit-events/verify`.

## A record

| Field | Meaning |
| --- | --- |
| `id` | `aud_` followed by a ULID |
| `actorType` | `root`, `admin`, `member`, `client`, or `system` |
| `actorId`, `actorLabel` | Who acted: a user or client ID, and a readable name |
| `action` | What happened, such as `instance.initialized` |
| `resourceType`, `resourceId` | What it happened to |
| `ipAddress` | The client address, through trusted proxies |
| `metadata` | Details, as a JSON object |
| `createdAt` | RFC 3339 time |
| `seq`, `prevHash`, `recordHash` | The record's place in the chain |

## Actions recorded today

| Action | When |
| --- | --- |
| `instance.initialized` | The root account was created, by `dopgate init` or the setup token. |
| `audit.pruned` | Retention archived and removed old records. |
| `settings.updated` | An admin changed runtime settings. `metadata.sections` lists the sections, and `metadata.smtpPasswordChanged` says whether the SMTP password was set or cleared. Values are not recorded. |

Each feature adds its actions as it lands: sign-ins and failures, sign-ups, password changes and resets, role and status changes, client and key changes, and backups.

## Verifying

The verify endpoint walks the chain in order, recomputes every hash, and reports the first record that does not match. Save `headSeq` and `headHash` from a report somewhere outside the server. Passing them back later as `anchorSeq` and `anchorHash` also catches a log that was rewritten from that point or had its newest records deleted, which the chain alone cannot see.
