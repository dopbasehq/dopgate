// The e2e harness. A spec file starts with `const app = useServer()`, which
// boots a fresh Dopgate server for that file and stops it afterwards, then
// talks to it through `app.api`, `app.cli` and the browser `page`.
//
//   import { test, expect, useServer, about, step } from "../harness/index.ts";
//   const app = useServer();
//   test("…", { tag: "@users", annotation: about("…") }, async () => {
//     await step("…", async () => { … });
//   });
import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  test as base,
  expect,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { ApiClient, type ApiCall, type Tokens } from "./api.ts";
import type { BreachList } from "./breaches.ts";
import { CliRun } from "./cli.ts";
import { Mailbox } from "./mail.ts";
import { about, recordHit } from "./record.ts";
import {
  LEAKED_PASSWORD,
  PASSWORD,
  ROOT_EMAIL,
  startServer,
  type RunOptions,
  type Server,
  type ServerOptions,
} from "./server.ts";

export { expect, about, ROOT_EMAIL, PASSWORD, LEAKED_PASSWORD };
export { COOKIE_MODE } from "./api.ts";
export type { ApiClient, ApiResult, Tokens } from "./api.ts";
export type { Mail } from "./mail.ts";

/** An admin of the instance, signed in to the console API. */
export type Admin = {
  id: string;
  email: string;
  /** Undefined for an admin who signs in with emailed codes only. */
  password: string | undefined;
  role: "root" | "admin";
  /** Their console session: every call carries their access token. */
  api: ApiClient;
  /** What their sign-in answered, refresh token included. */
  tokens: Tokens;
};

/** A user of the app Dopgate signs people in for. */
export type User = {
  id: string;
  email: string;
  /** Undefined for a user who signs in with emailed codes only. */
  password: string | undefined;
  /** Their session: every call carries their access token. */
  api: ApiClient;
  /** What their sign-in answered. Undefined for a user who wasn't signed in. */
  tokens: Tokens | undefined;
};

export type NewUser = {
  /** Their email is confirmed. On unless set to false. */
  verified?: boolean;
  /** Give them the harness password. On unless set to false. */
  password?: boolean;
  displayName?: string;
  publicMetadata?: Record<string, unknown>;
  privateMetadata?: Record<string, unknown>;
  /**
   * Sign them in. On unless set to false, or when they have no password or
   * an unconfirmed email, which can't sign in with one.
   */
  signIn?: boolean;
};

/** E2E_KEEP=1 (or test:e2e --keep): keep the server of a file that failed. */
const KEEP = Boolean(process.env.E2E_KEEP);
/** Names the attachment run.ts and the report read the kept folder from. */
export const KEPT_ATTACHMENT = "kept server";

let currentApp: App | undefined;
let currentPage: Page | undefined;

/** Opens another browser in the same test, e.g. a second admin's. */
export type NewContext = (
  /** Whose browser this is. The report labels its video with it. */
  name: string,
  options?: BrowserContextOptions,
) => Promise<BrowserContext>;

export const test = base.extend<{ newContext: NewContext }>({
  // browser.newContext() doesn't record video, even when the project does.
  // This one follows the project's `video` setting, so a journey's second
  // browser shows up in the report next to the main one.
  newContext: async ({ browser, video }, use, testInfo) => {
    const mode = typeof video === "string" ? video : video.mode;
    const opened: { name: string; context: BrowserContext; pages: Page[] }[] =
      [];
    await use(async (name, options = {}) => {
      const dir = testInfo.outputPath(`video-${opened.length + 1}`);
      const context = await browser.newContext({
        ...(mode === "off" ? {} : { recordVideo: { dir } }),
        ...options,
      });
      const entry = { name, context, pages: [] as Page[] };
      context.on("page", (page) => entry.pages.push(page));
      opened.push(entry);
      return context;
    });
    const failed = testInfo.status !== testInfo.expectedStatus;
    const keep = mode === "on" || (mode !== "off" && failed);
    for (const [index, { name, context, pages }] of opened.entries()) {
      await context.close().catch(() => {});
      for (const page of pages) {
        const path = await page
          .video()
          ?.path()
          .catch(() => undefined);
        if (!path) continue;
        if (keep) {
          testInfo.attachments.push({
            name: `video: ${name}`,
            path,
            contentType: "video/webm",
          });
        }
      }
      if (!keep)
        await rm(testInfo.outputPath(`video-${index + 1}`), {
          recursive: true,
          force: true,
        });
    }
  },
  // Every request and page.goto("/…") goes to the file's own server.
  baseURL: async ({}, use) => {
    await use(currentApp?.url);
  },
  // Records the pages a UI test reaches, for the coverage check, and lets
  // step() attach a screenshot after each step.
  page: async ({ page }, use) => {
    const visit = (url: string) => {
      try {
        const { pathname } = new URL(url);
        if (!pathname.startsWith("/api/")) recordHit("ui", pathname);
      } catch {
        // about:blank and the like.
      }
    };
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) visit(frame.url());
    });
    page.on("request", (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        visit(req.url());
      }
    });
    currentPage = page;
    await use(page);
    currentPage = undefined;
  },
});

