import {
  about,
  expect,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { claims, nav, openAs, verifiedByJwks } from "../harness/helpers.ts";

const app = useServer();

test(
  "scripts and bots: a personal token, an agent, and the admin who switches them off",
  {
    tag: ["@tokens", "@agents"],
    annotation: about(
      "An admin turns on personal tokens and agents in the console. A user makes a personal token for a script, which trades it for an access token and reads the profile. The user also makes an agent for a bot, whose token carries the capabilities the backend checks. Later the admin turns the agent off and revokes the personal token from the console, and neither can sign in any more.",
    ),
  },
  async ({ page }) => {
    const user = await app.user("ines", { displayName: "Ines Duarte" });
    let personalToken = "";
    let agentToken = "";
    let agentId = "";

    await step("Out of the box a user can't make tokens or agents", async () => {
      const refused = await user.api.post("/auth/personal-tokens", {
        name: "backup script",
      });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("FEATURE_DISABLED");
    });
    await step("An admin turns both on under Settings", async () => {
      await openAs(page, await app.root(), "/settings");
      const section = page.getByTestId("settings-selfService");
      await section
        .getByText("Users can create personal tokens", { exact: true })
        .click();
      await section.getByText("Users can create agents of their own").click();
      await section.getByRole("button", { name: "Save", exact: true }).click();
      await expect(section.getByText("Saved", { exact: true })).toBeVisible();
    });
    await step("The user makes a personal token for a script", async () => {
      const created = await user.api.post("/auth/personal-tokens", {
        name: "backup script",
      });
      expect(created.message).toBe("PERSONAL_TOKEN_CREATED");
      personalToken = app.secret(created.data.token);
      expect(personalToken).toMatch(/^dgp_/);
    });
    await step("The script trades it and reads the profile as the user", async () => {
      const traded = await app.api.post("/auth/token", { token: personalToken });
      expect(traded.message).toBe("TOKEN_TRADED");
      expect(traded.data.refreshToken).toBeUndefined();
      const access = traded.data.accessToken as string;
      expect(claims(access)).toMatchObject({
        sub: user.id,
        kind: "human",
        via: "pat",
      });
      const me = await app.api.get("/auth/me", { token: access });
      expect(me.data.displayName).toBe("Ines Duarte");
      // A script's token can't make more tokens.
      const more = await app.api.get("/auth/personal-tokens", { token: access });
      expect(more.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("The user makes an agent for a bot", async () => {
      const created = await user.api.post("/auth/agents", {
        name: "release-bot",
        description: "Opens release pull requests",
        capabilities: { repo: "dopgate", can_merge: false },
      });
      expect(created.message).toBe("AGENT_CREATED");
      agentToken = app.secret(created.data.token);
      agentId = created.data.agent.id;
      expect(agentToken).toMatch(/^dga_/);
    });
    await step("The bot's access token carries its capabilities and verifies", async () => {
      const traded = await app.api.post("/auth/token", { token: agentToken });
      expect(traded.message).toBe("TOKEN_TRADED");
      const access = traded.data.accessToken as string;
      expect(claims(access)).toMatchObject({
        sub: agentId,
        kind: "agent",
        owner: user.id,
        capabilities: { repo: "dopgate", can_merge: false },
      });
      const jwks = (await app.api.get("/.well-known/jwks.json")).body;
      expect(await verifiedByJwks(access, jwks)).toBe(true);
      // It is for the app's backend: Dopgate's own endpoints refuse it.
      const me = await app.api.get("/auth/me", { token: access });
      expect(me.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("The admin finds the agent in the console and turns it off", async () => {
      await nav(page, "Agents").click();
      const row = page.getByTestId("agent-row").filter({ hasText: "release-bot" });
      await expect(row).toContainText(user.email);
      await row.getByRole("link", { name: "release-bot" }).click();
      await expect(page.getByTestId("owner-note")).toContainText(user.email);
      await page.getByTestId("agent-actions").click();
      await page.getByRole("menuitem", { name: "Turn off" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Turn off" })
        .click();
      await expect(page.getByText("Turned off", { exact: true })).toBeVisible();
    });
    await step("The bot can't trade its token any more", async () => {
      const refused = await app.api.post("/auth/token", { token: agentToken });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AGENT_DISABLED");
    });
    await step("The admin revokes the personal token on the user's page", async () => {
      await page.goto(`/users/${user.id}`);
      const tokens = page.getByTestId("user-tokens");
      await expect(tokens).toContainText("backup script");
      await tokens.getByRole("button", { name: "Revoke" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Revoke" })
        .click();
      await expect(
        page.getByText("Revoked the personal token “backup script”."),
      ).toBeVisible();
      await expect(page.getByText("No personal tokens.")).toBeVisible();
    });
    await step("The script's token is refused", async () => {
      const refused = await app.api.post("/auth/token", { token: personalToken });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("TOKEN_INVALID");
    });
  },
);
