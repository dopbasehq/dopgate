---
title: "Users and roles"
description: "The root, admin, and member roles in dopgate, what each can do, and where to keep app-specific data about a user."
---

# Users and roles

Every account in dopgate is a row in one `users` table, whatever its role. An account has an email, an optional password, a display name and avatar, a status, and two JSON metadata objects.

## Roles

| Role | Who | Can do |
| --- | --- | --- |
| `root` | The instance owner. Exactly one exists, created at setup. | Everything, including backups, restores, and key rotation. Nobody can change or delete root through the API. |
| `admin` | People who run the user base. | Manage users, clients, settings, single sign-on, and read the audit log. They cannot touch root. |
| `member` | The people who use your apps. | Manage their own account and sessions. |

A backend that calls the admin API with a client secret key acts like an admin. See [Clients](/guide/clients).

The access token carries the role in its `role` claim, so your backend can tell admins from members without a lookup.

::: warning Planned
User management through the admin API arrives in phase 1. Today the only account you can create is root, with `dopgate init` or the setup token.
:::

## Status

An account is `active` or `disabled`. Disabling an account refuses new sign-ins and ends its sessions; access tokens already issued stop working when they expire, within minutes.

After too many failed passwords an account is locked for a while. That is separate from status and clears by itself.

## Metadata

`publicMetadata` is a JSON object the user can read and your app can show, such as a plan name or a preferred language. `privateMetadata` is only visible to admins and backends with a secret key, for things like an internal customer ID.

Keep metadata small. For anything that grows, such as permissions per project, use your own database and key it by the user ID.

## IDs

User IDs look like `usr_01M5X911APKT75KDR5RGZNTT33`. They never change, so use them, never the email, as the foreign key in your own tables. Emails are stored lowercased and compared without regard to case.
