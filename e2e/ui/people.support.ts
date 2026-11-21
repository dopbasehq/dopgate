// Helpers for the Users and User specs only.
import type { Page } from "@playwright/test";
import type { App } from "../harness/index.ts";

/** One row of the users table, found by the email it shows. */
export function userRow(page: Page, email: string) {
  return page.getByTestId("user-row").filter({ hasText: email });
}

/**
 * Creates `count` users with no password through the service key, quickly
 * and without counting toward coverage. Returns their emails, oldest first.
 */
export async function makeUsers(
  app: App,
  count: number,
  prefix = "bulk",
): Promise<string[]> {
  const emails = Array.from({ length: count }, (_, index) =>
    app.email(`${prefix}${index}`),
  );
  for (let start = 0; start < emails.length; start += 10) {
    await Promise.all(
      emails
        .slice(start, start + 10)
        .map((email) =>
          app.service.must("POST", "/admin/users", { email }, { record: false }),
        ),
    );
  }
  return emails;
}

/** A user made through the service key. Not signed in, no coverage hit. */
export async function plainUser(
  app: App,
  body: Record<string, unknown> = {},
): Promise<{ id: string; email: string }> {
  const email = (body.email as string | undefined) ?? app.email("pat");
  const created = await app.service.must(
    "POST",
    "/admin/users",
    { ...body, email },
    { record: false },
  );
  return { id: created.id, email };
}
