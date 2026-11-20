import { about, expect, PASSWORD, step, test, useServer } from "../harness/index.ts";
import { nav, openAs } from "../harness/helpers.ts";
import { makeUsers, plainUser, userRow } from "./people.support.ts";

const app = useServer();

test(
  "a fresh server shows an empty users table",
  {
    tag: ["@console", "@users", "@smoke"],
    annotation: about(
      "Before anyone has signed up, the Users page says there are no users yet. The table headers, the search box, the Status filter and the New user button are all there.",
    ),
  },
  async ({ page }) => {
    await openAs(page, await app.root(), "/users");
    await step("The page has its header, tools and an empty table", async () => {
      await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
      await expect(page.getByText("Everyone who can sign in to your app.")).toBeVisible();
      await expect(page.getByTestId("new-user")).toBeVisible();
      await expect(page.getByPlaceholder("Search by email or name")).toBeVisible();
      await expect(page.getByRole("button", { name: "Filter by Status" })).toBeVisible();
      const table = page.getByTestId("users-table");
      for (const head of ["Person", "Status", "Created", "Last sign-in"]) {
        await expect(table.getByRole("columnheader", { name: head })).toBeVisible();
      }
    });
    await step("It says there are no users yet", async () => {
      await expect(page.getByTestId("users-empty")).toHaveText("No users yet.");
      await expect(page.getByTestId("user-row")).toHaveCount(0);
      await expect(page.getByTestId("load-more")).toHaveCount(0);
    });
  },
);

test(
  "New user checks the form, creates the account and opens its page",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "The New user dialog refuses an empty or malformed email and a password the server finds too short. A good form creates the user, marks the email verified when asked, and opens the new user's page. The user appears in the table, and the password works.",
    ),
  },
  async ({ page }) => {
    const email = app.email("maya");
    await openAs(page, await app.root(), "/users");
    await step("New user opens the dialog and Cancel closes it", async () => {
      await page.getByTestId("new-user").click();
      await expect(page.getByRole("dialog", { name: "New user" })).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog", { name: "New user" })).toBeHidden();
      await page.getByTestId("new-user").click();
    });
    const dialog = page.getByRole("dialog", { name: "New user" });
    const create = dialog.getByRole("button", { name: "Create user" });
    await step("An empty email is refused", async () => {
      await create.click();
      await expect(dialog.getByText("Enter an email address.")).toBeVisible();
    });
    await step("A malformed email is refused", async () => {
      await dialog.getByRole("textbox", { name: "Email" }).fill("maya");
      await create.click();
      await expect(dialog.getByText("Enter a valid email address.")).toBeVisible();
    });
    await step("A short password comes back from the server under the field", async () => {
      await dialog.getByRole("textbox", { name: "Email" }).fill(email);
      await dialog.getByLabel("Password", { exact: true }).fill("short");
      await create.click();
      await expect(dialog.getByText("Use at least 8 characters.")).toBeVisible();
      await expect(dialog).toBeVisible();
    });
    await step("Fill in the rest and create the user", async () => {
      await dialog.getByLabel("Display name").fill("Maya Lin");
      await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await dialog.getByText("Mark email as verified").click();
      await expect(dialog.getByRole("switch", { name: "Mark email as verified" })).toBeChecked();
      await create.click();
    });
    await step("The new user's page opens", async () => {
      await expect(page).toHaveURL(/\/users\/usr_/);
      await expect(page.getByRole("heading", { name: email, level: 1 })).toBeVisible();
      await expect(page.getByText("Maya Lin", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Email verified")).toBeVisible();
      await expect(page.getByText("No password")).toHaveCount(0);
    });
    await step("The user is in the table", async () => {
      await page.getByTestId("breadcrumb").getByRole("link", { name: "Users" }).click();
      const row = userRow(page, email);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Maya Lin");
      await expect(row).toContainText("Active");
      await expect(row).toContainText("Never");
      await expect(page.getByTestId("users-empty")).toHaveCount(0);
    });
    await step("The password they were given signs them in", async () => {
      const session = await app.userSession(email);
      expect(session.tokens.accessToken).toBeTruthy();
    });
  },
);

test(
  "an account made without a password and without verification is marked as such",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Leaving the password empty and the switch off makes an account that signs in with codes and has not confirmed its email. The table flags it unverified and shows only the email, and its page says No password.",
    ),
  },
  async ({ page }) => {
    const email = app.email("leo");
    await openAs(page, await app.root(), "/users");
    await step("Create a user with only an email", async () => {
      await page.getByTestId("new-user").click();
      const dialog = page.getByRole("dialog", { name: "New user" });
      await expect(dialog.getByRole("switch", { name: "Mark email as verified" })).not.toBeChecked();
      await dialog.getByRole("textbox", { name: "Email" }).fill(` ${email} `);
      await dialog.getByRole("button", { name: "Create user" }).click();
      await expect(page).toHaveURL(/\/users\/usr_/);
    });
    await step("Their page says No password and Email not verified", async () => {
      await expect(page.getByText("No password")).toBeVisible();
      await expect(page.getByText("Email not verified")).toBeVisible();
    });
    await step("The table shows the unverified badge and no name", async () => {
      await nav(page, "Users").click();
      const row = userRow(page, email);
      await expect(row.getByText("unverified")).toBeVisible();
      // The person cell holds the avatar's initial, the email and the badge,
      // with no name line above the email.
      const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await expect(row.getByRole("cell").first()).toHaveText(
        new RegExp(`^.\\s*${escaped}\\s*unverified\\s*$`),
      );
    });
  },
);

