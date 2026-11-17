import { about, expect, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { makeAgent, seeHeading, tradeToken } from "./instance.support.ts";

const app = useServer();

/** The "New agent" dialog. */
const dialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "New agent" });

test(
  "a new instance shows an empty agents list",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "With no agents made yet, the table says so and points at what an agent is for.",
    ),
  },
  async ({ page }) => {
    await step("Open the Agents page as root", async () => {
      await openAs(page, await app.root(), "/agents");
      await seeHeading(page, "Agents");
    });
    await step("The table is empty and says what to do", async () => {
      await expect(page.getByTestId("agents-table")).toBeVisible();
      await expect(page.getByTestId("agent-row")).toHaveCount(0);
      await expect(
        page.getByText("No agents yet. Make one for a bot that calls your app."),
      ).toBeVisible();
    });
    await step("The filter chip and search box are there", async () => {
      await expect(page.getByLabel("Filter by Status")).toBeVisible();
      await expect(page.getByPlaceholder("Search by name")).toBeVisible();
    });
  },
);

test(
  "making an agent shows its token once and opens the agent",
  {
    tag: ["@agents", "@console", "@tokens"],
    annotation: about(
      "Root fills in the New agent form with a name, a description and one capability of each type. The token appears once, can be copied, and works at /auth/token with the capabilities in the access token.",
    ),
  },
  async ({ page, context }) => {
    const name = app.uniq("invoice-bot");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await step("Open the New agent dialog", async () => {
      await openAs(page, await app.root(), "/agents");
      await page.getByTestId("new-agent").click();
      await expect(dialog(page)).toBeVisible();
      await expect(
        dialog(page).getByText("No capabilities yet."),
      ).toBeVisible();
    });
    await step("Fill in the name and description", async () => {
      await dialog(page).getByLabel("Name").fill(name);
      await dialog(page)
        .getByLabel("Description")
        .fill("Sends invoices every morning");
    });
    await step("Add a text capability", async () => {
      await dialog(page).getByTestId("add-capability").click();
      const row = dialog(page).getByTestId("capability-row").nth(0);
      await row.getByLabel("Key").fill("repo");
      await row.getByLabel("Value").fill("dopgate");
    });
    await step("Add a number capability", async () => {
      await dialog(page).getByTestId("add-capability").click();
      const row = dialog(page).getByTestId("capability-row").nth(1);
      await row.getByLabel("Key").fill("max_files");
      await row.getByLabel("Type").selectOption("number");
      await row.getByLabel("Value").fill("20");
    });
    await step("Add a true or false capability", async () => {
      await dialog(page).getByTestId("add-capability").click();
      const row = dialog(page).getByTestId("capability-row").nth(2);
      await row.getByLabel("Key").fill("can_merge");
      await row.getByLabel("Type").selectOption("boolean");
      await row.getByLabel("Value").selectOption("false");
    });
    await step("Add a list capability, one item per line", async () => {
      await dialog(page).getByTestId("add-capability").click();
      const row = dialog(page).getByTestId("capability-row").nth(3);
      await row.getByLabel("Key").fill("labels");
      await row.getByLabel("Type").selectOption("list");
      await row.getByLabel("Values").fill("bot\nbilling");
    });
    await step("Create the agent", async () => {
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
    });
    let token = "";
    await step("The token is shown once, in a dialog that stays open", async () => {
      const reveal = page.getByRole("dialog", { name: "Your agent's token" });
      await expect(reveal).toBeVisible();
      await expect(
        reveal.getByText("Copy this token now. You won't see it again."),
      ).toBeVisible();
      token = app.secret(
        (await page.getByTestId("revealed-token").innerText()).trim(),
      );
      expect(token).toMatch(/^dga_[A-Za-z0-9_-]{43}$/);
      await page.keyboard.press("Escape");
      await expect(reveal).toBeVisible();
    });
    await step("Copy token puts the token on the clipboard", async () => {
      await page.getByRole("button", { name: "Copy token" }).click();
      await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        token,
      );
    });
    await step("Done opens the new agent's page", async () => {
      await page.getByRole("button", { name: "Done" }).click();
      await expect(page).toHaveURL(/\/agents\/agt_/);
      await seeHeading(page, name);
      await expect(page.getByText("Sends invoices every morning")).toBeVisible();
    });
    await step("The agent page shows only the last four characters", async () => {
      await expect(page.getByText(`dga_••••${token.slice(-4)}`)).toBeVisible();
      await expect(page.getByText(token)).toHaveCount(0);
    });
    await step("POST /auth/token trades it for an agent access token", async () => {
      const traded = await tradeToken(await app.anonymousApi(), token);
      expect(traded.status).toBe(200);
      const payload = JSON.parse(
        Buffer.from(
          traded.data.accessToken.split(".")[1],
          "base64url",
        ).toString(),
      );
      expect(payload.kind).toBe("agent");
      expect(payload.capabilities).toEqual({
        repo: "dopgate",
        max_files: 20,
        can_merge: false,
        labels: ["bot", "billing"],
      });
    });
  },
);

