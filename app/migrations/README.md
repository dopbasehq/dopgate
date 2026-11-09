# Migrations

Migrations are embedded into the `dopgate` binary with `sqlx::migrate!()` and
run before the HTTP listener starts. They run with `search_path` set to
dopgate's schema (`dopgate` unless `DOPGATE_DATABASE_SCHEMA` says otherwise),
so every table, sqlx's own `_sqlx_migrations` included, lands there. Write
table names without a schema prefix. Startup applies up
migrations only. Rolling back is for maintenance and tests, and the CLI has no
command for it.

## Naming

Each table or feature gets its own reversible pair, named after the UTC time
it was created:

```text
YYYYMMDDHHMMSS_<name>.up.sql
YYYYMMDDHHMMSS_<name>.down.sql
```

The rules, checked by `app/tests/services/migrations.rs`:

- The version is the UTC creation time, 14 digits. Generate it with
  `sqlx migrate add -r`; do not type it by hand. When several pairs are created
  in the same second, step each later one forward a second so the order stays
  the order they depend on.
- The name is lowercase `snake_case`.
- One logical change per pair. The down file reverses only that change and
  must stay safe when versions are reverted in reverse order.
- Every up file has a down file with the same version.
- A comment at the top of the up file says what the change is and why.

Never edit or rename a migration after it ships in a release. sqlx checksums
applied migrations, comments included, and refuses to start when one changes.
To change the schema, add a new pair.

## Current schema

The PostgreSQL baseline, in the order it is applied:

```text
20261109080000_users               accounts: root, admins, members
20261109080001_sessions            one row per signed-in device
20261109080002_refresh_tokens      hashed, single-use refresh tokens
20261109080003_verification_tokens emailed 6-digit codes
20261109080004_signing_keys        ES256 keys that sign access tokens
20261109080005_settings            runtime settings, one JSON object per section
20261109080006_email_templates     admin overrides of the built-in emails
20261109080007_sso_providers       OpenID Connect providers (planned feature)
20261109080008_user_identities     provider identities linked to accounts
20261109080009_sso_flows           provider sign-ins in progress
20261109080010_audit_events        audit log with its hash chain
```

Tables for later features, such as MFA factors, arrive with those features in
their own pairs.

The test suite applies every migration, rolls back to version zero, checks
that no table is left, applies them again, and checks that nothing landed in
`public`.

## Adding a migration

Create migrations with the sqlx CLI from `app/`, so the version comes from the
clock:

```bash
cargo install sqlx-cli --no-default-features --features postgres
cd app
sqlx migrate add -r <name>
```
