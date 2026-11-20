<p align="center">
  <img src="public/logo.svg" width="72" height="78" alt="Dopgate logo: a red D with a # knocked out of it">
</p>

<h1 align="center">Dopgate</h1>

<p align="center">Authentication you host yourself. Part of the Dopbase family.</p>

Dopgate is an authentication server for one app, and you host it yourself. It signs users up and in, confirms their email with 6-digit codes, resets passwords, and gives your app ES256 JWTs that your backend verifies offline against a public key set. It runs as its own container next to your app, usually in the same Docker Compose stack, and keeps every table in a PostgreSQL schema (`dopgate` by default), so it can share your app's database. The binary has an admin console built in for root and admins.

Single sign-on and multi-factor authentication are planned; their routes answer `501` for now. See [product status](docs/guide/product-status.md).

## Quick start

You need Docker with the Compose plugin.

```bash
cp .env.example .env   # set POSTGRES_PASSWORD and DOPGATE_ROOT_EMAIL at least
docker compose up -d
docker compose logs dopgate
```

The log shows the root password, once. Open http://localhost:8850, sign in with your root email and that password, and change the password on the Account page. The API is at http://localhost:8850/api/v1 and its Swagger UI at http://localhost:8850/api/docs.

Without SMTP settings, Dopgate writes every email, codes included, to its log. The [quick start guide](docs/guide/quick-start.md) goes further, and [running with your app's stack](docs/self-hosting/with-your-app.md) shows how to add Dopgate to your own Compose file.

## Local development

You need Rust 1.89 or newer, [Bun](https://bun.sh), and Docker for PostgreSQL.

```bash
bun install
bun install --cwd ui
bun run dev:db   # PostgreSQL 18 in a container named dopgate-dev-pg, on port 55433
bun run dev      # API, console, and docs together; Ctrl-C stops all three
```

| What | Where |
| --- | --- |
| API | http://localhost:8850/api/v1 |
| Swagger UI | http://localhost:8850/api/docs |
| Admin console (Vite) | http://localhost:5174 |
| Docs (VitePress) | http://localhost:5173 |

`bun run dev` points the API at the `dev:db` database, allows the console's origin, and sets `DOPGATE_ROOT_EMAIL=admin@example.com`, so the first start prints a root password in the terminal. Emails go to the same terminal.

To run the tests, start their database first. It is a separate container, `dopgate-test-pg`, on port 55432:

```bash
bun run test:db
bun run test
```

Both containers have no password. They trust every connection and publish their port on 127.0.0.1 only, so nothing outside your machine can reach them. A container made by an older `dev:db` or `test:db` still asks for its old password. Remove it with `docker rm -f dopgate-dev-pg dopgate-test-pg` and run the command again.

The end-to-end suites run the release binary through its CLI, its API, and the console in Chromium. They use the same test database:

```bash
bun install --cwd e2e
bun run --cwd e2e install:browsers   # once
bun run test:e2e
```

[`e2e/README.md`](e2e/README.md) covers running one suite, the report, and writing a spec.

If you ran a 0.1.0 preview, delete the old `.dev-data` folder. It held SQLite files that nothing reads anymore.

## Scripts

| Script | Does |
| --- | --- |
| `bun run dev` | API, console, and docs together |
| `bun run dev:db` | Start the development PostgreSQL container on port 55433 |
| `bun run dev:app` | Only the API (`cargo run -- serve`) |
| `bun run dev:ui` | Only the console, with Vite on port 5174 |
| `bun run dev:docs` | Only the docs, with VitePress on port 5173 |
| `bun run build` | The release binary (console included) and the static docs |
| `bun run build:app` | Build the console, then the release binary that embeds it |
| `bun run build:ui` | Only the console, into `ui/dist` |
| `bun run build:docs` | Only the docs, into `docs/.vitepress/dist` |
| `bun run preview:docs` | Serve the built docs |
| `bun run test:db` | Start the test PostgreSQL container on port 55432 |
| `bun run test` | Console tests, then backend tests |
| `bun run test:ui` | Console tests (Vitest) |
| `bun run test:app` | Backend tests (`cargo test`) |
| `bun run test:e2e` | Every end-to-end suite, the coverage check, and the HTML report |
| `bun run test:e2e:cli`, `:api`, `:ui`, `:journeys` | One end-to-end suite |
| `bun run test:e2e:sandbox` | Start a server with sample accounts to click through by hand |
| `bun run test:e2e:help` | Every test script, flag, and tag |
| `bun run clean:test` | Delete test output, leftover test servers, and their schemas |
| `bun run lint` | ESLint for the console, Clippy for the backend |
| `bun run lint:ui` | ESLint for the console |
| `bun run lint:app` | Clippy with warnings as errors |
| `bun run typecheck:ui` | `vue-tsc` for the console |
| `bun run typecheck:e2e` | `tsc` for the end-to-end suites |
| `bun run format:app` | `rustfmt` |
| `bun run format:app:check` | Check formatting without changing files |
| `bun run clean` | Remove build output of the backend, the console, and the docs |
| `bun run docker:build` | Build the Docker image as `dopgate` |

## Repository layout

| Path | What it holds |
| --- | --- |
| `app/` | The Rust backend: the `dopgate` binary, its migrations, and tests |
| `ui/` | The admin console (Vue 3, Vite, Tailwind), embedded into the binary at build time |
| `e2e/` | End-to-end suites that run the release binary: CLI, API, console, and journeys |
| `docs/` | The VitePress documentation site |
| `scripts/` | `dev.ts`, which starts the API, console, and docs together, `clean-test.ts`, `bench.ts` behind `bun run bench`, and the release scripts |
| `public/` | The logo and favicon the docs use |
| `Dockerfile`, `docker-compose.yml`, `.env.example` | The image and the smallest PostgreSQL plus Dopgate stack |

## Documentation

Run `bun run dev:docs` and open http://localhost:5173, or read the Markdown in `docs/`. Good places to start: [introduction](docs/guide/index.md), [add Dopgate to your app](docs/guide/add-to-your-app.md), [environment variables](docs/reference/environment-variables.md), and the [REST API](docs/reference/api.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