test(
  "a duplicate email shows the server's message in the dialog",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Creating a user with an address that is already taken keeps the dialog open and says a user with this email already exists. The email is compared without regard to case.",
    ),
  },
  async ({ page }) => {
    const taken = await plainUser(app);
    await openAs(page, await app.root(), "/users");
    await page.getByTestId("new-user").click();
    const dialog = page.getByRole("dialog", { name: "New user" });
    await step("Submit the same email in capitals", async () => {
      await dialog.getByRole("textbox", { name: "Email" }).fill(taken.email.toUpperCase());
      await dialog.getByRole("button", { name: "Create user" }).click();
    });
    await step("The dialog explains and stays open", async () => {
      await expect(dialog.getByText("A user with this email already exists.")).toBeVisible();
      await expect(page).toHaveURL(/\/users$/);
    });
    await step("Only one account has that email", async () => {
      const found = await app.service.get(`/admin/users?email=${encodeURIComponent(taken.email)}`, { record: false });
      expect(found.data.items).toHaveLength(1);
    });
  },
);

test(
  "search finds users by email or name after a short pause and Escape clears it",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Typing in the search box filters the table on the server once typing stops. It matches part of an email or part of a display name. A term nothing matches says so, and Escape empties the box and brings everyone back.",
    ),
  },
  async ({ page }) => {
    const tag = app.uniq("zq").replace("-", "");
    const alma = await plainUser(app, { email: `alma-${tag}@dopbase.com`, displayName: `Alma ${tag}` });
    const boris = await plainUser(app, { email: `boris-${tag}@dopbase.com`, displayName: `Boris Quill ${tag}` });
    const cleo = await plainUser(app, { email: `cleo-${tag}@dopbase.com` });
    await openAs(page, await app.root(), "/users");
    const search = page.getByPlaceholder("Search by email or name");
    await expect(userRow(page, alma.email)).toBeVisible();
    await step("A shared fragment of the emails finds all three", async () => {
      await search.fill(tag);
      await expect(page.getByTestId("user-row")).toHaveCount(3);
    });
    await step("Part of one email finds that user only", async () => {
      await search.fill(`boris-${tag}`);
      await expect(page.getByTestId("user-row")).toHaveCount(1);
      await expect(userRow(page, boris.email)).toBeVisible();
    });
    await step("A display name finds its user", async () => {
      await search.fill(`Quill ${tag}`);
      await expect(page.getByTestId("user-row")).toHaveCount(1);
      await expect(userRow(page, boris.email)).toContainText(`Boris Quill ${tag}`);
    });
    await step("A term nothing matches says no user matches", async () => {
      await search.fill(`nobody-${tag}`);
      await expect(page.getByTestId("users-empty")).toHaveText("No users match these filters.");
      await expect(page.getByTestId("user-row")).toHaveCount(0);
    });
    await step("Escape clears the box and everyone is back", async () => {
      await search.press("Escape");
      await expect(search).toHaveValue("");
      await expect(userRow(page, cleo.email)).toBeVisible();
      await expect(userRow(page, alma.email)).toBeVisible();
    });
  },
);

