---
title: "PostgreSQL and the `dopgate` schema"
description: "How Dopgate keeps every table in its own PostgreSQL schema, sets search_path, runs migrations at startup, and why it should have its own database role."
---

# PostgreSQL and the `dopgate` schema

Dopgate stores everything in PostgreSQL, inside one schema. The schema is `dopgate` unless you set `DOPGATE_DATABASE_SCHEMA`. Your app's tables in `public` or any other schema are never read or changed.

## Connection

```bash
DOPGATE_DATABASE_URL=postgres://dopgate:secret@localhost:5432/app
```

The URL must start with `postgres://` or `postgresql://`. Add `?sslmode=require` or another `sslmode` when the server is on another machine. Dopgate opens up to 10 connections; `DOPGATE_DATABASE_MAX_CONNECTIONS` (1 to 1000) changes that. Logs and errors show the URL with the password replaced by `***`.

## How the schema works

On startup Dopgate:

1. waits up to 30 seconds for the server to accept connections,
2. creates the `dopgate` schema if it doesn't exist yet,
3. sets `search_path` to that schema, and only that schema, on every connection it opens,
4. applies any migrations the database doesn't have yet.

Because of the `search_path`, every table, including sqlx's own `_sqlx_migrations`, lands in the `dopgate` schema. `serve`, `init`, and `keys rotate` all run the migrations, so any of them prepares a new database.

A schema name must use lowercase letters, digits, and underscores, start with a letter or underscore, not start with `pg_`, and be at most 63 bytes.

## The tables

| Table | Holds |
| --- | --- |
| `admins` | Root and admins, with their password hashes |
| `users` | Your app's users, with their password hashes and metadata |
| `sessions`, `admin_sessions` | One row per signed-in device, for users and for admins |
| `refresh_tokens`, `admin_refresh_tokens` | SHA-256 hashes of refresh tokens |
| `verification_tokens`, `admin_codes` | SHA-256 hashes of emailed 6-digit codes |
| `personal_tokens` | Users' personal tokens, as SHA-256 hashes |
| `agents` | Agents, their owners and capabilities, and SHA-256 hashes of their tokens |
| `signing_keys` | The ES256 keys that sign access tokens, private keys included |
| `console_keys` | The HS256 secret that signs console tokens |
| `settings` | Runtime settings, one JSON object per section. A saved SMTP password is encrypted with a key derived from `DOPGATE_SERVICE_KEY`. |
| `email_templates` | Admin overrides of the built-in emails |
| `sso_providers`, `user_identities`, `sso_flows` | Reserved for single sign-on, which is planned |
| `audit_events`, `audit_chain_anchor`, `audit_chain_genesis` | The audit log and its hash chain |

Treat these as Dopgate's private storage and use the API to read or change accounts. Writing to them directly can break the audit chain and the invariants the code relies on.

## Give Dopgate its own role

`signing_keys` holds the private key that signs every access token, and `console_keys` the secret behind console tokens. Anyone who can read them can sign a token for any user or admin. Your app's database role shouldn't be able to read them, and neither should any reporting or analytics user.

Create a role for Dopgate and let it create its own schema:

```sql
CREATE ROLE dopgate LOGIN PASSWORD 'a-long-random-password';
GRANT CONNECT, CREATE ON DATABASE app TO dopgate;
```

On first start Dopgate creates the `dopgate` schema, owned by the `dopgate` role. PostgreSQL gives no access to a new schema to anyone but its owner, so your app's role can't read it unless it is a superuser or you grant access. Check that your app doesn't connect as a superuser.

Dopgate only creates the schema when it is missing, so after the first start you can revoke `CREATE ON DATABASE` and keep the role's rights inside its own schema.

## Sharing a database with your app

Sharing one database is the expected setup. It means one server to run and back up. Keep in mind:

- Don't put your own tables in the `dopgate` schema.
- Don't add foreign keys from your tables to `dopgate.users`. Deleting a user in Dopgate would fail or cascade into your data. Store the user ID (`sub`) as a plain text column and clean up your own rows when a user is deleted. The audit log records each deletion as `user.deleted`.
- A `pg_dump` of the whole database includes the `dopgate` schema and its private signing key. See [Backups](/self-hosting/backups).
