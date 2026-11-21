import { readFileSync } from "node:fs";
import { about, expect, step, test, useServer } from "../harness/index.ts";

const app = useServer();
const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const JSON_HEADERS = { "content-type": "application/json" };
const ERROR_SHAPE = { success: false, error: expect.any(Object) };

test(
  "the OpenAPI document and Swagger UI are served",
  {
    tag: "@smoke",
    annotation: about(
      "The server describes its own API at /api/v1/openapi.json and serves Swagger UI at /api/docs. The document carries the product name, the release version and the routes people build against.",
    ),
  },
  async ({ request }) => {
    const doc = await step("GET /api/v1/openapi.json", async () => {
      const res = await request.get("/api/v1/openapi.json");
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/json");
      return res.json();
    });
    await step("It is OpenAPI 3 titled Dopgate API, at the release version", async () => {
      expect(doc.openapi).toMatch(/^3\./);
      expect(doc.info.title).toBe("Dopgate API");
      expect(doc.info.version).toBe(pkg.version);
    });
    await step("It lists health, setup, sign-in, the admin API and the key set", async () => {
      const paths = Object.keys(doc.paths);
      expect(paths).toEqual(
        expect.arrayContaining([
          "/api/v1/health",
          "/api/v1/bootstrap/status",
          "/api/v1/bootstrap/root",
          "/api/v1/auth/login",
          "/api/v1/console/login",
          "/api/v1/admin/users",
          "/api/v1/admin/keys/rotate",
          "/.well-known/jwks.json",
          "/.well-known/openid-configuration",
        ]),
      );
      expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
        type: "http",
        scheme: "bearer",
      });
    });
    await step("Every operation has an ID that is unique across the document", async () => {
      const ids: string[] = [];
      for (const item of Object.values<any>(doc.paths)) {
        for (const operation of Object.values<any>(item)) {
          if (operation?.operationId) ids.push(operation.operationId);
        }
      }
      expect(ids.length).toBeGreaterThan(60);
      expect(new Set(ids).size).toBe(ids.length);
    });
    await step("GET /api/docs sends the browser on to /api/docs/", async () => {
      const res = await request.get("/api/docs", { maxRedirects: 0 });
      expect(res.status()).toBe(303);
      expect(res.headers().location).toBe("/api/docs/");
    });
    await step("GET /api/docs/ is the Swagger UI page", async () => {
      const res = await request.get("/api/docs/");
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/html");
      expect(await res.text()).toMatch(/swagger/i);
    });
  },
);

test(
  "planned endpoints are left out of the OpenAPI document",
  {
    tag: "@smoke",
    annotation: about(
      "The multi-factor and single sign-on routes answer 501 for now. They stay out of the document and of Swagger UI until they work, so nobody builds against them by accident.",
    ),
  },
  async ({ request }) => {
    const doc = await step("GET /api/v1/openapi.json", async () =>
      (await request.get("/api/v1/openapi.json")).json(),
    );
    await step("No route under /auth/mfa or /auth/sso is listed", async () => {
      const paths = Object.keys(doc.paths);
      expect(paths.filter((path) => path.includes("/auth/mfa"))).toEqual([]);
      expect(paths.filter((path) => path.includes("/auth/sso"))).toEqual([]);
    });
    await step("No route under /admin/sso is listed, the presets included", async () => {
      const paths = Object.keys(doc.paths);
      expect(paths.filter((path) => path.includes("/admin/sso"))).toEqual([]);
    });
    await step("No operation answers 501 in the document", async () => {
      for (const item of Object.values<any>(doc.paths)) {
        for (const operation of Object.values<any>(item)) {
          expect(Object.keys(operation.responses ?? {})).not.toContain("501");
        }
      }
    });
  },
);