test(
  "the status filter shows only disabled or only active users and can be cleared",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Status offers Active and Turned off. Choosing one turns the button into a chip that names it and shows only matching users. The chip's cross clears the filter. It combines with search.",
    ),
  },
  async ({ page }) => {
    const tag = app.uniq("st").replace("-", "");
    const live = await plainUser(app, { email: `live-${tag}@dopbase.com` });
    const off = await plainUser(app, { email: `off-${tag}@dopbase.com` });
    await app.service.must("POST", `/admin/users/${off.id}/disable`, undefined, { record: false });
    await openAs(page, await app.root(), "/users");
    const search = page.getByPlaceholder("Search by email or name");
    await search.fill(tag);
    await expect(page.getByTestId("user-row")).toHaveCount(2);
    await step("Choose Turned off", async () => {
      await page.getByRole("button", { name: "Filter by Status" }).click();
      await page.getByRole("menuitem", { name: "Turned off" }).click();
      await expect(page.getByTestId("filter-chip")).toContainText("Status: Turned off");
      await expect(page.getByTestId("user-row")).toHaveCount(1);
      await expect(userRow(page, off.email)).toContainText("Turned off");
    });
    await step("Clear the chip", async () => {
      await page.getByRole("button", { name: "Clear Status filter" }).click();
      await expect(page.getByTestId("filter-chip")).toHaveCount(0);
      await expect(page.getByTestId("user-row")).toHaveCount(2);
    });
    await step("Choose Active", async () => {
      await page.getByRole("button", { name: "Filter by Status" }).click();
      await page.getByRole("menuitem", { name: "Active" }).click();
      await expect(page.getByTestId("filter-chip")).toContainText("Status: Active");
      await expect(page.getByTestId("user-row")).toHaveCount(1);
      await expect(userRow(page, live.email)).toContainText("Active");
    });
    await step("Active and a search with no match says so", async () => {
      await search.fill(`off-${tag}`);
      await expect(page.getByTestId("users-empty")).toHaveText("No users match these filters.");
    });
  },
);

test(
  "a row opens the user page and the breadcrumb leads back",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Clicking a user's email opens /users/{id} with that account, and so does clicking anywhere else in the row or pressing Enter on it. The breadcrumb above the title leads back to the list.",
    ),
  },
  async ({ page }) => {
    const pat = await plainUser(app, { displayName: "Pat Row" });
    await openAs(page, await app.root(), "/users");
    await step("Click the email in its row", async () => {
      await userRow(page, pat.email).getByRole("link", { name: pat.email }).click();
      await expect(page).toHaveURL(new RegExp(`/users/${pat.id}$`));
      await expect(page.getByRole("heading", { name: pat.email, level: 1 })).toBeVisible();
    });
    await step("The breadcrumb returns to the list", async () => {
      await page.getByTestId("breadcrumb").getByRole("link", { name: "Users" }).click();
      await expect(page).toHaveURL(/\/users$/);
      await expect(userRow(page, pat.email)).toBeVisible();
    });
    await step("Clicking the row outside the email opens the user too", async () => {
      await userRow(page, pat.email).getByText("Active", { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/users/${pat.id}$`));
      await page.goBack();
      await expect(userRow(page, pat.email)).toBeVisible();
    });
    await step("Enter on a focused row opens the user", async () => {
      await userRow(page, pat.email).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/users/${pat.id}$`));
    });
  },
);

test(
  "Load more fetches the next page of users",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "The table shows 50 users at a time, newest first. With more than that, Load more adds the rest below and goes away when nothing is left.",
    ),
  },
  async ({ page }) => {
    test.setTimeout(90_000);
    await step("Make enough users for a second page", async () => {
      await makeUsers(app, 55, "page");
    });
    const total = (await app.service.get("/admin/users?limit=200", { record: false })).data.items.length;
    expect(total).toBeGreaterThan(50);
    expect(total).toBeLessThan(200);
    await openAs(page, await app.root(), "/users");
    await step("The first page has 50 rows and a Load more button", async () => {
      await expect(page.getByTestId("user-row")).toHaveCount(50);
      await expect(page.getByTestId("load-more")).toBeVisible();
    });
    await step("Load more adds the rest and the button goes away", async () => {
      await page.getByTestId("load-more").click();
      await expect(page.getByTestId("user-row")).toHaveCount(total);
      await expect(page.getByTestId("load-more")).toHaveCount(0);
    });
  },
);
