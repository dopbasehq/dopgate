import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ApiClient } from "../harness/api.ts";
import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { startServer, startServerIn } from "../harness/server.ts";

// The harness sets DOPGATE_ROOT_PASSWORD whenever it creates root. Without
// root, the email alone makes the server pick and print a password.
const OWNER = `owner-${Math.random().toString(16).slice(2, 8)}@example.com`;
const app = useServer({
  root: false,
  env: { DOPGATE_ROOT_EMAIL: ` ${OWNER.toUpperCase()} ` },
});

// The generated password sits on a line of its own after "Password: ".
function printedPassword(log: string): string | undefined {
  return log.match(/^Password: (\S+)$/m)?.[1];
}

async function signIn(url: string, email: string, password: string) {
  const api = await ApiClient.create(url, "root", []);
  try {
    return await api.post("/console/login", { email, password }, { record: false });
  } finally {
    await api.dispose();
  }
}

test(
  "DOPGATE_ROOT_EMAIL alone creates root with a generated password, shown once",
  {
    tag: ["@smoke", "@setup"],
    annotation: about(
      "On an instance without root, setting only DOPGATE_ROOT_EMAIL makes startup create root and print a generated password in the log. The email is cleaned up, no setup token is offered, and the printed password signs root in.",
    ),
  },
  async () => {
    const log = await step("Read the startup log", () => app.server.log());
    const password = printedPassword(log);
    await step("It says root was created for the cleaned-up email, and shows the password once", async () => {
      expect(log).toContain(`Root account created for ${OWNER}.`);
      expect(password).toBeTruthy();
      expect(password!.length).toBeGreaterThanOrEqual(16);
      expect(log.match(/^Password: /gm)).toHaveLength(1);
      expect(log).toContain("This password is shown once.");
    });
    await step("No setup token is printed", async () => {
      expect(log).not.toContain("No root account yet.");
      expect(log).not.toMatch(/^setup_\S+$/m);
      await expect(app.server.setupToken()).rejects.toThrow("no setup token");
    });
    await step("GET /bootstrap/status says initialized", async () => {
      const status = await app.api.get("/bootstrap/status");
      expect(status.data).toEqual({ initialized: true });
    });
    await step("POST /bootstrap/root answers ALREADY_INITIALIZED, whatever the token", async () => {
      const refused = await app.api.post("/bootstrap/root", {
        setupToken: "setup_anything",
        email: "other@example.com",
        password: PASSWORD,
      });
      expect(refused.status).toBe(409);
      expect(refused.code).toBe("ALREADY_INITIALIZED");
    });
    await step("POST /console/login with the printed password signs root in", async () => {
      const signedIn = await app.api.post("/console/login", {
        email: OWNER,
        password: password!,
      });
      expect(signedIn.status).toBe(200);
      expect(signedIn.data.admin).toMatchObject({ email: OWNER, role: "root" });
    });
    await step("The audit log records the setup as the system, without the password", async () => {
      const events = await app.service.get("/admin/audit-events?action=instance.initialized", {
        record: false,
      });
      expect(events.data.items).toHaveLength(1);
      expect(events.data.items[0]).toMatchObject({
        actorType: "system",
        actorLabel: "setup",
        metadata: { email: OWNER },
      });
      const all = await app.service.get("/admin/audit-events?limit=200", {
        record: false,
      });
      expect(JSON.stringify(all.data)).not.toContain(password!);
    });
  },
);

test(
  "a restart on the same data neither prints nor changes the password",
  {
    tag: ["@setup"],
    annotation: about(
      "DOPGATE_ROOT_EMAIL only matters while no root exists. Starting the server again with it still set prints no password and no setup token, leaves the old password working and creates no second root.",
    ),
  },
  async () => {
    const original = printedPassword(await app.server.log());
    await step("Stop the first server", () => app.server.halt());
    const restartedDir = join(app.server.root, "restart");
    await mkdir(restartedDir, { recursive: true });
    const restarted = await step("Start another server on the same schema with the same email", () =>
      startServerIn(restartedDir, app.server.schema, {
        root: false,
        env: { DOPGATE_ROOT_EMAIL: OWNER },
      }),
    );
    try {
      await step("Its log has no created message, no password and no setup token", async () => {
        const log = await restarted.log();
        expect(log).toContain("Dopgate server started");
        expect(log).not.toContain("Root account created");
        expect(log).not.toContain("Password:");
        expect(log).not.toContain("No root account yet.");
        expect(log).not.toContain(original!);
      });
      await step("The password printed the first time still signs root in", async () => {
        const signedIn = await signIn(restarted.url, OWNER, original!);
        expect(signedIn.status).toBe(200);
        expect(signedIn.data.admin.role).toBe("root");
      });
      await step("There is still one admin, root", async () => {
        const api = await ApiClient.create(restarted.url, "service", [], restarted.serviceKey);
        try {
          const admins = await api.get("/admin/admins", { record: false });
          expect(admins.status).toBe(200);
          expect(admins.data.items).toHaveLength(1);
          expect(admins.data.items[0]).toMatchObject({ email: OWNER, role: "root" });
        } finally {
          await api.dispose();
        }
      });
    } finally {
      await restarted.halt();
    }
  },
);

test(
  "with DOPGATE_ROOT_PASSWORD set too, nothing is printed",
  {
    tag: ["@setup"],
    annotation: about(
      "Choosing the password with DOPGATE_ROOT_PASSWORD means there is nothing to show. The log says nothing about root's password, no setup token is offered, and the chosen password works.",
    ),
  },
  async () => {
    // The harness default: root email and password in the environment.
    const server = await step("Start a server with both variables set", () => startServer());
    try {
      await step("Its log has no password, no created message and no setup token", async () => {
        const log = await server.log();
        expect(log).toContain("Dopgate server started");
        expect(log).not.toContain("Password:");
        expect(log).not.toContain("Root account created");
        expect(log).not.toContain("No root account yet.");
        expect(log).not.toContain(PASSWORD);
      });
      await step("The chosen password signs root in", async () => {
        const signedIn = await signIn(server.url, ROOT_EMAIL, PASSWORD);
        expect(signedIn.status).toBe(200);
        expect(signedIn.data.admin).toMatchObject({ email: ROOT_EMAIL, role: "root" });
      });
    } finally {
      await server.stop();
    }
  },
);