test(
  "an unknown route answers a JSON 404 and a wrong method a JSON 405",
  {
    tag: "@smoke",
    annotation: about(
      "Whatever goes wrong, the API answers in one error shape: success false and a map of one error code to its message. An unknown route under /api or /.well-known is never the console page.",
    ),
  },
  async () => {
    await step("GET /api/v1/no-such-route is a 404 in the error shape", async () => {
      const missing = await app.api.get("/no-such-route", { record: false });
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject(ERROR_SHAPE);
      expect(missing.code).toBe("REQUEST_INVALID");
      expect(missing.headers["content-type"]).toContain("application/json");
    });
    await step("GET /.well-known/nope is a JSON 404 too", async () => {
      const missing = await app.api.get("/.well-known/nope", { record: false });
      expect(missing.status).toBe(404);
      expect(missing.code).toBe("REQUEST_INVALID");
    });
    await step("DELETE /api/v1/health is a 405 that names the methods it takes", async () => {
      const wrong = await app.api.delete("/health", undefined, { record: false });
      expect(wrong.status).toBe(405);
      expect(wrong.code).toBe("REQUEST_INVALID");
      expect(wrong.headers.allow).toContain("GET");
    });
    await step("POST /api/v1/auth/methods is a 405 as well", async () => {
      const wrong = await app.api.post("/auth/methods", {}, { record: false });
      expect(wrong.status).toBe(405);
      expect(wrong.body).toMatchObject(ERROR_SHAPE);
    });
  },
);

test(
  "a malformed or wrongly typed body answers a JSON error",
  {
    tag: "@smoke",
    annotation: about(
      "The HTTP layer's own refusals use the same error shape as the API: broken JSON, a missing content type, a field of the wrong type and an empty object each get REQUEST_INVALID.",
    ),
  },
  async ({ request }) => {
    await step("POST /auth/login with a body that isn't JSON is a 400", async () => {
      const res = await request.post("/api/v1/auth/login", {
        headers: JSON_HEADERS,
        data: Buffer.from("{"),
      });
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({
        success: false,
        error: { REQUEST_INVALID: expect.any(String) },
      });
    });
    await step("POST /auth/login without a JSON content type is a 415", async () => {
      const res = await request.post("/api/v1/auth/login", {
        headers: { "content-type": "text/plain" },
        data: "email=a",
      });
      expect(res.status()).toBe(415);
      expect(Object.keys((await res.json()).error)).toEqual(["REQUEST_INVALID"]);
    });
    await step("POST /auth/login with a number for the email is a 422", async () => {
      const res = await request.post("/api/v1/auth/login", {
        headers: JSON_HEADERS,
        data: Buffer.from(JSON.stringify({ email: 1, password: "x" })),
      });
      expect(res.status()).toBe(422);
      expect(Object.keys((await res.json()).error)).toEqual(["REQUEST_INVALID"]);
    });
    await step("POST /auth/login with no fields is a 422", async () => {
      const res = await request.post("/api/v1/auth/login", {
        headers: JSON_HEADERS,
        data: Buffer.from("{}"),
      });
      expect(res.status()).toBe(422);
      expect(Object.keys((await res.json()).error)).toEqual(["REQUEST_INVALID"]);
    });
  },
);

test(
  "a body over 3 MB is refused with a JSON 413",
  {
    tag: ["@smoke", "@security"],
    annotation: about(
      "Request bodies are limited to 3 MB. A body just over the limit answers 413 in the error shape and a body just under it gets as far as the route's own validation.",
    ),
  },
  async ({ request }) => {
    const limit = 3 * 1024 * 1024;
    await step("POST /auth/login with a body of 3 MB plus one byte is a 413", async () => {
      const res = await request.post("/api/v1/auth/login", {
        headers: JSON_HEADERS,
        data: Buffer.alloc(limit + 1, "a"),
      });
      expect(res.status()).toBe(413);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect(res.headers()["x-request-id"]).toBeTruthy();
      expect(await res.json()).toMatchObject({
        success: false,
        error: { REQUEST_INVALID: expect.any(String) },
      });
    });
    await step("A valid JSON body of 2.5 MB is read and judged by the route", async () => {
      const res = await request.post("/api/v1/auth/login", {
        headers: JSON_HEADERS,
        data: Buffer.from(
          JSON.stringify({
            email: "nobody@dopbase.com",
            password: "a".repeat(2.5 * 1024 * 1024),
          }),
        ),
      });
      expect(res.status()).not.toBe(413);
      expect((await res.json()).success).toBe(false);
    });
  },
);

