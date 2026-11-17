import type { Page } from "@playwright/test";
import { about, expect, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { jwtHeader, openAs, verifiedByJwks } from "../harness/helpers.ts";
import { seeHeading } from "./instance.support.ts";

const app = useServer();

const rows = (page: Page) => page.getByTestId("keys-table").locator("tbody tr");

async function jwks(page: Page) {
  const response = await page.request.get("/.well-known/jwks.json");
  expect(response.status()).toBe(200);
  return (await response.json()) as { keys: { kid: string }[] };
}

test(
  "a new instance lists one active signing key",
  {
    tag: ["@keys", "@console"],
    annotation: about(
      "The Signing keys page lists the key the server made at first start: its ID, ES256, Active, and when it was created. The same ID is the one the JWKS publishes.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    await step("Open the Signing keys page", async () => {
      await openAs(page, root, "/keys");
      await seeHeading(page, "Signing keys");
      await expect(page.getByTestId("keys-table")).toBeVisible();
    });
    await step("One row, active, ES256", async () => {
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText("ES256");
      await expect(rows(page).first()).toContainText("Active");
      await expect(rows(page).first()).toContainText("key_");
    });
    await step("The ID matches the admin API and the published key set", async () => {
      const listed = await root.api.get("/admin/keys", { record: false });
      expect(listed.data).toHaveLength(1);
      const kid = listed.data[0].id as string;
      await expect(rows(page).first()).toContainText(kid);
      expect((await jwks(page)).keys.map((key) => key.kid)).toEqual([kid]);
    });
    await step("Root sees the Rotate button", async () => {
      await expect(page.getByTestId("rotate-key")).toBeVisible();
    });
  },
);

test(
  "rotating the key asks first, then the old key retires and both are published",
  {
    tag: ["@keys", "@console", "@tokens"],
    annotation: about(
      "Root rotates the signing key. Cancelling changes nothing. Confirming shows a new Active key and the old one Retiring, and the JWKS lists both. A token signed before the rotation still verifies, and a new one is signed by the new key.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const user = await app.user("holder");
    const before = user.tokens!.accessToken;
    const oldKid = jwtHeader(before).kid as string;
    await step("Open the Signing keys page and press Rotate", async () => {
      await openAs(page, root, "/keys");
      await expect(rows(page)).toHaveCount(1);
      await page.getByTestId("rotate-key").click();
      await expect(
        page.getByRole("dialog", { name: "Rotate the signing key?" }),
      ).toBeVisible();
      await expect(
        page.getByText("A new key starts signing tokens now.", { exact: false }),
      ).toBeVisible();
    });
    await step("Cancel changes nothing", async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(rows(page)).toHaveCount(1);
      expect((await jwks(page)).keys).toHaveLength(1);
    });
    await step("Confirm rotates", async () => {
      await page.getByTestId("rotate-key").click();
      await page
        .getByRole("dialog", { name: "Rotate the signing key?" })
        .getByRole("button", { name: "Rotate", exact: true })
        .click();
      await expect(page.getByText(/New key key_\w+ is now signing tokens\./)).toBeVisible();
      await expect(rows(page)).toHaveCount(2);
    });
    await step("The new key is Active on top and the old key is Retiring", async () => {
      await expect(rows(page).nth(0)).toContainText("Active");
      await expect(rows(page).nth(1)).toContainText("Retiring");
      await expect(rows(page).nth(1)).toContainText(oldKid);
      await expect(rows(page).nth(0)).not.toContainText(oldKid);
    });
    await step("The page keeps working: it reloads and moves to other pages", async () => {
      await page.reload();
      await expect(rows(page)).toHaveCount(2);
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Admins" }).click();
      await expect(page).toHaveURL(/\/admins$/);
      await expect(page.getByTestId("admins-table")).toBeVisible();
    });
    await step("GET /.well-known/jwks.json lists both keys", async () => {
      const keys = (await jwks(page)).keys.map((key) => key.kid);
      expect(keys).toHaveLength(2);
      expect(keys).toContain(oldKid);
    });
    await step("A token signed before the rotation still verifies", async () => {
      expect(await verifiedByJwks(before, await jwks(page) as any)).toBe(true);
    });
    await step("A new sign-in is signed by the new key", async () => {
      const again = await app.userSession(user.email);
      const newKid = jwtHeader(again.tokens.accessToken).kid as string;
      expect(newKid).not.toBe(oldKid);
      expect(await verifiedByJwks(again.tokens.accessToken, await jwks(page) as any)).toBe(true);
    });
    await step("The console's earlier access token stopped working", async () => {
      const stale = await root.api.get("/admin/keys", { record: false });
      expect(stale.status).toBe(401);
    });
    await step("The audit log has key.rotated for the new key", async () => {
      // The file's shared root session died with the old console secret, so
      // give it a fresh token before the next test uses it.
      const fresh = await app.consoleSession(ROOT_EMAIL);
      root.api.token = fresh.tokens.accessToken;
      const events = await fresh.api.get("/admin/audit-events?action=key.rotated", {
        record: false,
      });
      expect(events.data.items).toHaveLength(1);
      expect(events.data.items[0].resourceType).toBe("signing_key");
      expect(events.data.items[0].actorType).toBe("root");
    });
  },
);

test(
  "an admin who is not root has no Rotate button and the server refuses a rotation",
  {
    tag: ["@keys", "@console", "@security"],
    annotation: about(
      "A plain admin can read the keys but the page offers no way to rotate them, and POST /admin/keys/rotate answers 403.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("plainkeys");
    await step("Sam opens the Signing keys page", async () => {
      await openAs(page, sam, "/keys");
      await seeHeading(page, "Signing keys");
      await expect(page.getByTestId("keys-table")).toBeVisible();
      await expect(rows(page).first()).toContainText("Active");
    });
    await step("There is no Rotate button", async () => {
      await expect(page.getByTestId("rotate-key")).toHaveCount(0);
    });
    await step("POST /admin/keys/rotate as Sam is refused", async () => {
      const keysBefore = await sam.api.get("/admin/keys", { record: false });
      const refused = await sam.api.post("/admin/keys/rotate", undefined, { record: false });
      expect(refused.status).toBe(403);
      const keysAfter = await sam.api.get("/admin/keys", { record: false });
      expect(keysAfter.data).toHaveLength(keysBefore.data.length);
    });
  },
);
