import {
  about,
  expect,
  PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { jwtHeader, openAs, verifiedByJwks } from "../harness/helpers.ts";

const app = useServer();

/** The key set, the way an app's backend fetches it. */
async function jwks(): Promise<{ keys: (JsonWebKey & { kid: string })[] }> {
  return (await app.api.get("/.well-known/jwks.json")).body;
}

test(
  "key rotation: nobody is signed out when the signing key changes",
  {
    tag: ["@keys", "@security"],
    annotation: about(
      "An app's backend checks access tokens against the published key set. The operator rotates the signing key from the command line while users are signed in. Tokens signed before the rotation keep verifying, new sign-ins get tokens signed by the new key, and the console shows the old key as retiring. Root then rotates once more from the console, and the audit log has both rotations.",
    ),
  },
  async ({ page }) => {
    const user = await app.user("omar");
    const before = user.tokens!.accessToken;
    let firstKey = "";
    let secondKey = "";

    await step("The backend verifies a user's token against the key set", async () => {
      const keys = await jwks();
      expect(keys.keys).toHaveLength(1);
      firstKey = keys.keys[0]!.kid;
      expect(jwtHeader(before).kid).toBe(firstKey);
      expect(await verifiedByJwks(before, keys)).toBe(true);
    });
    await step("dopgate keys rotate, while the server runs", async () => {
      const rotated = await app.cli(["--json", "keys", "rotate"]).json();
      expect(rotated.success).toBe(true);
      expect(rotated.data.status).toBe("active");
      secondKey = rotated.data.id;
      expect(secondKey).not.toBe(firstKey);
    });
    await step("Within a minute the running server publishes both keys", async () => {
      // A running server reloads its signing keys every minute.
      await expect
        .poll(async () => (await jwks()).keys.map((key) => key.kid).sort(), {
          timeout: 75_000,
          intervals: [1_000],
        })
        .toEqual([firstKey, secondKey].sort());
    });
    await step("The token from before still verifies and still works", async () => {
      expect(await verifiedByJwks(before, await jwks())).toBe(true);
      expect((await user.api.get("/auth/me")).data.email).toBe(user.email);
    });
    await step("A new sign-in is signed by the new key", async () => {
      const { tokens } = await app.userSession(user.email, PASSWORD);
      expect(jwtHeader(tokens.accessToken).kid).toBe(secondKey);
      expect(await verifiedByJwks(tokens.accessToken, await jwks())).toBe(true);
    });
    await step("The console lists the new key as active and the old one as retiring", async () => {
      await openAs(page, await app.consoleSession("root@dopbase.com"), "/keys");
      const table = page.getByTestId("keys-table");
      await expect(table.locator("tbody tr")).toHaveCount(2);
      await expect(
        table.locator("tbody tr").filter({ hasText: secondKey }),
      ).toContainText("Active");
      await expect(
        table.locator("tbody tr").filter({ hasText: firstKey }),
      ).toContainText("Retiring");
    });
    await step("Root rotates once more from the console", async () => {
      await page.getByTestId("rotate-key").click();
      await page
        .getByRole("dialog", { name: "Rotate the signing key?" })
        .getByRole("button", { name: "Rotate" })
        .click();
      await expect(page.getByText(/New key key_\w+ is now signing tokens\./)).toBeVisible();
      await expect(
        page.getByTestId("keys-table").locator("tbody tr"),
      ).toHaveCount(3);
    });
    await step("The console keeps working after its own key was replaced", async () => {
      await page.goto("/users");
      await expect(
        page.getByTestId("user-row").filter({ hasText: user.email }),
      ).toBeVisible();
    });
    await step("The audit log has both rotations: one by the CLI, one by root", async () => {
      const events = await app.service.get("/admin/audit-events?action=key.rotated");
      const actors = events.data.items.map(
        (event: { actorType: string; actorLabel: string }) =>
          `${event.actorType} ${event.actorLabel}`,
      );
      expect(actors).toEqual(["root root@dopbase.com", "system cli"]);
    });
  },
);