test(
  "the new agent form catches bad input before it asks the server",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "A bad name, an unusable capability key, a repeated key, a number that is not a number and a long description each show a message by the field. Nothing is created.",
    ),
  },
  async ({ page }) => {
    let before = 0;
    await step("Open the New agent dialog", async () => {
      await openAs(page, await app.root(), "/agents");
      await expect(page.getByTestId("agents-table")).toBeVisible();
      const listed = await (await app.root()).api.get("/admin/agents", {
        record: false,
      });
      before = listed.data.items.length;
      await page.getByTestId("new-agent").click();
      await expect(dialog(page)).toBeVisible();
    });
    await step("An empty name is refused", async () => {
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(
        dialog(page).getByText(
          "Use 1 to 64 lowercase letters, digits, and dashes.",
        ),
      ).toBeVisible();
    });
    await step("Capital letters and spaces are refused", async () => {
      await dialog(page).getByLabel("Name").fill("Invoice Bot");
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(
        dialog(page).getByText(
          "Use 1 to 64 lowercase letters, digits, and dashes.",
        ),
      ).toBeVisible();
    });
    await step("A description over 280 characters is refused", async () => {
      await dialog(page).getByLabel("Name").fill("invoice-bot");
      await dialog(page).getByLabel("Description").fill("x".repeat(281));
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(
        dialog(page).getByText("Keep it to 280 characters."),
      ).toBeVisible();
      await dialog(page).getByLabel("Description").fill("");
    });
    await step("A key with a space is refused", async () => {
      await dialog(page).getByTestId("add-capability").click();
      const row = dialog(page).getByTestId("capability-row").nth(0);
      await row.getByLabel("Key").fill("max files");
      await row.getByLabel("Value").fill("20");
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(
        dialog(page).getByText(
          "Use 1 to 64 letters, digits, _, . or : for the key.",
        ),
      ).toBeVisible();
    });
    await step("A repeated key is refused", async () => {
      await dialog(page).getByTestId("capability-row").nth(0).getByLabel("Key").fill("limit");
      await dialog(page).getByTestId("add-capability").click();
      const second = dialog(page).getByTestId("capability-row").nth(1);
      await second.getByLabel("Key").fill("limit");
      await second.getByLabel("Value").fill("5");
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(dialog(page).getByText("This key is already used.")).toBeVisible();
    });
    await step("A number row with no number is refused", async () => {
      const second = dialog(page).getByTestId("capability-row").nth(1);
      await second.getByLabel("Key").fill("limit2");
      await second.getByLabel("Type").selectOption("number");
      await second.getByLabel("Value").fill("");
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(dialog(page).getByText("Enter a number.")).toBeVisible();
    });
    await step("Removing the bad row clears the problem", async () => {
      await dialog(page).getByRole("button", { name: "Remove limit2" }).click();
      await expect(dialog(page).getByTestId("capability-row")).toHaveCount(1);
    });
    await step("A list over 100 items is refused", async () => {
      const row = dialog(page).getByTestId("capability-row").nth(0);
      await row.getByLabel("Type").selectOption("list");
      await row
        .getByLabel("Values")
        .fill(Array.from({ length: 101 }, (_, i) => `item${i}`).join("\n"));
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(
        dialog(page).getByText("A list holds at most 100 items."),
      ).toBeVisible();
    });
    await step("Capabilities over 4 KB are refused", async () => {
      const row = dialog(page).getByTestId("capability-row").nth(0);
      await row.getByLabel("Type").selectOption("text");
      await row.getByLabel("Value").fill("a".repeat(4200));
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(
        dialog(page).getByText("Capabilities must be 4 KB or less."),
      ).toBeVisible();
    });
    await step("Cancel closes the dialog and makes no agent", async () => {
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByTestId("agent-row")).toHaveCount(before);
      const after = await (await app.root()).api.get("/admin/agents", { record: false });
      expect(after.data.items).toHaveLength(before);
    });
  },
);

test(
  "a name root already uses is refused with the server's message",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "Names are unique per owner. Making a second agent with the same name shows a message at the name field and keeps the form open.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const taken = await makeAgent(root, app.uniq("taken"));
    await step("Open the New agent dialog and use the same name", async () => {
      await openAs(page, root, "/agents");
      await page.getByTestId("new-agent").click();
      await dialog(page).getByLabel("Name").fill(taken.name);
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
    });
    await step("The name field says it is taken", async () => {
      await expect(
        dialog(page).getByText("You already have an agent with this name."),
      ).toBeVisible();
      await expect(dialog(page)).toBeVisible();
    });
    await step("A description with a line break gets the server's message", async () => {
      await dialog(page).getByLabel("Name").fill(app.uniq("two-lines"));
      await dialog(page).getByLabel("Description").fill("first line\nsecond line");
      await dialog(page).getByRole("button", { name: "Create agent" }).click();
      await expect(
        dialog(page).getByText(
          "The description must be one line of at most 280 characters.",
        ),
      ).toBeVisible();
    });
  },
);