test(
  "every response carries the hardening headers and a request ID",
  {
    tag: ["@smoke", "@security"],
    annotation: about(
      "API answers, errors, the key set, the console page and a 404 all tell the browser not to guess types, not to frame the page and to send no referrer. Only API answers say no-store, and each answer has a request ID to find it in the server log.",
    ),
  },
  async ({ request }) => {
    const csp =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'";
    const hardened = (headers: Record<string, string>) => {
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["content-security-policy"]).toBe(csp);
      expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    };
    const health = await step("GET /health", () => app.api.get("/health"));
    await step("The API answer has every header and is not cacheable", async () => {
      hardened(health.headers);
      expect(health.headers["cache-control"]).toBe("no-store");
    });
    await step("An API error has them too", async () => {
      const unauthorized = await app.api.get("/admin/users", { record: false });
      expect(unauthorized.status).toBe(401);
      hardened(unauthorized.headers);
      expect(unauthorized.headers["cache-control"]).toBe("no-store");
    });
    await step("The key set keeps its own cache rule", async () => {
      const jwks = await app.api.get("/.well-known/jwks.json", { record: false });
      hardened(jwks.headers);
      expect(jwks.headers["cache-control"]).toBe("public, max-age=300");
    });
    await step("The console page has the hardening headers and no no-store", async () => {
      const page = await request.get("/");
      expect(page.status()).toBe(200);
      hardened(page.headers());
      expect(page.headers()["cache-control"]).toBe("no-cache");
    });
    await step("A missing asset has them as well", async () => {
      const missing = await request.get("/assets/missing.js");
      expect(missing.status()).toBe(404);
      hardened(missing.headers());
    });
    await step("Two answers get two different request IDs", async () => {
      const again = await app.api.get("/health", { record: false });
      expect(again.headers["x-request-id"]).not.toBe(
        health.headers["x-request-id"],
      );
    });
    await step("A request ID the caller sends comes back unchanged", async () => {
      const echoed = await app.api.get("/health", {
        record: false,
        headers: { "x-request-id": "e2e-request-1234" },
      });
      expect(echoed.headers["x-request-id"]).toBe("e2e-request-1234");
    });
  },
);

test(
  "the console is served at / and at deep links",
  {
    tag: "@smoke",
    annotation: about(
      "The binary carries the console. Any address that isn't an API route gets the same HTML shell so the router can take over. The shell is revalidated on every load.",
    ),
  },
  async ({ request }) => {
    for (const path of ["/", "/users/usr_x", "/settings/signing-keys", "/setup"]) {
      await step(`GET ${path} returns the console shell`, async () => {
        const res = await request.get(path);
        expect(res.status()).toBe(200);
        expect(res.headers()["content-type"]).toContain("text/html");
        expect(res.headers()["cache-control"]).toBe("no-cache");
        const html = await res.text();
        expect(html).toContain("<title>Dopgate</title>");
        expect(html).toContain('<div id="app"></div>');
      });
    }
    await step("A path with an unknown extension is still a page", async () => {
      const res = await request.get("/files/report.html");
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/html");
    });
  },
);

test(
  "built assets are cached for a year and a missing asset is a 404, not the page",
  {
    tag: "@smoke",
    annotation: about(
      "Files the shell points at are served with their type and an immutable year-long cache. A script, stylesheet or font that doesn't exist is a plain 404 in the error shape and never the HTML shell, which would show up as a silently blank page.",
    ),
  },
  async ({ request }) => {
    const html = await step("GET / and read the asset links", async () =>
      (await request.get("/")).text(),
    );
    const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    const style = html.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    await step("The shell links a script and a stylesheet under /assets", async () => {
      expect(script).toBeTruthy();
      expect(style).toBeTruthy();
    });
    await step("The script is JavaScript with an immutable cache", async () => {
      const res = await request.get(script!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/javascript/);
      expect(res.headers()["cache-control"]).toBe(
        "public, max-age=31536000, immutable",
      );
    });
    await step("The stylesheet is CSS with an immutable cache", async () => {
      const res = await request.get(style!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/css");
      expect(res.headers()["cache-control"]).toBe(
        "public, max-age=31536000, immutable",
      );
    });
    for (const path of [
      "/assets/x.js",
      "/assets/x.css",
      "/assets/x.js.map",
      "/assets/vendor.min.js",
      "/assets/font.woff2",
      "/missing.png",
    ]) {
      await step(`GET ${path} is a 404 and not the shell`, async () => {
        const res = await request.get(path);
        expect(res.status()).toBe(404);
        const text = await res.text();
        expect(text).not.toContain("<!doctype html>");
        expect(JSON.parse(text)).toMatchObject({ success: false });
      });
    }
  },
);
