import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";

// Every case runs against the file's own server while it is up, the way an
// operator would recover an account on a live instance.
const app = useServer();

const lastLine = (text: string) => text.trim().split("\n").at(-1) ?? "";

/** Asks the console to sign in, without asserting the answer. */
async function consoleSignIn(email: string, password: string) {
  const api = await app.newApi("sign-in-check");
  return api.signIn("/console/login", email, password, { record: false });
}

test(
  "admin reset-password gives root a new password while the server is running",
  {
    tag: ["@smoke", "@admins"],
    annotation: about(
      "`dopgate admin reset-password <email>` on a live instance prints the instance it changes, then a generated password once. Root's console sessions end at once, the old password stops working, the new one signs in, and the audit log records admin.password_reset by the system, labelled cli.",
    ),
  },
  async () => {
    const before = await app.consoleSession(ROOT_EMAIL, PASSWORD, "root-before");
    const done = await step(`dopgate admin reset-password ${ROOT_EMAIL}`, () =>
      app.cli(["admin", "reset-password", ROOT_EMAIL]).ok(),
    );
    const newPassword = done.stdout.match(/New password, shown once:\s+(\S+)/)?.[1] ?? "";
    app.secrets.add(newPassword);
    await step("It names the instance on standard error, then the result on standard output", async () => {
      expect(done.stderr).toContain("Instance: ");
      expect(done.stderr).toContain(`(schema ${app.server.schema})`);
      expect(done.stdout).toContain(`✓ Password reset for ${ROOT_EMAIL}.`);
      expect(done.stdout).toMatch(/\d+ console sessions? ended\./);
      expect(newPassword).toMatch(/^([A-Za-z0-9]{4}-){5}[A-Za-z0-9]{4}$/);
    });
    await step("The console session from before the reset stops working at once", async () => {
      const refused = await before.api.get("/console/me", { record: false });
      expect(refused.status).toBe(401);
    });
    await step("The old password is refused and the new one signs in", async () => {
      expect((await consoleSignIn(ROOT_EMAIL, PASSWORD)).status).toBe(401);
      await app.consoleSession(ROOT_EMAIL, newPassword, "root-after");
    });
    await step("The audit log records admin.password_reset by the system, labelled cli", async () => {
      const events = await app.service.get("/admin/audit-events?action=admin.password_reset", {
        record: false,
      });
      expect(events.data.items[0]).toMatchObject({
        actorType: "system",
        actorLabel: "cli",
        action: "admin.password_reset",
        resourceType: "admin",
        resourceId: before.id,
      });
    });
    await step("Put root's password back for the rest of the file", async () => {
      await app
        .cli(["admin", "reset-password", ROOT_EMAIL, "--password-stdin"], {
          stdin: PASSWORD,
          record: false,
        })
        .ok();
    });
  },
);

test(
  "admin reset-password --json --password-stdin resets an admin and leaves root alone",
  {
    tag: ["@admins"],
    annotation: about(
      "An admin gets the password piped to standard input, without its trailing newline. With --json the answer is one line on standard output with the admin's ID, email, role and the sessions ended, and no password since the caller chose it. The admin's session ends; root's does not.",
    ),
  },
  async () => {
    const root = await app.consoleSession(ROOT_EMAIL, PASSWORD, "root");
    const ops = await app.admin("ops");
    const body = await step(`dopgate --json admin reset-password ${ops.email} --password-stdin`, () =>
      app
        .cli(["--json", "admin", "reset-password", ops.email, "--password-stdin"], {
          stdin: "a brand new secret\n",
        })
        .json(),
    );
    await step("It answers with the admin, its role and the sessions it ended", async () => {
      expect(body).toEqual({
        success: true,
        data: { adminId: ops.id, email: ops.email, role: "admin", sessionsEnded: 1 },
      });
    });
    await step("The admin's old session ends and the piped password signs in", async () => {
      expect((await ops.api.get("/console/me", { record: false })).status).toBe(401);
      await app.consoleSession(ops.email, "a brand new secret", "ops-after");
    });
    await step("Root's session still works", async () => {
      expect((await root.api.get("/console/me", { record: false })).status).toBe(200);
    });
  },
);

test(
  "admin reset-password refuses what it can't reset and changes nothing",
  {
    tag: ["@admins"],
    annotation: about(
      "An app user's email, an email nobody has and a password under 8 characters each exit 1 with a message that says why. A missing email is a usage error, exit 2. Root still signs in with its old password afterwards.",
    ),
  },
  async () => {
    const user = await app.user("ana");
    for (const [label, email] of [
      ["An app user's email", user.email],
      ["An email nobody has", "nobody@example.com"],
    ] as const) {
      await step(`${label} exits 1`, async () => {
        const refused = await app.cli(["--json", "admin", "reset-password", email]).fails(1);
        expect(JSON.parse(lastLine(refused.stderr)).error.CLI_ERROR).toBe(
          "no root or admin has that email",
        );
        expect(refused.stdout).toBe("");
      });
    }
    await step("A password under 8 characters exits 1", async () => {
      const refused = await app
        .cli(["admin", "reset-password", ROOT_EMAIL, "--password-stdin"], { stdin: "short" })
        .fails(1);
      expect(refused.stderr).toContain("Use at least 8 characters.");
    });
    await step("No email is a usage error", async () => {
      const refused = await app.cli(["admin", "reset-password"]).fails(2);
      expect(refused.stderr).toContain("<EMAIL>");
    });
    await step("Root still signs in with its old password", async () => {
      expect((await consoleSignIn(ROOT_EMAIL, PASSWORD)).status).toBe(200);
    });
  },
);
