# End-to-end tests

These suites drive the release binary the way people use Dopgate: the CLI,
the HTTP API and the admin console in Chromium. They exist to catch
regressions, so every CLI command, API route and console page gets a test.

The setup follows Dopbase core's `e2e/` folder.

| Suite    | Folder      | Runs                                 |
| -------- | ----------- | ------------------------------------ |
| CLI      | `cli/`      | Playwright, no browser               |
| API      | `api/`      | Playwright, no browser               |
| Console  | `ui/`       | Playwright, Desktop Chrome           |
| Journeys | `journeys/` | Playwright, browser plus CLI and API |

## Running

The suites need PostgreSQL and Chromium:

```bash
bun run test:db                      # the test database, port 55432
bun install --cwd e2e
bun run --cwd e2e install:browsers   # once
```

Then:

```bash
bun run test:e2e                     # all suites, coverage check, report
bun run test:e2e --agent             # short summary instead of the full list
bun run test:e2e:api                 # one suite
bun run test:e2e --grep @smoke       # one area, by tag
bun run test:e2e:report              # open the last HTML report
bun run test:e2e:help                # every test script, flag and tag
bun run clean:test                   # delete test output and leftover servers
```

`test:e2e` rebuilds `app/target/release/dopgate` first when `app/src`,
`app/migrations` or `ui/src` changed. Set `DOPGATE_BIN` to test another
build, or pass `--skip-build`.

Each spec file gets its own server on a free port and its own schema in the
test database, named `e2e_` and twelve random characters. The schema is
dropped when the file finishes. The database is the one the Rust tests use
(`DOPGATE_TEST_DATABASE_URL`, or the `test:db` container). Set
`DOPGATE_E2E_DATABASE_URL` to use another PostgreSQL.

No test reaches the internet. Email goes to the server log, or to a fake SMTP
server when a test asks for one. The leaked password check asks a fake list
that every server gets through `DOPGATE_LEAKED_PASSWORDS_URL`.

Journeys keep a video of every run, passed or failed, and the report plays it
next to the steps. The other suites keep video, a trace and screenshots only
when a test fails.

