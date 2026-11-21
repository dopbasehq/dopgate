import { about, expect, step, test, useServer } from "../harness/index.ts";

const app = useServer();
const quiet = { record: false } as const;

// None of these routes is in the OpenAPI document, so they don't count toward
// coverage: every call here is made with record: false.

test(
  "the authenticator app routes answer 501 once the caller is signed in",
  {
    tag: ["@smoke", "@security"],
    annotation: about(
      "Multi-factor sign-in is planned. Its routes check the bearer token and the request body first, then answer 501 NOT_IMPLEMENTED. Without a token, the three authenticator app routes answer 401.",
    ),
  },
  async () => {
    const user = await app.user("ana");
    const routes: [string, string, unknown][] = [
      ["POST", "/auth/mfa/totp/enroll", undefined],
      ["POST", "/auth/mfa/totp/verify", { code: "123456" }],
      ["DELETE", "/auth/mfa/totp", { code: "123456" }],
    ];
    for (const [method, path, body] of routes) {
      await step(`${method} ${path} with no token is a 401`, async () => {
        const refused = await app.api.send(method, path, body ?? {}, quiet);
        expect(refused.status).toBe(401);
        expect(refused.code).toBe("AUTHENTICATION_REQUIRED");
      });
      await step(`${method} ${path} with a user's token is a 501`, async () => {
        const planned = await user.api.send(method, path, body ?? {}, quiet);
        expect(planned.status).toBe(501);
        expect(planned.code).toBe("NOT_IMPLEMENTED");
        expect(planned.body.success).toBe(false);
      });
    }
    await step("POST /auth/mfa/totp/verify with no code is a 422 before it gets to 501", async () => {
      const refused = await user.api.post("/auth/mfa/totp/verify", {}, quiet);
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("Any valid token is let through to the 501, a console token included", async () => {
      const root = await app.root();
      const planned = await root.api.post("/auth/mfa/totp/enroll", {}, quiet);
      expect(planned.status).toBe(501);
      expect(planned.code).toBe("NOT_IMPLEMENTED");
    });
  },
);

test(
  "the MFA challenge and the sign-in provider routes answer 501 to anyone",
  {
    tag: ["@smoke"],
    annotation: about(
      "The public multi-factor and single sign-on routes need no token. A well-formed request gets 501 NOT_IMPLEMENTED, and one with a missing field or query is refused as a bad request first.",
    ),
  },
  async () => {
    await step("POST /auth/mfa/challenge with a token and a code is a 501", async () => {
      const planned = await app.api.post(
        "/auth/mfa/challenge",
        { mfaToken: "mfa_x", code: "123456" },
        quiet,
      );
      expect(planned.status).toBe(501);
      expect(planned.code).toBe("NOT_IMPLEMENTED");
    });
    await step("POST /auth/mfa/challenge with no fields is a 422", async () => {
      const refused = await app.api.post("/auth/mfa/challenge", {}, quiet);
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("GET /auth/sso/providers is a 501", async () => {
      const planned = await app.api.get("/auth/sso/providers", quiet);
      expect(planned.status).toBe(501);
      expect(planned.code).toBe("NOT_IMPLEMENTED");
    });
    await step("GET /auth/sso/{provider}/start with a redirect URL is a 501", async () => {
      const planned = await app.api.get(
        "/auth/sso/sso_x/start?redirectUrl=https%3A%2F%2Fapp.example.com%2Fdone",
        quiet,
      );
      expect(planned.status).toBe(501);
      expect(planned.code).toBe("NOT_IMPLEMENTED");
    });
    await step("GET /auth/sso/{provider}/start without one is a 400", async () => {
      const refused = await app.api.get("/auth/sso/sso_x/start", quiet);
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("GET /auth/sso/callback is a 501", async () => {
      const planned = await app.api.get("/auth/sso/callback?code=abc&state=def", quiet);
      expect(planned.status).toBe(501);
      expect(planned.code).toBe("NOT_IMPLEMENTED");
    });
    await step("POST /auth/sso/exchange with a handoff code is a 501", async () => {
      const planned = await app.api.post("/auth/sso/exchange", { handoffCode: "x" }, quiet);
      expect(planned.status).toBe(501);
      expect(planned.code).toBe("NOT_IMPLEMENTED");
    });
    await step("POST /auth/sso/exchange with no handoff code is a 422", async () => {
      const refused = await app.api.post("/auth/sso/exchange", {}, quiet);
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
  },
);

test(
  "the provider admin routes check the caller, then answer 501",
  {
    tag: ["@security"],
    annotation: about(
      "Managing single sign-on providers needs an admin or the service key. Everyone else is refused as for any admin route, and an admin gets 501 NOT_IMPLEMENTED.",
    ),
  },
  async () => {
    const sam = await app.admin("sam");
    const user = await app.user("ana");
    const provider = {
      preset: "google",
      issuer: "https://accounts.google.com",
      clientId: "client",
      clientSecret: "secret",
    };
    const routes: [string, string, unknown][] = [
      ["GET", "/admin/sso/providers", undefined],
      ["POST", "/admin/sso/providers", provider],
      ["GET", "/admin/sso/providers/sso_x", undefined],
      ["PATCH", "/admin/sso/providers/sso_x", { enabled: true }],
      ["DELETE", "/admin/sso/providers/sso_x", undefined],
    ];
    for (const [method, path, body] of routes) {
      await step(`${method} ${path} with no token is a 401`, async () => {
        const refused = await app.api.send(method, path, body, quiet);
        expect(refused.status).toBe(401);
        expect(refused.code).toBe("AUTHENTICATION_REQUIRED");
      });
      await step(`${method} ${path} with a user's token is a 403`, async () => {
        const refused = await user.api.send(method, path, body, quiet);
        expect(refused.status).toBe(403);
        expect(refused.code).toBe("AUTHORIZATION_DENIED");
      });
      await step(`${method} ${path} as an admin is a 501`, async () => {
        const planned = await sam.api.send(method, path, body, quiet);
        expect(planned.status).toBe(501);
        expect(planned.code).toBe("NOT_IMPLEMENTED");
      });
      await step(`${method} ${path} with the service key is a 501`, async () => {
        const planned = await app.service.send(method, path, body, quiet);
        expect(planned.status).toBe(501);
        expect(planned.code).toBe("NOT_IMPLEMENTED");
      });
    }
  },
);

test(
  "the provider presets work and name the common providers",
  {
    tag: ["@smoke", "@settings"],
    annotation: about(
      "GET /admin/sso/presets already works for an admin and the service key. It lists templates for common providers with the issuer and a setup hint. It is left out of the API docs with the rest of single sign-on.",
    ),
  },
  async () => {
    const sam = await app.admin("sam");
    const user = await app.user("ana");
    const presets = await step("GET /admin/sso/presets as an admin", () =>
      sam.api.get("/admin/sso/presets", quiet),
    );
    await step("It answers 200 SSO_PRESETS_FETCHED with a list", async () => {
      expect(presets.status).toBe(200);
      expect(presets.message).toBe("SSO_PRESETS_FETCHED");
      expect(Array.isArray(presets.data)).toBe(true);
      expect(presets.data.length).toBeGreaterThanOrEqual(2);
    });
    await step("Google is there with its issuer and a hint", async () => {
      const google = presets.data.find((preset: { id: string }) => preset.id === "google");
      expect(google).toMatchObject({
        id: "google",
        label: "Google",
        buttonLabel: "Google",
        issuer: "https://accounts.google.com",
      });
      expect(google.hint).toEqual(expect.any(String));
    });
    await step("Every preset has the five documented fields", async () => {
      for (const preset of presets.data) {
        expect(Object.keys(preset).sort()).toEqual(
          ["buttonLabel", "hint", "id", "issuer", "label"],
        );
      }
    });
    await step("The service key gets the same list", async () => {
      const asService = await app.service.get("/admin/sso/presets", quiet);
      expect(asService.status).toBe(200);
      expect(asService.data).toEqual(presets.data);
    });
    await step("No token is a 401 and a user's token a 403", async () => {
      const anonymous = await app.api.get("/admin/sso/presets", quiet);
      expect(anonymous.status).toBe(401);
      const asUser = await user.api.get("/admin/sso/presets", quiet);
      expect(asUser.status).toBe(403);
      expect(asUser.code).toBe("AUTHORIZATION_DENIED");
    });
  },
);
