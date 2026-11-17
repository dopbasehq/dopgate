import type { Page } from "@playwright/test";
import { about, expect, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { makeAgent, seeHeading, tradeToken } from "./instance.support.ts";

const app = useServer();

/** Opens Actions and picks one item. */
async function pickAction(page: Page, item: string): Promise<void> {
  await page.getByTestId("agent-actions").click();
  await page.getByRole("menuitem", { name: item }).click();
}

test(
  "the agent page shows its details, token tail and capabilities",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "The page lists the agent's ID, owner, creation and last use, the last four characters of its token and one editable row per capability. The Agents link in the header goes back to the list.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const name = app.uniq("details");
    const agent = await makeAgent(
      root,
      name,
      { repo: "dopgate", max_files: 20, can_merge: false, labels: ["bot", "ci"] },
      "Opens pull requests",
    );
    await step("Open the agent page", async () => {
      await openAs(page, root, `/agents/${agent.id}`);
      await seeHeading(page, name);
    });
    await step("The header shows description, status and ownership", async () => {
      await expect(page.getByText("Opens pull requests")).toBeVisible();
      await expect(page.getByText("On", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Owned by an admin")).toBeVisible();
      await expect(page.getByText("Yours", { exact: true })).toBeVisible();
    });
    await step("Details show the ID, owner and that it was never used", async () => {
      await expect(page.getByText(agent.id, { exact: true })).toBeVisible();
      await expect(page.getByText(ROOT_EMAIL, { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Never")).toBeVisible();
      await expect(page.getByText(`dga_••••${agent.token.slice(-4)}`)).toBeVisible();
    });
    await step("Capabilities appear as rows with their types, by key", async () => {
      const rows = page.getByTestId("capability-row");
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(0).getByLabel("Key")).toHaveValue("can_merge");
      await expect(rows.nth(0).getByLabel("Type")).toHaveValue("boolean");
      await expect(rows.nth(0).getByLabel("Value")).toHaveValue("false");
      await expect(rows.nth(1).getByLabel("Key")).toHaveValue("labels");
      await expect(rows.nth(1).getByLabel("Values")).toHaveValue("bot\nci");
      await expect(rows.nth(2).getByLabel("Key")).toHaveValue("max_files");
      await expect(rows.nth(2).getByLabel("Type")).toHaveValue("number");
      await expect(rows.nth(2).getByLabel("Value")).toHaveValue("20");
      await expect(rows.nth(3).getByLabel("Key")).toHaveValue("repo");
      await expect(rows.nth(3).getByLabel("Value")).toHaveValue("dopgate");
    });
    await step("Save buttons stay off until something changes", async () => {
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Save capabilities" }),
      ).toBeDisabled();
    });
    await step("The Agents link goes back to the list", async () => {
      await page.getByRole("link", { name: "Agents", exact: true }).first().click();
      await expect(page).toHaveURL(/\/agents$/);
      await seeHeading(page, "Agents");
    });
  },
);

test(
  "the owner renames an agent and changes its description",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "Save turns on once the form changes. A bad name shows a message, a name the owner already uses is refused, and a saved change is still there after a reload.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const first = await makeAgent(root, app.uniq("first"), {}, "Old words");
    const other = await makeAgent(root, app.uniq("other"));
    const save = page.getByRole("button", { name: "Save", exact: true });
    await step("Open the agent page", async () => {
      await openAs(page, root, `/agents/${first.id}`);
      await seeHeading(page, first.name);
    });
    await step("A name with capitals is refused", async () => {
      await page.getByLabel("Name").fill("Not Valid");
      await save.click();
      await expect(
        page.getByText("Use 1 to 64 lowercase letters, digits, and dashes."),
      ).toBeVisible();
    });
    await step("A name another agent of the owner has is refused", async () => {
      await page.getByLabel("Name").fill(other.name);
      await save.click();
      await expect(
        page.getByText("You already have an agent with this name."),
      ).toBeVisible();
    });
    const renamed = app.uniq("renamed");
    await step("A new name and description save", async () => {
      await page.getByLabel("Name").fill(renamed);
      await page.getByLabel("Description").fill("New words");
      await save.click();
      await expect(page.getByText("Details saved.")).toBeVisible();
      await seeHeading(page, renamed);
      await expect(page.getByText("New words").first()).toBeVisible();
      await expect(save).toBeDisabled();
    });
    await step("The change is still there after a reload", async () => {
      await page.reload();
      await seeHeading(page, renamed);
      await expect(page.getByLabel("Name")).toHaveValue(renamed);
      await expect(page.getByLabel("Description")).toHaveValue("New words");
      const read = await root.api.get(`/admin/agents/${first.id}`, { record: false });
      expect(read.data.name).toBe(renamed);
    });
    await step("Clearing the description removes it", async () => {
      await page.getByLabel("Description").fill("");
      await save.click();
      await expect(page.getByText("Details saved.")).toBeVisible();
      const read = await root.api.get(`/admin/agents/${first.id}`, { record: false });
      expect(read.data.description).toBeNull();
    });
  },
);

test(
  "the owner changes capabilities and the next token carries them",
  {
    tag: ["@agents", "@console", "@tokens"],
    annotation: about(
      "Editing, adding and removing capability rows and saving replaces the whole object. A bad row is caught before saving. The agent's next access token shows the new capabilities.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    // Rows come back in key order: old_flag, then repo.
    const agent = await makeAgent(root, app.uniq("caps"), {
      repo: "dopgate",
      old_flag: true,
    });
    const saveCaps = page.getByRole("button", { name: "Save capabilities" });
    const rows = page.getByTestId("capability-row");
    await step("Open the agent page", async () => {
      await openAs(page, root, `/agents/${agent.id}`);
      await expect(rows).toHaveCount(2);
    });
    await step("Change one value, remove one row, add a number", async () => {
      await rows.nth(1).getByLabel("Value").fill("other-repo");
      await page.getByRole("button", { name: "Remove old_flag" }).click();
      await page.getByTestId("add-capability").click();
      const added = rows.nth(1);
      await added.getByLabel("Key").fill("max_files");
      await added.getByLabel("Type").selectOption("number");
      await added.getByLabel("Value").fill("5");
    });
    await step("A key with a space is refused and nothing is saved", async () => {
      await rows.nth(1).getByLabel("Key").fill("max files");
      await saveCaps.click();
      await expect(
        page.getByText("Use 1 to 64 letters, digits, _, . or : for the key."),
      ).toBeVisible();
      const read = await root.api.get(`/admin/agents/${agent.id}`, { record: false });
      expect(read.data.capabilities).toEqual({ repo: "dopgate", old_flag: true });
    });
    await step("Fix the key and save", async () => {
      await rows.nth(1).getByLabel("Key").fill("max_files");
      await saveCaps.click();
      await expect(
        page.getByText(
          "Capabilities saved. They show up in the agent's next access token.",
        ),
      ).toBeVisible();
      await expect(saveCaps).toBeDisabled();
    });
    await step("The server holds the new capabilities", async () => {
      const read = await root.api.get(`/admin/agents/${agent.id}`, { record: false });
      expect(read.data.capabilities).toEqual({ repo: "other-repo", max_files: 5 });
    });
    await step("POST /auth/token gives an access token with them", async () => {
      const traded = await tradeToken(await app.anonymousApi(), agent.token);
      expect(traded.status).toBe(200);
      const payload = JSON.parse(
        Buffer.from(traded.data.accessToken.split(".")[1], "base64url").toString(),
      );
      expect(payload.capabilities).toEqual({ repo: "other-repo", max_files: 5 });
    });
  },
);

test(
  "regenerating the token shows a new one and ends the old one",
  {
    tag: ["@agents", "@console", "@tokens"],
    annotation: about(
      "Regenerate asks first. Cancelling changes nothing. Confirming reveals the new token once, the old token stops working at /auth/token and the new one works.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const agent = await makeAgent(root, app.uniq("regen"));
    const api = await app.anonymousApi();
    await step("The original token trades for an access token", async () => {
      expect((await tradeToken(api, agent.token)).status).toBe(200);
    });
    await step("Open the agent page and ask to regenerate", async () => {
      await openAs(page, root, `/agents/${agent.id}`);
      await page.getByTestId("regenerate-token").click();
      await expect(
        page.getByRole("dialog", { name: `Regenerate the token for ${agent.name}?` }),
      ).toBeVisible();
      await expect(
        page.getByText("The current token stops working right away. You'll see the new one once."),
      ).toBeVisible();
    });
    await step("Cancel leaves the old token working", async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect((await tradeToken(api, agent.token)).status).toBe(200);
    });
    let fresh = "";
    await step("Confirm reveals the new token", async () => {
      await page.getByTestId("regenerate-token").click();
      await page.getByRole("button", { name: "Regenerate", exact: true }).click();
      const reveal = page.getByRole("dialog", { name: "New token" });
      await expect(reveal).toBeVisible();
      fresh = app.secret((await page.getByTestId("revealed-token").innerText()).trim());
      expect(fresh).toMatch(/^dga_[A-Za-z0-9_-]{43}$/);
      expect(fresh).not.toBe(agent.token);
      await page.getByRole("button", { name: "Done" }).click();
      await expect(reveal).toHaveCount(0);
    });
    await step("The page shows the tail of the new token", async () => {
      await expect(page.getByText(`dga_••••${fresh.slice(-4)}`)).toBeVisible();
    });
    await step("POST /auth/token refuses the old token", async () => {
      const old = await tradeToken(api, agent.token);
      expect(old.status).toBe(401);
      expect(old.code).toBe("TOKEN_INVALID");
    });
    await step("POST /auth/token accepts the new token", async () => {
      expect((await tradeToken(api, fresh)).status).toBe(200);
    });
  },
);

test(
  "turning an agent off refuses its token until it is turned back on",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "Turn off asks first and the badge changes to Turned off. The agent's token is then refused with AGENT_DISABLED. Turn back on needs no confirmation and the same token works again.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const agent = await makeAgent(root, app.uniq("switch"));
    const api = await app.anonymousApi();
    await step("Open the agent page and choose Turn off", async () => {
      await openAs(page, root, `/agents/${agent.id}`);
      await seeHeading(page, agent.name);
      await pickAction(page, "Turn off");
      await expect(
        page.getByRole("dialog", { name: `Turn off ${agent.name}?` }),
      ).toBeVisible();
    });
    await step("Cancel keeps the agent on", async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByText("Turned off")).toHaveCount(0);
      expect((await tradeToken(api, agent.token)).status).toBe(200);
    });
    await step("Confirm turns it off", async () => {
      await pickAction(page, "Turn off");
      await page.getByRole("button", { name: "Turn off", exact: true }).click();
      await expect(
        page.getByText("Agent turned off. Its next token trade is refused."),
      ).toBeVisible();
      await expect(page.getByText("Turned off", { exact: true })).toBeVisible();
    });
    await step("POST /auth/token answers AGENT_DISABLED", async () => {
      const refused = await tradeToken(api, agent.token);
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AGENT_DISABLED");
    });
    await step("The menu now offers Turn back on", async () => {
      await pickAction(page, "Turn back on");
      await expect(page.getByText("Agent turned back on.")).toBeVisible();
      await expect(page.getByText("Turned off", { exact: true })).toHaveCount(0);
    });
    await step("The same token works again", async () => {
      expect((await tradeToken(api, agent.token)).status).toBe(200);
    });
  },
);

