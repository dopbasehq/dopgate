// Helpers for the console specs of agents, admins, templates, settings, keys
// and the audit log. Setup only: none of these calls count toward coverage.
import { expect, type Page } from "@playwright/test";
import type { Admin, ApiClient } from "../harness/index.ts";

export type NewAgent = {
  id: string;
  name: string;
  token: string;
};

/** An agent that `owner` makes through the admin API. */
export async function makeAgent(
  owner: Admin,
  name: string,
  capabilities: Record<string, unknown> = {},
  description?: string,
): Promise<NewAgent> {
  const made = await owner.api.must(
    "POST",
    "/admin/agents",
    { name, description, capabilities },
    { record: false },
  );
  return { id: made.agent.id, name, token: made.token };
}

/** Trades an agent token at POST /auth/token without counting the call. */
export function tradeToken(api: ApiClient, token: string) {
  return api.post("/auth/token", { token }, { record: false });
}

/** The text of every row of a table, as one string per row. */
export async function rowTexts(page: Page, testId: string): Promise<string[]> {
  return page.getByTestId(testId).allInnerTexts();
}

/** Waits for the page heading, so a test knows the page has loaded. */
export async function seeHeading(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}
