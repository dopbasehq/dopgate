# Migrations

Migrations are embedded into the `dopgate` binary with `sqlx::migrate!()` and
run transactionally before the HTTP listener starts. Startup applies up
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

The baseline, in the order it is applied:

```text
20261026232635_instance_metadata   master-key check value
20261026232636_users               accounts: root, admins, members
20261026232637_clients             apps with publishable and secret keys
20261026232638_sessions            one row per signed-in device
20261026232639_refresh_tokens      hashed, single-use refresh tokens
20261026232640_verification_tokens emailed codes and links
20261026232641_signing_keys        JWT signing keys, private half encrypted
20261026232642_settings            runtime settings, secrets encrypted
20261026232643_sso_providers       OpenID Connect providers
20261026232644_user_identities     provider identities linked to accounts
20261026232645_sso_flows           provider sign-ins in progress
20261026232646_audit_events        audit log with its hash chain
```

Tables for later features, such as MFA factors and OIDC provider
authorization codes, arrive with those features in their own pairs.

The test suite applies every migration, rolls back to version zero, checks
that no table is left, and applies them again.

## Adding a migration

Create migrations with the sqlx CLI from `app/`, so the version comes from the
clock:

```bash
cargo install sqlx-cli --no-default-features --features sqlite
cd app
sqlx migrate add -r <name>
```