test(
  "deleting an agent asks first, then returns to the list",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "Delete agent asks for confirmation. After it the page goes to the Agents list, the agent is gone from the table and its token no longer works.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const agent = await makeAgent(root, app.uniq("doomed"));
    await step("Open the agent page and choose Delete agent", async () => {
      await openAs(page, root, `/agents/${agent.id}`);
      await seeHeading(page, agent.name);
      await pickAction(page, "Delete agent");
      await expect(
        page.getByRole("dialog", { name: `Delete ${agent.name}?` }),
      ).toBeVisible();
      await expect(
        page.getByText("The agent and its token are gone for good. The audit log keeps what happened."),
      ).toBeVisible();
    });
    await step("Cancel keeps the agent", async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      const read = await root.api.get(`/admin/agents/${agent.id}`, { record: false });
      expect(read.status).toBe(200);
    });
    await step("Confirm deletes it and shows the list", async () => {
      await pickAction(page, "Delete agent");
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page).toHaveURL(/\/agents$/);
      await seeHeading(page, "Agents");
      await expect(
        page.getByTestId("agent-row").filter({ hasText: agent.name }),
      ).toHaveCount(0);
    });
    await step("The token no longer works and the audit log has it", async () => {
      const refused = await tradeToken(await app.anonymousApi(), agent.token);
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("TOKEN_INVALID");
      const events = await root.api.get("/admin/audit-events?action=agent.deleted", {
        record: false,
      });
      expect(
        events.data.items.some((e: any) => e.resourceId === agent.id),
      ).toBe(true);
    });
    await step("Opening the deleted agent's address shows an error", async () => {
      await page.goto(`/agents/${agent.id}`);
      await expect(page.getByText("No agent has this ID.")).toBeVisible();
    });
  },
);

