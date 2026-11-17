import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";

// No root yet: the instance waits for its one-time setup token.
const app = useServer({ root: false, serviceKey: false, relaxLimits: false });

const ROOT = "/bootstrap/root";
const WRONG_TOKEN = "setup_not-the-token";

test(
  "a new instance reports it is not set up and prints its setup token",
  {
    tag: ["@smoke", "@setup"],
    annotation: about(
      "Without DOPGATE_ROOT_EMAIL the server starts with no root account. The status route says so without signing in, and the log carries a one-time setup token with the address of the setup page and a curl command to use it.",
    ),
  },
  async ({ request }) => {
    await step("GET /bootstrap/status with no credentials", async () => {
      const status = await app.api.get("/bootstrap/status");
      expect(status.status).toBe(200);
      expect(status.message).toBe("BOOTSTRAP_STATUS_FETCHED");
      expect(status.data).toEqual({ initialized: false });
    });
    const token = await step("Read the setup token from the log", () =>
      app.server.setupToken(),
    );
    await step("It starts with setup_ and is long enough to be unguessable", async () => {
      expect(token).toMatch(/^setup_[A-Za-z0-9_-]{30,}$/);
    });
    await step("The log explains what to do with it", async () => {
      const log = await app.server.log();
      expect(log).toContain("No root account yet.");
      expect(log).toContain("DOPGATE_ROOT_EMAIL");
      expect(log).toContain("dopgate init");
      expect(log).toContain(`Open ${app.url}/setup and paste it there`);
      expect(log).toContain(`curl -X POST ${app.url}/api/v1/bootstrap/root`);
      expect(log).toContain(`"setupToken":"${token}"`);
    });
    await step("The console's /setup page is served", async () => {
      const page = await request.get("/setup");
      expect(page.status()).toBe(200);
      expect(await page.text()).toContain("<title>Dopgate</title>");
    });
  },
);

test(
  "the setup token is checked before anything else",
  {
    tag: ["@setup", "@security"],
    annotation: about(
      "A wrong token is refused with SETUP_TOKEN_INVALID even when the email and password are fine, and a request that is missing fields is a plain REQUEST_INVALID. Neither creates anything.",
    ),
  },
  async () => {
    await step("POST /bootstrap/root with a wrong token is a 401", async () => {
      const refused = await app.api.post(ROOT, {
        setupToken: WRONG_TOKEN,
        email: ROOT_EMAIL,
        password: PASSWORD,
      });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("SETUP_TOKEN_INVALID");
      expect(refused.body.error.SETUP_TOKEN_INVALID).toContain("setup token");
    });
    await step("A wrong token with a bad email is still about the token", async () => {
      const refused = await app.api.post(
        ROOT,
        { setupToken: WRONG_TOKEN, email: "not-an-email", password: "x" },
        { record: false },
      );
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("SETUP_TOKEN_INVALID");
    });
    await step("A body without the token is a 422 REQUEST_INVALID", async () => {
      const refused = await app.api.post(
        ROOT,
        { email: ROOT_EMAIL, password: PASSWORD },
        { record: false },
      );
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("The instance is still not set up", async () => {
      const status = await app.api.get("/bootstrap/status", { record: false });
      expect(status.data.initialized).toBe(false);
    });
  },
);

test(
  "a refused email or password leaves the setup token usable",
  {
    tag: ["@setup"],
    annotation: about(
      "With the right token, an email that isn't an address answers EMAIL_INVALID and a short or oversized password answers PASSWORD_INVALID, both 422. Nothing is created and the same token still works afterwards.",
    ),
  },
  async () => {
    const setupToken = await app.server.setupToken();
    await step("POST /bootstrap/root with an email that isn't one is a 422", async () => {
      const refused = await app.api.post(ROOT, {
        setupToken,
        email: "not-an-email",
        password: PASSWORD,
      });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("EMAIL_INVALID");
    });
    await step("A password under 8 characters is a 422 PASSWORD_INVALID", async () => {
      const refused = await app.api.post(ROOT, {
        setupToken,
        email: ROOT_EMAIL,
        password: "short",
      });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("PASSWORD_INVALID");
      expect(refused.body.error.PASSWORD_INVALID).toMatch(/8/);
    });
    await step("A password over 1024 bytes is a 422 PASSWORD_INVALID too", async () => {
      const refused = await app.api.post(
        ROOT,
        { setupToken, email: ROOT_EMAIL, password: "a".repeat(1025) },
        { record: false },
      );
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("PASSWORD_INVALID");
    });
    await step("The instance is still not set up and the token is the same", async () => {
      const status = await app.api.get("/bootstrap/status", { record: false });
      expect(status.data.initialized).toBe(false);
      expect(await app.server.setupToken()).toBe(setupToken);
    });
  },
);

test(
  "the setup token creates root once and cannot be used again",
  {
    tag: ["@smoke", "@setup"],
    annotation: about(
      "The right token creates the root account: 201 ROOT_CREATED with its ID and the email in lowercase. The status flips to initialized, the audit log records the setup, root can sign in to the console, and the token is spent.",
    ),
  },
  async () => {
    const setupToken = await app.server.setupToken();
    const created = await step("POST /bootstrap/root with the right token and a messy email", () =>
      app.api.post(ROOT, {
        // The token is trimmed and the email is cleaned up.
        setupToken: ` ${setupToken} `,
        email: ` ${ROOT_EMAIL.toUpperCase()} `,
        password: PASSWORD,
      }),
    );
    await step("It answers 201 ROOT_CREATED with an adm_ ID and the clean email", async () => {
      expect(created.status).toBe(201);
      expect(created.message).toBe("ROOT_CREATED");
      expect(created.data.adminId).toMatch(/^adm_/);
      expect(created.data.email).toBe(ROOT_EMAIL);
    });
    await step("GET /bootstrap/status now says initialized", async () => {
      const status = await app.api.get("/bootstrap/status", { record: false });
      expect(status.data).toEqual({ initialized: true });
    });
    await step("The same token answers 409 ALREADY_INITIALIZED", async () => {
      const again = await app.api.post(ROOT, {
        setupToken,
        email: "other@dopbase.com",
        password: PASSWORD,
      });
      expect(again.status).toBe(409);
      expect(again.code).toBe("ALREADY_INITIALIZED");
    });
    await step("So does a wrong token, without counting as a guess", async () => {
      const again = await app.api.post(
        ROOT,
        { setupToken: WRONG_TOKEN, email: "other@dopbase.com", password: PASSWORD },
        { record: false },
      );
      expect(again.status).toBe(409);
      expect(again.code).toBe("ALREADY_INITIALIZED");
    });
    await step("POST /console/login signs root in with the new password", async () => {
      const signedIn = await app.api.post("/console/login", {
        email: ROOT_EMAIL,
        password: PASSWORD,
      });
      expect(signedIn.status).toBe(200);
      expect(signedIn.data.admin).toMatchObject({
        id: created.data.adminId,
        email: ROOT_EMAIL,
        role: "root",
      });
    });
    await step("The audit log has one instance.initialized event from setup", async () => {
      const root = await app.root();
      const events = await root.api.get("/admin/audit-events?action=instance.initialized", {
        record: false,
      });
      expect(events.status).toBe(200);
      expect(events.data.items).toHaveLength(1);
      expect(events.data.items[0]).toMatchObject({
        actorType: "system",
        actorLabel: "setup",
        resourceType: "admin",
        resourceId: created.data.adminId,
        metadata: { email: ROOT_EMAIL },
      });
    });
    await step("The server log never holds the password", async () => {
      const log = await app.server.log();
      expect(log).not.toContain(PASSWORD);
    });
  },
);
