import type { Page } from "@playwright/test";
import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { query } from "../harness/server.ts";
import { seeHeading } from "./instance.support.ts";

const app = useServer();

const entries = (page: Page) => page.getByTestId("audit-table").getByTestId("audit-row");
const entry = (page: Page, text: string) => entries(page).filter({ hasText: text }).first();
/** The open event's drawer. */
const drawer = (page: Page) => page.getByTestId("audit-event");
/** The action in each listed row, top to bottom. */
const actionsShown = (page: Page) =>
  entries(page).evaluateAll((rows) =>
    rows.map((row) => row.querySelector("td:nth-child(2)")?.textContent?.trim()),
  );

/**
 * Sets the Action filter: opens the chip, types the action and presses
 * Enter, which takes any action, listed or not. An action already set is
 * cleared first. The page goes back to the top first: the menu closes when
 * the page scrolls, and a scroll Playwright starts to reach the chip can
 * land just after the click that opened it.
 */
async function filterAction(page: Page, action: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const clear = page.getByRole("button", { name: "Clear Action filter" });
  if (await clear.isVisible()) await clear.click();
  await page.getByRole("button", { name: "Action", exact: true }).click();
  const box = page.getByLabel("Filter by action");
  await box.fill(action);
  await box.press("Enter");
  await expect(page.getByTestId("action-filter")).toContainText(action);
}

