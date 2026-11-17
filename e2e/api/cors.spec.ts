import { about, expect, step, test, useServer } from "../harness/index.ts";

const ALLOWED = "https://app.example.com";
const SECOND = "https://admin.example.com:8443";

const app = useServer({
  env: { DOPGATE_ALLOWED_ORIGINS: `${ALLOWED}, ${SECOND}/` },
});

function preflight(origin: string, method = "POST", headers = "content-type") {
  return app.api.send("OPTIONS", "/auth/login", undefined, {
    record: false,
    headers: {
      origin,
      "access-control-request-method": method,
      "access-control-request-headers": headers,
    },
  });
}

test(
  "a preflight from an allowed origin gets the CORS answer",
  {
    tag: ["@smoke", "@security"],
    annotation: about(
      "A browser app on a listed origin asks permission before it calls the API. Dopgate answers with that origin, the five methods, the two headers apps send, and a ten minute cache. It never allows credentials.",
    ),
  },
  async () => {
    const answer = await step("OPTIONS /auth/login from https://app.example.com", () =>
      preflight(ALLOWED, "POST", "content-type, authorization"),
    );
    await step("The origin is allowed and the answer is cached for 600 seconds", async () => {
      expect(answer.status).toBe(200);
      expect(answer.headers["access-control-allow-origin"]).toBe(ALLOWED);
      expect(answer.headers["access-control-max-age"]).toBe("600");
      expect(answer.headers.vary).toContain("origin");
    });
    await step("It lists GET, POST, PUT, PATCH and DELETE", async () => {
      const methods = answer.headers["access-control-allow-methods"]
        .split(",")
        .map((method) => method.trim());
      expect(methods.sort()).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
    });
    await step("It allows Authorization and Content-Type and nothing else", async () => {
      const headers = answer.headers["access-control-allow-headers"]
        .split(",")
        .map((header) => header.trim().toLowerCase());
      expect(headers.sort()).toEqual(["authorization", "content-type"]);
    });
    await step("It doesn't allow credentials", async () => {
      expect(answer.headers["access-control-allow-credentials"]).toBeUndefined();
    });
  },
);

test(
  "a second origin in the list is allowed, with its port",
  {
    tag: "@security",
    annotation: about(
      "DOPGATE_ALLOWED_ORIGINS takes several comma-separated origins. Spaces around an entry and a trailing slash are dropped, and the port is part of the origin.",
    ),
  },
  async () => {
    await step("OPTIONS from https://admin.example.com:8443 is allowed", async () => {
      const answer = await preflight(SECOND);
      expect(answer.headers["access-control-allow-origin"]).toBe(SECOND);
    });
    await step("The same host on the default port is not", async () => {
      const answer = await preflight("https://admin.example.com");
      expect(answer.headers["access-control-allow-origin"]).toBeUndefined();
    });
  },
);

test(
  "a simple request from an allowed origin carries the CORS headers",
  {
    tag: ["@smoke", "@security"],
    annotation: about(
      "A request that needs no preflight still gets the allow-origin header, and the browser may read Retry-After and X-Request-ID from the answer.",
    ),
  },
  async () => {
    const health = await step("GET /health with Origin https://app.example.com", () =>
      app.api.get("/health", { headers: { origin: ALLOWED } }),
    );
    await step("The answer allows that origin and no credentials", async () => {
      expect(health.status).toBe(200);
      expect(health.headers["access-control-allow-origin"]).toBe(ALLOWED);
      expect(health.headers["access-control-allow-credentials"]).toBeUndefined();
    });
    await step("It exposes Retry-After and X-Request-ID", async () => {
      const exposed = health.headers["access-control-expose-headers"]
        .split(",")
        .map((header) => header.trim().toLowerCase());
      expect(exposed.sort()).toEqual(["retry-after", "x-request-id"]);
    });
    await step("An error answer carries the same headers", async () => {
      const denied = await app.api.get("/admin/users", {
        headers: { origin: ALLOWED },
        record: false,
      });
      expect(denied.status).toBe(401);
      expect(denied.headers["access-control-allow-origin"]).toBe(ALLOWED);
    });
  },
);

test(
  "another origin gets no CORS headers",
  {
    tag: ["@smoke", "@security"],
    annotation: about(
      "An origin that isn't listed gets nothing to read the answer with, so the browser blocks it. That holds for a different host, a different scheme, a subdomain and the null origin, on both preflight and simple requests.",
    ),
  },
  async () => {
    for (const origin of [
      "https://evil.example.com",
      "http://app.example.com",
      "https://sub.app.example.com",
      "https://app.example.com.evil.test",
      "null",
    ]) {
      await step(`OPTIONS from ${origin} gets no allow-origin`, async () => {
        const answer = await preflight(origin);
        expect(answer.headers["access-control-allow-origin"]).toBeUndefined();
      });
    }
    await step("GET /health from an unlisted origin still answers, without the header", async () => {
      const health = await app.api.get("/health", {
        headers: { origin: "https://evil.example.com" },
        record: false,
      });
      expect(health.status).toBe(200);
      expect(health.headers["access-control-allow-origin"]).toBeUndefined();
    });
  },
);

test(
  "the backend key and visitor headers are not on the allowed list",
  {
    tag: "@security",
    annotation: about(
      "Only servers send X-Dopgate-Backend-Key, X-Dopgate-Client-IP and X-Dopgate-Client-Agent. A page in a browser can't ask permission to send them, so it can't pick the address its limits are counted against.",
    ),
  },
  async () => {
    const answer = await step(
      "OPTIONS from the allowed origin asking for x-dopgate-client-ip",
      () => preflight(ALLOWED, "POST", "content-type, x-dopgate-client-ip, x-dopgate-backend-key"),
    );
    await step("The allowed headers don't include any x-dopgate header", async () => {
      const allowed = answer.headers["access-control-allow-headers"] ?? "";
      expect(allowed).not.toContain("x-dopgate");
      expect(allowed.toLowerCase()).toContain("authorization");
    });
  },
);

test(
  "a request with no Origin header gets no CORS headers",
  {
    tag: "@security",
    annotation: about(
      "A call that sends no Origin, such as the console on its own origin or a backend, gets no allow-origin header, whatever the list says.",
    ),
  },
  async () => {
    await step("GET /health with no Origin has no allow-origin header", async () => {
      const health = await app.api.get("/health", { record: false });
      expect(health.status).toBe(200);
      expect(health.headers["access-control-allow-origin"]).toBeUndefined();
    });
  },
);