Everything a run writes goes to `.e2e/` at the repo root, which git ignores:
`report/index.html`, `results/` (traces, screenshots, videos), `playwright/`
(Playwright's own report), `last-run.json` and `coverage.json`.

## Testing by hand

```bash
bun run test:e2e:sandbox
```

This starts the release binary the way a spec file does and prints the
console address, the root account, the service key and where the server log
is. It adds a second admin (Sam) and three users: Maya and Leo, who can sign
in, and Nina, who never confirmed her email. Emails are not sent, so the
codes are in the server log. Ctrl+C stops it and drops its schema. `--empty`
skips the sample accounts, `--keep` keeps the schema and the log, and
`--port` picks the port.

When a test fails and you want to see the state it left, run with `--keep`
(or `E2E_KEEP=1`):

```bash
bun run test:e2e:api --grep @users --keep
```

A file with a failed test then stops its server without dropping the schema.
The failure in the report, and the `--agent` summary, show a
`bun run test:e2e:sandbox --from <dir>` line that starts that server again on
the same data. Kept servers stay until `bun run clean:test` removes them.

To watch a test, pass Playwright's own flags after `--`: `-- --headed` opens
a real window and `-- --debug` steps through the test in the Playwright
inspector. Each scenario in the report lists its steps with a screen after
each one, so you can also follow it by hand.

## Writing a spec

```ts
import { about, expect, step, test, useServer } from "../harness/index.ts";

const app = useServer(); // a fresh server for this file

test(
  "disabling a user ends their sessions",
  {
    tag: "@users",
    annotation: about(
      "An admin disables an account. Its sessions end at once and sign-in is refused until it is enabled again.",
    ),
  },
  async () => {
    const user = await app.user();
    await step("POST /admin/users/{id}/disable as a backend", async () => {
      const disabled = await app.service.post(`/admin/users/${user.id}/disable`);
      expect(disabled.message).toBe("USER_DISABLED");
    });
    await step("Their session is gone, so their token is refused", async () => {
      expect((await user.api.get("/auth/me")).code).toBe("TOKEN_INVALID");
    });
  },
);
```

- `useServer()` boots a server on a free port with its own schema, root
  created and a service key, and stops it after the file. Options: `env`
  (extra `DOPGATE_*` settings), `docs: false`, `webUi: false`, `root: false`
  (no root yet; `await app.server.setupToken()` reads the token it printed),
  `serviceKey: false`, `relaxLimits: false`, `smtp: "env"` and `port`.
- Every server starts with its limits raised: 10,000 requests a minute per
  address, no wait between codes and 100 codes an hour. A file that tests
  those limits passes `relaxLimits: false` to get the defaults back.
- The four callers. `app.api` sends no credentials. `app.service` sends the
  service key, as a backend would. `await app.root()` is root signed in to
  the console, and `await app.admin("sam")` is a new admin. Both return an
  `Admin` whose `api` carries their console token. `await app.user("ana")`
  is a new user of the app with a confirmed email, signed in: `user.api`
  carries their access token and `user.tokens` is what sign-in answered.
- `app.user("ana", { verified: false })` and `{ password: false }` make a
  user who hasn't confirmed their email or who signs in with codes only.
  Neither is signed in. `publicMetadata`, `privateMetadata` and
  `displayName` go on the account.
- `app.root()` is one session shared by the whole file. If a test ends it,
  or rotates the signing keys, the next call signs in again.
  `await app.consoleSession(email)` and `await app.userSession(email)`
  open another session for someone who exists. `await app.newApi("label",
  token)` is a client of its own with any bearer token.
- A call answers `{ status, ok, body, data, message, code, headers,
  setCookies }`. `message` is the success code (`USER_CREATED`) and `code`
  the first error code (`EMAIL_TAKEN`). `client.must("POST", path, body)`
  asserts a 2xx and returns `data`.
- `client.get(path, { token: null })` sends one call without the client's
  token, and `{ token: "…" }` with another. `{ headers }` adds headers;
  `COOKIE_MODE` is the header that asks for the refresh token in a cookie,
  and `await client.cookie("dopgate_refresh")` reads the one it holds.
- `{ record: false }` keeps a setup call out of coverage. The harness's own
  setup (`app.user`, `app.admin`, `app.settings`) never counts.
- `await app.mail.code(email)` is the 6-digit code in the newest email to
  that address, and `await app.mail.last(email)` the whole message (`to`,
  `subject`, `text`). Both wait up to three seconds. Pass `{ after: n }` to
  wait for a message beyond the first `n`, for example after asking for a
  second code; `await app.mail.count(email)` gives `n`.
- `await app.settings("signup", { enabled: false })` changes one section of
  the settings and keeps its other fields. A bare `PATCH` puts the fields
  you leave out back to their defaults.
- `app.breaches` is the fake leaked password list. `LEAKED_PASSWORD` is on
  it from the start, `app.breaches.add(password)` adds another,
  `failWith(503)` makes it answer errors, and `lookups` lists what the
  server asked.
- `await startSmtp()` from `harness/smtp.ts` is a fake SMTP server: point the
  `smtp` settings at `127.0.0.1` and its `port` with security `none`, then
  read `messages`. `useServer({ smtp: "env" })` starts one, names it in
  `DOPGATE_SMTP_URL` and reads `app.mail` from it.
- `app.cli(["keys", "rotate"])` runs the binary against this server's
  database and schema. `.ok()`, `.fails(code)` and `.json()` assert on the
  result. `app.cliRaw(args, { env })` runs it with nothing but the env you
  give.
- `query(app.server.schema, sql, params)` from `harness/server.ts` runs SQL
  in the server's schema. Use it only for what no route can do, such as
  making a code look ten minutes old.
- In the browser, `openAs(page, admin, "/users")` from `harness/helpers.ts`
  opens a console page as that admin without going through sign-in.
  `signInOnPage`, `enterCode`, `nav(page, "Signing keys")` and
  `signOutOnPage` work the sign-in form, the code boxes, the sidebar and the
  account menu. `claims(token)` and `verifiedByJwks(token, jwks)` read and
  check a JWT.
- In a test that takes `page`, `page.goto("/…")` goes to the file's own
  server.
- For a second browser in the same test, such as another admin's, take the
  `newContext` fixture instead of `browser.newContext()`:
  `const context = await newContext("sam", { baseURL: app.url })`. It
  records video under the suite's `video` setting, and the report labels the
  recording with the name you gave it.
- `app.uniq("acme")` gives a name nobody else in the file uses,
  `app.email("ana")` an address, and `app.value()` a random secret value.
- Helpers every suite can use live in `harness/`. A suite's own `support.ts`
  holds only what that suite needs. Look there before you write a new helper.

Every test needs a description (`about(…)`) and at least one `step(…)`. The
report shows them as a scenario, and the coverage check lists a test without
them. With `strict` on in `coverage/manifest.ts`, a full run then fails. In a
test that uses `page`, `step()` attaches a screenshot after each step;
`stepOn(otherPage, …)` takes it from another page, such as a second person's
browser.

## Coverage

The helpers record what each test hits: CLI commands from `app.cli`, routes
from the API clients, pages the browser reaches. A hit counts only in its own
suite, so journeys don't stand in for the direct tests. Calls made with
`{ record: false }` don't count.

`coverage/check.ts` lists every command (from `dopgate --help`), route (from
`/api/v1/openapi.json`) and page (from `ui/src/router.ts`) and compares. When
something truly can't be tested end to end, add it to that suite's file in
`coverage/skips/` with the reason.

## Secrets in output

A file fails if the harness password, the service key, or a value from
`app.value()` or `app.secret(token)` shows up in the server log.