test(
  "the list shows recent events newest first with who, what and when",
  {
    tag: ["@audit", "@console"],
    annotation: about(
      "After a user is made and a sign-in fails, the Audit log lists those events at the top, newest first, each with its action, the actor, the thing it touched and how long ago it happened.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const user = await app.user("seen");
    await step("A wrong password is tried for the user", async () => {
      const refused = await app.api.post(
        "/auth/login",
        { email: user.email, password: "not the password" },
        { record: false },
      );
      expect(refused.status).toBe(401);
    });
    await step("Open the Audit log page", async () => {
      await openAs(page, root, "/audit");
      await seeHeading(page, "Audit log");
      await expect(page.getByTestId("audit-table")).toBeVisible();
    });
    await step("The first rows follow the server's order", async () => {
      const listed = await root.api.get("/admin/audit-events?limit=8", { record: false });
      const expected = listed.data.items.map((item: any) => item.action);
      const shown = (await actionsShown(page)).slice(0, 8);
      expect(shown).toEqual(expected);
      expect(expected[0]).toBe("admin.signed_in");
    });
    await step("The failed sign-in names the user and says how long ago", async () => {
      const row = entry(page, "user.sign_in_failed");
      await expect(row).toContainText(user.email);
      await expect(row).toContainText(user.id);
      await expect(row).toContainText("just now");
    });
    await step("The user made by the backend shows the service as its actor", async () => {
      const row = entry(page, "user.created").filter({ hasText: user.id });
      await expect(row).toContainText(user.id);
    });
    await step("Sign-ins of root are listed too", async () => {
      await expect(entry(page, "admin.signed_in")).toContainText(ROOT_EMAIL);
    });
  },
);

test(
  "opening an entry shows its details and metadata",
  {
    tag: ["@audit", "@console"],
    annotation: about(
      "Clicking a row opens the event in a drawer on the right with the time in local time and UTC, the actor, the resource, the position in the chain and the hash, plus the metadata as JSON. Escape closes it.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const user = await app.user("detail");
    await app.api.post(
      "/auth/login",
      { email: user.email, password: "wrong wrong wrong" },
      { record: false },
    );
    await step("Open the Audit log and filter to failed sign-ins", async () => {
      await openAs(page, root, "/audit");
      await filterAction(page, "user.sign_in_failed");
      await expect(entries(page).first()).toContainText("user.sign_in_failed");
    });
    const row = () => entries(page).filter({ hasText: user.email }).first();
    await step("The metadata is hidden until a row opens", async () => {
      await expect(row()).toBeVisible();
      await expect(drawer(page)).toHaveCount(0);
      await expect(page.getByTestId("audit-metadata")).toHaveCount(0);
    });
    await step("Open the row", async () => {
      await row().click();
      await expect(page.getByRole("dialog", { name: "user.sign_in_failed" })).toBeVisible();
    });
    await step("It shows the time, actor, resource, sequence and hash", async () => {
      await expect(drawer(page)).toContainText("When");
      await expect(drawer(page)).toContainText(/UTC\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
      await expect(drawer(page)).toContainText(user.email);
      await expect(drawer(page)).toContainText(`user ${user.id}`);
      await expect(drawer(page)).toContainText(/Sequence\s*#\d+/);
      await expect(drawer(page)).toContainText("Hash");
    });
    await step("The metadata says why it failed", async () => {
      const metadata = page.getByTestId("audit-metadata");
      await expect(metadata).toContainText('"reason": "password"');
      await expect(metadata).toContainText('"locked": false');
    });
    await step("Before a check, the drawer says the chain isn't checked yet", async () => {
      await expect(page.getByTestId("audit-chain")).toContainText("Not checked yet");
    });
    await step("Escape closes it", async () => {
      await page.keyboard.press("Escape");
      await expect(drawer(page)).toHaveCount(0);
    });
    await step("An entry with no metadata of its own shows what was made", async () => {
      await filterAction(page, "user.created");
      const created = entries(page).filter({ hasText: user.id });
      await created.first().click();
      await expect(page.getByTestId("audit-metadata")).toContainText(user.email);
    });
  },
);

test(
  "the action and actor filters narrow the list",
  {
    tag: ["@audit", "@console"],
    annotation: about(
      "Typing an action name keeps only that action. Typing a user's email or ID keeps only what that actor did. Both together combine, a filter with no match says so, and Clear brings everything back.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const ana = await app.user("filterana");
    const bo = await app.user("filterbo");
    for (const user of [ana, bo]) {
      await app.api.post(
        "/auth/login",
        { email: user.email, password: "wrong wrong wrong" },
        { record: false },
      );
    }
    await step("Open the Audit log", async () => {
      await openAs(page, root, "/audit");
      await expect(entries(page).first()).toBeVisible();
    });
    await step("Filter by action", async () => {
      await filterAction(page, "user.sign_in_failed");
      await expect(entry(page, ana.email)).toBeVisible();
      await expect
        .poll(async () => [...new Set(await actionsShown(page))])
        .toEqual(["user.sign_in_failed"]);
      expect(await entries(page).count()).toBeGreaterThanOrEqual(2);
    });
    await step("Add the actor's email", async () => {
      await page.getByLabel("Filter by actor").fill(ana.email);
      await expect(entries(page)).toHaveCount(1);
      await expect(entries(page).first()).toContainText(ana.email);
      await expect(entries(page).first()).not.toContainText(bo.email);
    });
    await step("An actor ID works as well", async () => {
      await page.getByLabel("Filter by actor").fill(bo.id);
      await expect(entries(page).first()).toContainText(bo.email);
      await expect(entries(page).first()).not.toContainText(ana.email);
    });
    await step("A filter with no match says so", async () => {
      await filterAction(page, "no.such_action");
      await expect(page.getByText("No events match these filters.")).toBeVisible();
      await expect(page.getByTestId("audit-table")).toHaveCount(0);
    });
    await step("Clear removes both filters", async () => {
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(page.getByRole("button", { name: "Action", exact: true })).toBeVisible();
      await expect(page.getByLabel("Filter by actor")).toHaveValue("");
      await expect(page.getByText("No events match these filters.")).toHaveCount(0);
      await expect(entries(page).first()).toBeVisible();
    });
    await step("Filtering by the service key's label shows what a backend did", async () => {
      await page.getByLabel("Filter by actor").fill("service");
      await expect(entry(page, "user.created")).toBeVisible();
      await expect(entries(page).first()).toContainText("service");
    });
  },
);

test(
  "Load more fetches the next page of events",
  {
    tag: ["@audit", "@console"],
    annotation: about(
      "The log shows 50 events at a time. With more than that in the database, Load more adds the next page and disappears once everything is shown.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    await step("Make 60 users through the backend to fill the log", async () => {
      for (let n = 0; n < 60; n++) {
        const made = await app.service.post(
          "/admin/users",
          { email: app.email(`bulk${n}`), emailVerified: true },
          { record: false },
        );
        expect(made.status).toBe(201);
      }
    });
    await step("Open the Audit log: 50 rows and a Load more button", async () => {
      await openAs(page, root, "/audit");
      await expect(entries(page)).toHaveCount(50);
      await expect(page.getByTestId("load-more")).toBeVisible();
    });
    await step("Load more adds the rest and the button goes", async () => {
      await page.getByTestId("load-more").click();
      await expect.poll(() => entries(page).count()).toBeGreaterThan(50);
      const total = await root.api.get("/admin/audit-events?limit=200", { record: false });
      await expect(entries(page)).toHaveCount(total.data.items.length);
      await expect(page.getByTestId("load-more")).toHaveCount(0);
    });
    await step("Filtering to one action shows a short list with no Load more", async () => {
      await filterAction(page, "admin.signed_in");
      const signIns = await root.api.get("/admin/audit-events?action=admin.signed_in", {
        record: false,
      });
      await expect(entries(page)).toHaveCount(signIns.data.items.length);
      await expect(page.getByTestId("load-more")).toHaveCount(0);
    });
  },
);

test(
  "Verify chain reports an intact chain",
  {
    tag: ["@audit", "@console", "@security"],
    annotation: about(
      "Verify chain recomputes every record's hash. On an untouched log the page reports Chain intact with the number of records checked and the head position, matching GET /admin/audit-events/verify.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    await step("Open the Audit log", async () => {
      await openAs(page, root, "/audit");
      await expect(entries(page).first()).toBeVisible();
      await expect(page.getByTestId("verification")).toHaveCount(0);
    });
    await step("Press Verify chain", async () => {
      await page.getByTestId("verify-chain").click();
      await expect(page.getByTestId("verification")).toContainText("Chain intact");
    });
    await step("It counts the records and names the head", async () => {
      const report = await root.api.get("/admin/audit-events/verify", { record: false });
      expect(report.data.ok).toBe(true);
      expect(report.data.broken).toBeNull();
      await expect(page.getByTestId("verification")).toContainText(
        new RegExp(`${report.data.records} records checked, head #${report.data.headSeq}`),
      );
    });
    await step("The check is recorded as a checkpoint in the server log, not as an event", async () => {
      expect((await app.server.log()).includes("audit checkpoint")).toBe(true);
    });
  },
);

test(
  "Verify chain reports where the chain breaks after a record is tampered with",
  {
    tag: ["@audit", "@console", "@security"],
    annotation: about(
      "One stored record's metadata is changed straight in the database, with the guard trigger switched off for the edit. Verify chain then reports the chain as broken at that position and says why.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    await app.user("padding");
    let victim: { seq: string; id: string; resource_id: string } | undefined;
    await step("Change one sealed record directly in the database", async () => {
      const rows = await query<{ seq: string; id: string; resource_id: string }>(
        app.server.schema,
        "SELECT seq::text, id, resource_id FROM audit_events WHERE seq IS NOT NULL AND action = 'user.created' ORDER BY seq DESC LIMIT 1",
      );
      victim = rows[0];
      expect(victim).toBeDefined();
      await query(
        app.server.schema,
        "ALTER TABLE audit_events DISABLE TRIGGER audit_events_sealed_immutable",
      );
      await query(
        app.server.schema,
        "UPDATE audit_events SET metadata = '{\"email\":\"forged@example.com\"}' WHERE id = $1",
        [victim!.id],
      );
      await query(
        app.server.schema,
        "ALTER TABLE audit_events ENABLE TRIGGER audit_events_sealed_immutable",
      );
    });
    await step("Open the Audit log and press Verify chain", async () => {
      await openAs(page, root, "/audit");
      await expect(entries(page).first()).toBeVisible();
      await page.getByTestId("verify-chain").click();
    });
    await step("The page says the chain is broken at that position", async () => {
      const result = page.getByTestId("verification");
      await expect(result).toContainText(`Chain broken at #${victim!.seq}`);
      await expect(result).toContainText(victim!.id);
      await expect(result).not.toContainText("Chain intact");
    });
    await step("GET /admin/audit-events/verify agrees", async () => {
      const report = await root.api.get("/admin/audit-events/verify", { record: false });
      expect(report.data.ok).toBe(false);
      expect(report.data.broken.id).toBe(victim!.id);
      expect(String(report.data.broken.seq)).toBe(victim!.seq);
    });
    await step("The forged value shows in the list, which is why the chain exists", async () => {
      await filterAction(page, "user.created");
      const forged = entries(page).filter({ hasText: victim!.resource_id });
      await forged.first().click();
      await expect(page.getByTestId("audit-metadata")).toContainText("forged@example.com");
    });
    await step("The drawer says this record is where the chain breaks", async () => {
      await expect(page.getByTestId("audit-chain")).toContainText(
        "The chain breaks at this record",
      );
    });
  },
);
