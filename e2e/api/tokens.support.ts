// Helpers for the personal token, agent and token trade specs. Setup calls
// here are not recorded, so each test makes the recorded call itself.
import type { Admin, ApiClient, App, User } from "../harness/index.ts";
import { expect } from "../harness/index.ts";

/** Turns personal tokens and user agents on, with the given caps. */
export async function turnOn(
  app: App,
  change: Record<string, unknown> = {},
): Promise<void> {
  await app.settings("selfService", {
    personalTokens: true,
    agents: true,
    maxPersonalTokensPerUser: 10,
    maxAgentsPerUser: 10,
    ...change,
  });
}

/** Puts both features and both caps back to what a new instance has. */
export async function turnOff(app: App): Promise<void> {
  await app.settings("selfService", {
    personalTokens: false,
    agents: false,
    maxPersonalTokensPerUser: 10,
    maxAgentsPerUser: 10,
  });
}

export type MadeToken = {
  token: string;
  id: string;
  name: string;
  lastFour: string;
};

/** A personal token for `user`, remembered for the leak check. */
export async function makePat(
  app: App,
  user: User,
  name = app.uniq("pat"),
  extra: Record<string, unknown> = {},
): Promise<MadeToken> {
  const data = await user.api.must(
    "POST",
    "/auth/personal-tokens",
    { name, ...extra },
    { record: false },
  );
  return {
    token: app.secret(data.token),
    id: data.personalToken.id,
    name,
    lastFour: data.personalToken.lastFour,
  };
}

export type MadeAgent = {
  token: string;
  id: string;
  name: string;
  agent: Record<string, any>;
};

/** An agent owned by `owner`: a user's own API, or an admin's console API. */
export async function makeAgent(
  app: App,
  owner: User | Admin,
  body: Record<string, unknown> = {},
): Promise<MadeAgent> {
  const path = "role" in owner ? "/admin/agents" : "/auth/agents";
  const name = (body.name as string | undefined) ?? app.uniq("bot");
  const data = await owner.api.must(
    "POST",
    path,
    { ...body, name },
    { record: false },
  );
  return {
    token: app.secret(data.token),
    id: data.agent.id,
    name,
    agent: data.agent,
  };
}

/** Trades a token at POST /auth/token without counting it. */
export function tradeQuietly(app: App, token: string) {
  return app.api.post("/auth/token", { token }, { record: false });
}

/** An access token for `token`, asserting that the trade works. */
export async function accessFor(app: App, token: string): Promise<string> {
  const traded = await tradeQuietly(app, token);
  expect(traded.status, JSON.stringify(traded.body)).toBe(200);
  return traded.data.accessToken;
}

/** Audit events of one action, newest first, read as root. */
export async function auditEvents(
  api: ApiClient,
  action: string,
): Promise<any[]> {
  const data = await api.must(
    "GET",
    `/admin/audit-events?action=${action}&limit=200`,
    undefined,
    { record: false },
  );
  return data.items;
}

/** Disabling an account needs the admin API; the harness has no helper. */
export async function setUserStatus(
  app: App,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await app.service.must(
    "POST",
    `/admin/users/${userId}/${enabled ? "enable" : "disable"}`,
    undefined,
    { record: false },
  );
}
