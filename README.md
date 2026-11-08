# dopgate

dopgate is an authentication server you host yourself. One binary and one SQLite file handle sign-up, sign-in, email verification, password resets, single sign-on, and the JWTs your apps hand to their backends. Think of a small Firebase Authentication or Clerk that runs on your own machine.

> Version 0.1.0 has the server, setup, audit log, and the full API laid out. Most endpoints answer `501 Not Implemented` until their phase lands. See [docs/guide/product-status.md](docs/guide/product-status.md).

## Repository

| Path | What it holds |
| --- | --- |
| `app/` | The Rust backend: the `dopgate` binary, migrations, and tests |
| `docs/` | The VitePress documentation site |
| `ui/` | The future Admin UI (Vue), not wired in yet |
| `scripts/dev.ts` | Starts the API and the docs together |

## Run it

You need Rust 1.89 or newer, and [Bun](https://bun.sh) for the docs.

```bash
bun install
cargo run --manifest-path app/Cargo.toml -- init --data-dir .dev-data --email you@example.com
bun run dev
```

That starts:

- the API on http://localhost:8850/api/v1, with Swagger UI at http://localhost:8850/api/docs
- the docs on http://localhost:5173

## Scripts

| Script | Does |
| --- | --- |
| `bun run dev` | API and docs together; Ctrl-C stops both |
| `bun run dev:app` | Only the API, with data in `./.dev-data` |
| `bun run dev:docs` | Only the docs |
| `bun run build` | Release binary and static docs |
| `bun run test:app` | Backend tests |
| `bun run lint:app` | Clippy with warnings as errors |
| `bun run format:app` | rustfmt |

## Documentation

Start with [docs/guide/quick-start.md](docs/guide/quick-start.md), or run `bun run dev:docs` and open the site. The [roadmap](docs/about/roadmap.md) lists what each phase builds.

## License

Apache-2.0
