import { about, expect, step, test, useServer } from "../harness/index.ts";

const app = useServer({ docs: false, webUi: false });

test(
  "with the docs off, the OpenAPI document and Swagger UI are gone",
  {
    tag: "@smoke",
    annotation: about(
      "DOPGATE_DOCS=false takes the OpenAPI document and Swagger UI off the server. Both answer a JSON 404, and the paths aren't handed to the console.",
    ),
  },
  async ({ request }) => {
    for (const path of ["/api/v1/openapi.json", "/api/docs", "/api/docs/"]) {
      await step(`GET ${path} is a JSON 404`, async () => {
        const res = await request.get(path, { maxRedirects: 0 });
        expect(res.status()).toBe(404);
        expect(res.headers()["content-type"]).toContain("application/json");
        expect(await res.json()).toMatchObject({
          success: false,
          error: { REQUEST_INVALID: expect.any(String) },
        });
      });
    }
  },
);

test(
  "with the console off, no page is served",
  {
    tag: "@smoke",
    annotation: about(
      "DOPGATE_WEB_UI=false makes the server API only. The root and every deep link answer a JSON 404 instead of the HTML shell, and so does a built asset.",
    ),
  },
  async ({ request }) => {
    for (const path of ["/", "/users/usr_x", "/setup", "/assets/index.js"]) {
      await step(`GET ${path} is a JSON 404`, async () => {
        const res = await request.get(path);
        expect(res.status()).toBe(404);
        expect(res.headers()["content-type"]).toContain("application/json");
        const text = await res.text();
        expect(text).not.toContain("<html");
        expect(JSON.parse(text)).toMatchObject({
          success: false,
          error: { REQUEST_INVALID: expect.any(String) },
        });
      });
    }
    await step("The answer still carries the hardening headers", async () => {
      const res = await request.get("/");
      expect(res.headers()["x-frame-options"]).toBe("DENY");
      expect(res.headers()["x-request-id"]).toBeTruthy();
    });
  },
);

test(
  "the API keeps working with the docs and the console off",
  {
    tag: "@smoke",
    annotation: about(
      "Switching the extras off doesn't touch the API: health, the key set, the discovery document and the admin API still answer.",
    ),
  },
  async () => {
    await step("GET /health answers 200", async () => {
      const health = await app.api.get("/health");
      expect(health.status).toBe(200);
      expect(health.data.status).toBe("ok");
    });
    await step("GET /.well-known/jwks.json lists the active key", async () => {
      const jwks = await app.api.get("/.well-known/jwks.json", { record: false });
      expect(jwks.status).toBe(200);
      expect(jwks.body.keys).toHaveLength(1);
    });
    await step("GET /admin/keys answers the service key", async () => {
      const keys = await app.service.get("/admin/keys", { record: false });
      expect(keys.status).toBe(200);
      expect(keys.message).toBe("SIGNING_KEYS_FETCHED");
    });
    await step("An unknown API route is still a 404 about the API", async () => {
      const missing = await app.api.get("/no-such-route", { record: false });
      expect(missing.status).toBe(404);
      expect(missing.body.error.REQUEST_INVALID).toContain("API route");
    });
  },
);

test(
  "the server log lists no console or docs address",
  {
    tag: "@smoke",
    annotation: about(
      "The startup banner only advertises what is on. With both switches off it has no Console line, no API docs line and the setup hint doesn't send anyone to /setup.",
    ),
  },
  async () => {
    const log = await step("Read the server log", () => app.server.log());
    await step("The banner has the API and JWKS but no Console or API docs row", async () => {
      expect(log).toContain(`API:        ${app.url}/api/v1`);
      expect(log).toContain(`JWKS:       ${app.url}/.well-known/jwks.json`);
      expect(log).not.toContain("Console:");
      expect(log).not.toContain("API docs:");
    });
  },
);