test(
  "the table lists each agent with its owner and status",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "Each row has the agent's name, the owner's email with an Admin badge and a mark for the signed-in admin, the On or Turned off badge, and when it was last used.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const sam = await app.admin("sam");
    const mine = await makeAgent(root, app.uniq("mine"));
    const theirs = await makeAgent(sam, app.uniq("theirs"));
    await sam.api.post(`/admin/agents/${theirs.id}/disable`, undefined, { record: false });
    await step("Open the Agents page as root", async () => {
      await openAs(page, root, "/agents");
      await expect(page.getByTestId("agent-row").filter({ hasText: mine.name })).toBeVisible();
    });
    await step("Root's own agent shows root as owner, marked as theirs, and On", async () => {
      const row = page.getByTestId("agent-row").filter({ hasText: mine.name });
      await expect(row).toContainText(ROOT_EMAIL);
      await expect(row).toContainText("Admin");
      await expect(row).toContainText("you");
      await expect(row).toContainText("On");
      await expect(row).toContainText("Never");
    });
    await step("Another admin's agent shows that admin and Turned off", async () => {
      const row = page.getByTestId("agent-row").filter({ hasText: theirs.name });
      await expect(row).toContainText(sam.email);
      await expect(row).not.toContainText("you");
      await expect(row).toContainText("Turned off");
    });
    await step("After a token trade the last used column changes", async () => {
      const traded = await tradeToken(await app.anonymousApi(), mine.token);
      expect(traded.status).toBe(200);
      await page.reload();
      const row = page.getByTestId("agent-row").filter({ hasText: mine.name });
      await expect(row).toContainText("just now");
    });
  },
);

test(
  "search and the status filter narrow the list",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "Typing in the search box filters by name. The Status chip shows only agents that are on or turned off, and a filter with no match says so.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const tag = app.uniq("q").replace("-", "");
    const alpha = await makeAgent(root, `${tag}-alpha`);
    const beta = await makeAgent(root, `${tag}-beta`);
    await root.api.post(`/admin/agents/${beta.id}/disable`, undefined, { record: false });
    const rows = page.getByTestId("agent-row");
    await step("Open the Agents page", async () => {
      await openAs(page, root, "/agents");
      await expect(rows.filter({ hasText: alpha.name })).toBeVisible();
    });
    await step("Search for a name", async () => {
      await page.getByPlaceholder("Search by name").fill(`${tag}-al`);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(alpha.name);
    });
    await step("A search nothing matches says so", async () => {
      await page.getByPlaceholder("Search by name").fill("zzz-no-such-agent");
      await expect(rows).toHaveCount(0);
      await expect(page.getByText("No agents match these filters.")).toBeVisible();
    });
    await step("Clear the search and filter by Status: Turned off", async () => {
      await page.getByPlaceholder("Search by name").fill(tag);
      await expect(rows).toHaveCount(2);
      await page.getByLabel("Filter by Status").click();
      await page.getByRole("menuitem", { name: "Turned off" }).click();
      await expect(page.getByTestId("filter-chip")).toContainText("Status: Turned off");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(beta.name);
    });
    await step("Switch the filter to On", async () => {
      await page.getByLabel("Clear Status filter").click();
      await page.getByLabel("Filter by Status").click();
      await page.getByRole("menuitem", { name: "On", exact: true }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(alpha.name);
    });
    await step("Clearing the filter brings both back", async () => {
      await page.getByLabel("Clear Status filter").click();
      await expect(rows).toHaveCount(2);
    });
  },
);

test(
  "agents that users made show their user as the owner",
  {
    tag: ["@agents", "@console", "@users"],
    annotation: about(
      "With self-service agents on, a user makes an agent through the API. The list shows the user's email with a User badge, and the agent page links to that user.",
    ),
  },
  async ({ page }) => {
    await app.settings("selfService", { agents: true });
    const user = await app.user("owner");
    const made = await user.api.must(
      "POST",
      "/auth/agents",
      { name: app.uniq("user-bot"), capabilities: { scope: "read" } },
      { record: false },
    );
    const name = made.agent.name as string;
    await step("Open the Agents page as root", async () => {
      await openAs(page, await app.root(), "/agents");
      await expect(page.getByTestId("agent-row").filter({ hasText: name })).toBeVisible();
    });
    await step("The row names the user and marks them as a User", async () => {
      const row = page.getByTestId("agent-row").filter({ hasText: name });
      await expect(row).toContainText(user.email);
      await expect(row).toContainText("User");
      await expect(row).not.toContainText("you");
    });
    await step("Clicking the name opens the agent page", async () => {
      await page
        .getByTestId("agent-row")
        .filter({ hasText: name })
        .getByRole("link", { name })
        .click();
      await expect(page).toHaveURL(new RegExp(`/agents/${made.agent.id}$`));
      await seeHeading(page, name);
      await expect(page.getByText("Owned by a user")).toBeVisible();
    });
    await step("The owner link leads to the user", async () => {
      await page.getByRole("link", { name: user.email }).click();
      await expect(page).toHaveURL(new RegExp(`/users/${user.id}$`));
    });
    await app.settings("selfService", { agents: false });
  },
);