test(
  "an admin who does not own the agent can only turn it off or delete it",
  {
    tag: ["@agents", "@console", "@admins"],
    annotation: about(
      "Another admin sees the owner note, read-only capabilities, no edit form and no Regenerate button. Turn off, turn back on and delete still work.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const sam = await app.admin("sam");
    const agent = await makeAgent(root, app.uniq("rootsbot"), { scope: "read" }, "Belongs to root");
    await step("Sam opens root's agent", async () => {
      await openAs(page, sam, `/agents/${agent.id}`);
      await seeHeading(page, agent.name);
    });
    await step("The owner note names root and says what Sam can do", async () => {
      const note = page.getByTestId("owner-note");
      await expect(note).toContainText(ROOT_EMAIL);
      await expect(note).toContainText("can edit this agent or regenerate its token");
      await expect(note).toContainText("You can turn it off or delete it.");
      await expect(page.getByText("Yours", { exact: true })).toHaveCount(0);
    });
    await step("There is no edit form, no Regenerate and no Save", async () => {
      await expect(page.getByLabel("Name")).toHaveCount(0);
      await expect(page.getByLabel("Description")).toHaveCount(0);
      await expect(page.getByTestId("regenerate-token")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save capabilities" })).toHaveCount(0);
      await expect(page.getByTestId("add-capability")).toHaveCount(0);
    });
    await step("Capabilities show as plain text", async () => {
      await expect(page.getByTestId("capabilities-editor")).toContainText("scope");
      await expect(page.getByTestId("capabilities-editor")).toContainText("read");
      await expect(page.getByTestId("capability-row")).toHaveCount(0);
    });
    await step("PATCH and regenerate as Sam are refused by the server too", async () => {
      const patch = await sam.api.patch(`/admin/agents/${agent.id}`, { description: "mine now" });
      expect(patch.status).toBe(403);
      expect(patch.code).toBe("AUTHORIZATION_DENIED");
      const regenerate = await sam.api.post(`/admin/agents/${agent.id}/regenerate`);
      expect(regenerate.status).toBe(403);
    });
    await step("Sam turns it off and back on", async () => {
      await pickAction(page, "Turn off");
      await page.getByRole("button", { name: "Turn off", exact: true }).click();
      await expect(page.getByText("Turned off", { exact: true })).toBeVisible();
      await pickAction(page, "Turn back on");
      await expect(page.getByText("Agent turned back on.")).toBeVisible();
    });
    await step("Sam deletes it", async () => {
      await pickAction(page, "Delete agent");
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page).toHaveURL(/\/agents$/);
      const read = await root.api.get(`/admin/agents/${agent.id}`, { record: false });
      expect(read.status).toBe(404);
    });
  },
);

test(
  "an agent a user owns shows that user in the owner note",
  {
    tag: ["@agents", "@console", "@users"],
    annotation: about(
      "Root opens an agent made by one of the app's users. The note names the user, and edit and regenerate are off.",
    ),
  },
  async ({ page }) => {
    await app.settings("selfService", { agents: true });
    const user = await app.user("agentowner");
    const made = await user.api.must(
      "POST",
      "/auth/agents",
      { name: app.uniq("theirs"), capabilities: { tier: "free" } },
      { record: false },
    );
    await step("Root opens it", async () => {
      await openAs(page, await app.root(), `/agents/${made.agent.id}`);
      await seeHeading(page, made.agent.name);
    });
    await step("The note names the user", async () => {
      await expect(page.getByTestId("owner-note")).toContainText(user.email);
      await expect(page.getByText("Owned by a user")).toBeVisible();
      await expect(page.getByTestId("regenerate-token")).toHaveCount(0);
    });
    await step("Turning it off ends the token for the user too", async () => {
      await pickAction(page, "Turn off");
      await page.getByRole("button", { name: "Turn off", exact: true }).click();
      await expect(page.getByText("Turned off", { exact: true })).toBeVisible();
      const listed = await user.api.get(`/auth/agents/${made.agent.id}`, { record: false });
      expect(listed.data.status).toBe("disabled");
    });
    await app.settings("selfService", { agents: false });
  },
);

test(
  "an unknown agent ID shows the server's not-found message",
  {
    tag: ["@agents", "@console"],
    annotation: about(
      "A mistyped agent address shows the error from the server with a Try again button, and no empty page.",
    ),
  },
  async ({ page }) => {
    await step("Open an agent ID nobody has", async () => {
      await openAs(page, await app.root(), "/agents/agt_does_not_exist");
    });
    await step("The page says no agent has this ID", async () => {
      await expect(page.getByText("No agent has this ID.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.getByTestId("agent-actions")).toHaveCount(0);
    });
  },
);
