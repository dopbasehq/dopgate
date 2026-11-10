import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import { mountController, settle } from "~/tests/mount-controller";
import {
  admin,
  apiError,
  maya,
  root,
  signInAs,
  userFixture,
} from "~/tests/fixtures";

const ada = userFixture({ id: "usr_ada", email: "ada@example.com" });
import { useUsersController } from "./Users.controller";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("~/services/admin.api", async (original) => ({
  ...(await original<typeof adminApi>()),
  listUsers: vi.fn(),
  createUser: vi.fn(),
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.listUsers).mockResolvedValue({
    items: [ada, maya],
    nextCursor: null,
  });
});

async function mountAs(user = root) {
  signInAs(user);
  const { controller } = mountController(useUsersController);
  await settle();
  return controller;
}

describe("useUsersController", () => {
  it("lists users with their status and last sign-in", async () => {
    const c = await mountAs();
    expect(c.rows.value.map((row) => row.user.id)).toEqual([ada.id, maya.id]);
    expect(c.rows.value[0]).toMatchObject({
      name: "Maya",
      lastSignIn: "Never",
    });
    expect(adminApi.listUsers).toHaveBeenCalledWith(
      { search: "", status: null },
      null,
      expect.any(AbortSignal),
    );
  });

  it("searches and filters on the server", async () => {
    const c = await mountAs();
    c.search.value = "  ada ";
    c.statusFilter.value = "active";
    await wait(350);
    await settle();
    expect(adminApi.listUsers).toHaveBeenLastCalledWith(
      { search: "ada", status: "active" },
      null,
      expect.any(AbortSignal),
    );
    expect(c.filtered.value).toBe(true);
  });

  it("loads the next page with the cursor", async () => {
    const extra = userFixture({ id: "usr_more", email: "more@example.com" });
    vi.mocked(adminApi.listUsers)
      .mockResolvedValueOnce({ items: [ada], nextCursor: "c2" })
      .mockResolvedValueOnce({ items: [extra], nextCursor: null });
    const c = await mountAs();
    expect(c.hasMore.value).toBe(true);
    await c.loadMore();
    expect(vi.mocked(adminApi.listUsers).mock.calls[1]?.[1]).toBe("c2");
    expect(c.rows.value.map((row) => row.user.id)).toEqual([
      ada.id,
      "usr_more",
    ]);
    expect(c.hasMore.value).toBe(false);
  });

  it("shows a load failure", async () => {
    vi.mocked(adminApi.listUsers).mockRejectedValue(
      apiError(500, "INTERNAL_ERROR"),
    );
    const c = await mountAs();
    expect(c.loadError.value).toBe("Couldn't load users.");
  });

  describe("new user", () => {
    it("needs a valid email", async () => {
      const c = await mountAs();
      c.openCreate();
      c.draft.value.email = "nope";
      await c.submitCreate();
      expect(c.createErrors.value.email).toBe("Enter a valid email address.");
      expect(adminApi.createUser).not.toHaveBeenCalled();
    });

    it("creates the user with only what was filled in, then opens it", async () => {
      vi.mocked(adminApi.createUser).mockResolvedValue(
        userFixture({ id: "usr_new", email: "new@example.com" }),
      );
      const c = await mountAs(root);
      c.openCreate();
      c.draft.value = {
        email: " new@example.com ",
        displayName: "",
        password: "",
        emailVerified: true,
      };
      await c.submitCreate();
      expect(adminApi.createUser).toHaveBeenCalledWith({
        email: "new@example.com",
        emailVerified: true,
      });
      expect(c.createOpen.value).toBe(false);
      expect(push).toHaveBeenCalledWith({
        name: "user",
        params: { id: "usr_new" },
      });
    });

    it("lets any admin create a user with a password", async () => {
      vi.mocked(adminApi.createUser).mockResolvedValue(maya);
      const c = await mountAs(admin);
      c.openCreate();
      c.draft.value.email = "new@example.com";
      c.draft.value.password = "hunter22";
      await c.submitCreate();
      expect(adminApi.createUser).toHaveBeenCalledWith({
        email: "new@example.com",
        emailVerified: false,
        password: "hunter22",
      });
    });

    it.each([
      ["EMAIL_TAKEN", 409, "email", "A user with this email already exists."],
      ["PASSWORD_INVALID", 422, "password", "Too short."],
    ])("puts %s on the field", async (code, status, field, message) => {
      vi.mocked(adminApi.createUser).mockRejectedValue(
        apiError(status, code, "Too short."),
      );
      const c = await mountAs();
      c.openCreate();
      c.draft.value.email = "new@example.com";
      await c.submitCreate();
      expect(c.createErrors.value).toEqual({ [field]: message });
      expect(c.createOpen.value).toBe(true);
    });
  });
});