/**
 * A named step. It shows in the report as one line of the scenario. In a
 * test that uses a browser page, a screenshot is attached after the step.
 */
export function step<T>(title: string, body: () => Promise<T>): Promise<T> {
  return stepOn(currentPage, title, body);
}

/**
 * A named step whose screenshot comes from `page`, e.g. a second person's
 * browser. `step()` always shoots the test's own `page`.
 */
export async function stepOn<T>(
  page: Page | undefined,
  title: string,
  body: () => Promise<T>,
): Promise<T> {
  return test.step(title, async () => {
    const result = await body();
    if (page && !page.isClosed()) {
      try {
        await test.info().attach(`screenshot: ${title}`, {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      } catch {
        // A page mid-navigation can refuse a screenshot; the step still counts.
      }
    }
    return result;
  });
}

/** Boots a fresh server for this spec file. Call once, at the top level. */
export function useServer(opts: ServerOptions = {}): App {
  const app = new App(opts);
  test.beforeAll(async ({}, info) => {
    info.setTimeout(90_000);
    await app.start();
    currentApp = app;
  });
  test.afterEach(async ({}, info) => {
    if (info.status !== info.expectedStatus) {
      app.failed = true;
      await app.attachDiagnostics(info);
    }
  });
  test.afterAll(async ({}, info) => {
    info.setTimeout(30_000);
    try {
      await app.checkLeaks();
    } finally {
      currentApp = undefined;
      // With E2E_KEEP, a file with a failed test keeps its server's schema
      // and log so you can start it again and look around. See App.keep().
      if (KEEP && app.failed) await app.keep();
      else await app.stop();
    }
  });
  return app;
}

export class App {
  readonly options: ServerOptions;
  /** Every secret value a test seeded, for the leak check. */
  readonly secrets = new Set<string>();
  /** Set once a test in this file fails; E2E_KEEP then keeps the server. */
  failed = false;
  private server_?: Server;
  private readonly calls: ApiCall[] = [];
  private readonly clients = new Map<string, Promise<ApiClient>>();
  private root_?: Promise<Admin>;

  constructor(options: ServerOptions) {
    this.options = options;
  }

  get server(): Server {
    if (!this.server_)
      throw new Error("The server is not running yet; use app inside a test");
    return this.server_;
  }
  get url(): string {
    return this.server.url;
  }

  async start(): Promise<void> {
    this.server_ = await startServer(this.options);
  }

  async stop(): Promise<void> {
    await this.disposeClients();
    await this.server_?.stop();
    this.server_ = undefined;
  }

  /**
   * Stops the server but keeps its schema and log, with a sandbox.json that
   * tells `bun run test:e2e:sandbox --from <root>` how to start it again.
   */
  async keep(): Promise<void> {
    await this.disposeClients();
    const server = this.server_;
    if (server) {
      await server.halt();
      await writeFile(
        join(server.root, "sandbox.json"),
        JSON.stringify(
          { schema: server.schema, options: this.options },
          null,
          2,
        ),
      );
    }
    this.server_ = undefined;
  }

  private async disposeClients(): Promise<void> {
    for (const client of this.clients.values()) {
      await (await client.catch(() => undefined))?.dispose();
    }
    this.clients.clear();
    this.root_ = undefined;
  }

  /** A random value, remembered for the leak check. */
  value(): string {
    const value = `e2e_${randomBytes(14).toString("hex")}`;
    this.secrets.add(value);
    return value;
  }

  /** Remembers a secret for the leak check, e.g. a token the server made. */
  secret<T extends string>(value: T): T {
    this.secrets.add(value);
    return value;
  }

  /** A name nobody else in this file uses, e.g. `ana-3f2a9c`. */
  uniq(prefix: string): string {
    return `${prefix}-${randomBytes(3).toString("hex")}`;
  }

  /** An email address nobody else in this file uses. */
  email(name = "ana"): string {
    return `${this.uniq(name)}@dopbase.com`;
  }

  /** The email this server sent: to its log, or to the fake SMTP server. */
  get mail(): Mailbox {
    return new Mailbox(this.server.log, this.server.smtp);
  }

  /** The fake leaked password list this server asks about new passwords. */
  get breaches(): BreachList {
    return this.server.breaches;
  }

  /** The service key, for sending it by hand. */
  get serviceKey(): string {
    const key = this.server.serviceKey;
    if (!key) throw new Error("This server was started without a service key");
    return key;
  }

  // --- callers -------------------------------------------------------------

  /** The API with no credentials, shared by the whole file. */
  get api(): ApiClient {
    return this.lazy(() => this.anonymousApi());
  }

  /** The admin API as a backend: every call carries the service key. */
  get service(): ApiClient {
    return this.lazy(() =>
      this.client("service", () =>
        ApiClient.create(this.url, "service key", this.calls, this.serviceKey),
      ),
    );
  }

  /** The API with no credentials, as its own client. */
  anonymousApi(): Promise<ApiClient> {
    return this.client("anonymous", () =>
      ApiClient.create(this.url, "anonymous", this.calls),
    );
  }

  /**
   * A new API client with its own cookie jar, so what one caller does never
   * signs another in. Pass a bearer token to send on every call. Stopped
   * with the server.
   */
  newApi(label = "visitor", token?: string): Promise<ApiClient> {
    const key = `${label}-${randomBytes(4).toString("hex")}`;
    return this.client(key, () =>
      ApiClient.create(this.url, label, this.calls, token),
    );
  }

  /**
   * The root account, signed in to the console. The whole file shares this
   * one session, so use `consoleSession(ROOT_EMAIL)` for a session a test
   * ends. If the shared one does end, the next call signs in again.
   */
  async root(): Promise<Admin> {
    // A key rotation or a test that ended root's sessions leaves the shared
    // session dead, so it is checked first and replaced when it is.
    if (this.root_) {
      const root = await this.root_.catch(() => undefined);
      const alive =
        root &&
        (await root.api.get("/console/me", { record: false })).status === 200;
      if (!alive) this.root_ = undefined;
    }
    this.root_ ??= this.consoleSession(ROOT_EMAIL, PASSWORD, "root");
    return this.root_;
  }

  /** A new console session for an admin who already exists. */
  async consoleSession(
    email: string,
    password: string = PASSWORD,
    label = "admin",
  ): Promise<Admin> {
    const api = await this.newApi(label);
    const signedIn = await api.signIn("/console/login", email, password, {
      record: false,
    });
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    const admin = signedIn.data.admin!;
    return {
      id: admin.id,
      email: admin.email,
      password,
      role: admin.role,
      api,
      tokens: signedIn.data,
    };
  }

  /**
   * A new admin root has added, signed in to the console. Setup, so none of
   * it counts toward coverage.
   */
  async admin(
    name = "admin",
    opts: { displayName?: string } = {},
  ): Promise<Admin> {
    const email = this.email(name);
    const root = await this.root();
    await root.api.must(
      "POST",
      "/admin/admins",
      { email, password: PASSWORD, displayName: opts.displayName },
      { record: false },
    );
    return this.consoleSession(email, PASSWORD, name);
  }

  /**
   * A new user of the app, made through the admin API and signed in. Setup,
   * so none of it counts toward coverage.
   */
  async user(name = "ana", opts: NewUser = {}): Promise<User> {
    const email = this.email(name);
    const password = opts.password === false ? undefined : PASSWORD;
    const verified = opts.verified ?? true;
    const created = await (
      await this.adminApi()
    ).must(
      "POST",
      "/admin/users",
      {
        email,
        password,
        displayName: opts.displayName,
        emailVerified: verified,
        publicMetadata: opts.publicMetadata,
        privateMetadata: opts.privateMetadata,
      },
      { record: false },
    );
    const api = await this.newApi(name);
    let tokens: Tokens | undefined;
    if (password && verified && opts.signIn !== false) {
      const signedIn = await api.signIn("/auth/login", email, password, {
        record: false,
      });
      expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
      tokens = signedIn.data;
    }
    return { id: created.id, email, password, api, tokens };
  }

  /** A new session for a user who already exists, on its own client. */
  async userSession(
    email: string,
    password: string = PASSWORD,
    label = "user",
  ): Promise<{ api: ApiClient; tokens: Tokens }> {
    const api = await this.newApi(label);
    const signedIn = await api.signIn("/auth/login", email, password, {
      record: false,
    });
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    return { api, tokens: signedIn.data };
  }

  /**
   * Changes one section of the settings and keeps its other fields, which a
   * bare PATCH would put back to their defaults. Setup: not counted.
   */
  async settings(
    section: string,
    change: Record<string, unknown>,
  ): Promise<Record<string, any>> {
    const api = await this.adminApi();
    const current = await api.must("GET", "/admin/settings", undefined, {
      record: false,
    });
    return api.must(
      "PATCH",
      "/admin/settings",
      { [section]: { ...current[section], ...change } },
      { record: false },
    );
  }

  /** The admin API for setup: the service key, or root without one. */
  private async adminApi(): Promise<ApiClient> {
    if (this.server.serviceKey)
      return this.client("service", () =>
        ApiClient.create(this.url, "service key", this.calls, this.serviceKey),
      );
    return (await this.root()).api;
  }

  // --- the CLI ---------------------------------------------------------------

  /**
   * Runs the CLI against this server's database and schema, e.g.
   * `app.cli(["keys", "rotate"])`. Pass `env` to add or replace settings.
   */
  cli(args: string[], opts: RunOptions = {}): CliRun {
    return new CliRun(args, {
      ...opts,
      env: { ...this.server.cliEnv, ...opts.env },
    });
  }

  /** Runs the CLI with nothing in its env but what you pass. */
  cliRaw(args: string[], opts: RunOptions = {}): CliRun {
    return new CliRun(args, opts);
  }

  // --- plumbing --------------------------------------------------------------

  /** A client that is only made when first used, so it can be a getter. */
  private lazy(make: () => Promise<ApiClient>): ApiClient {
    return new Proxy({} as ApiClient, {
      get: (_, prop) => {
        // Not a thenable, or `await app.api` would hang.
        if (prop === "then") return undefined;
        return async (...args: unknown[]) => {
          const client = await make();
          return (client as any)[prop](...args);
        };
      },
    });
  }

  private client(
    key: string,
    make: () => Promise<ApiClient>,
  ): Promise<ApiClient> {
    let client = this.clients.get(key);
    if (!client) {
      client = make();
      this.clients.set(key, client);
      client.catch(() => this.clients.delete(key));
    }
    return client;
  }

  /** Fails the file if any seeded secret value reached the server log. */
  async checkLeaks(): Promise<void> {
    if (!this.server_) return;
    const log = await this.server_.log();
    // Besides what tests seeded: no password and no service key belongs in
    // a log, whoever typed it.
    const secrets = [...this.secrets, PASSWORD];
    if (this.server_.serviceKey) secrets.push(this.server_.serviceKey);
    const leaked = secrets.filter((value) => log.includes(value));
    if (leaked.length) {
      throw new Error(
        `${leaked.length} secret value(s) appeared in the server log, e.g. ${leaked[0]}`,
      );
    }
  }

  /** Attaches the server log tail and the last API calls to a failed test. */
  async attachDiagnostics(info: TestInfo): Promise<void> {
    if (this.server_ && KEEP) {
      await info.attach(KEPT_ATTACHMENT, {
        body: [
          `This file's server is kept in ${this.server_.root} (schema ${this.server_.schema})`,
          "Start it again with:",
          `  bun run test:e2e:sandbox --from ${this.server_.root}`,
        ].join("\n"),
        contentType: "text/plain",
      });
    }
    if (this.server_) {
      const lines = (await this.server_.log()).split("\n");
      await info.attach("server.log", {
        body: lines.slice(-200).join("\n"),
        contentType: "text/plain",
      });
    }
    if (this.calls.length) {
      await info.attach("api-calls.json", {
        body: JSON.stringify(this.calls, null, 2),
        contentType: "application/json",
      });
    }
  }
}
