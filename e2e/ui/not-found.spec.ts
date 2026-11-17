import { about, expect, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";

const app = useServer();

test(
  "an address nothing lives at shows the not-found page",
  {
    tag: "@smoke",
    annotation: about(
      "A mistyped link shows a 404 page instead of a blank screen, signed in or not. Its link leads to the users list, which asks a visitor to sign in first.",
    ),
  },
  async ({ page }) => {
    await step("Open an unknown address as a visitor", async () => {
      await page.goto("/no-such-page");
      await expect(
        page.getByRole("heading", { name: "Page not found" }),
      ).toBeVisible();
      await expect(page.getByText("404")).toBeVisible();
    });
    await step("Its link leads to sign-in for a visitor", async () => {
      await page.getByRole("link", { name: "Go to users" }).click();
      await expect(page).toHaveURL(/\/sign-in\?redirect=\/users$/);
    });
    await step("Signed in, a deep unknown address is a 404 too", async () => {
      await openAs(page, await app.root(), "/users/usr_missing/nothing/here");
      await expect(
        page.getByRole("heading", { name: "Page not found" }),
      ).toBeVisible();
    });
    await step("And the link leads to the users list", async () => {
      await page.getByRole("link", { name: "Go to users" }).click();
      await expect(page).toHaveURL(/\/users$/);
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    });
  },
);
