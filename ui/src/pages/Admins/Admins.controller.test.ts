import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import { mountController, settle } from "~/tests/mount-controller";
import {
  admin,
  adminFixture,
  apiError,
  root,
  signInAs,
} from "~/tests/fixtures";
import { useAdminsController } from "./Admins.controller";

vi.mock("~/services/admin.api");

const bo = adminFixture({
  id: "adm_bo",
  email: "bo@example.com",
  displayName: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.listAdmins).mockResolvedValue({
    items: [root, admin, bo],
  });
  vi.mocked(adminApi.listAuditEvents).mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

async function mountAs(signedIn = root) {
  signInAs(signedIn);
  const { controller } = mountController(useAdminsController);
  await settle();
  return controller;
}

describe("useAdminsController", () => {
  it("lists root and the admins, with who you are", async () => {
    const c = await mountAs(root);
    expect(c.rows.value?.map((row) => row.admin.id)).toEqual([
      root.id,
      admin.id,
      bo.id,
    ]);
    expect(c.rows.value?.[0]).toMatchObject({ roleLabel: "Root", isYou: true });
    expect(c.rows.value?.[2]).toMatchObject({ name: null, roleLabel: "Admin" });
  });

  it("lets root manage every admin but itself", async () => {
    const c = await mountAs(root);
    expect(c.canAdd.value).toBe(true);
    expect(c.rows.value?.map((row) => row.canManage)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("shows admins the list without any actions", async () => {
    const c = await mountAs(admin);
    expect(c.canAdd.value).toBe(false);
    expect(c.rows.value?.every((row) => !row.canManage)).toBe(true);
  });

  it("adds an admin with only what was filled in", async () => {
    vi.mocked(adminApi.createAdmin).mockResolvedValue(
      adminFixture({ id: "adm_new", email: "new@example.com" }),
    );
    const c = await mountAs(root);
    c.openCreate();
    c.draft.value = {
      email: " new@example.com ",
      displayName: "",
      password: "",
    };
    await c.submitCreate();
    expect(adminApi.createAdmin).toHaveBeenCalledWith({
      email: "new@example.com",
    });
    expect(c.createOpen.value).toBe(false);
    expect(c.notice.value).toMatch(/^Added new@example.com/);
  });

  it("puts a taken email on the field", async () => {
    vi.mocked(adminApi.createAdmin).mockRejectedValue(
      apiError(409, "EMAIL_TAKEN"),
    );
    const c = await mountAs(root);
    c.openCreate();
    c.draft.value.email = "bo@example.com";
    await c.submitCreate();
    expect(c.createErrors.value.email).toBe(
      "An admin with this email already exists.",
    );
    expect(c.createOpen.value).toBe(true);
  });

  it("turns an admin off after asking", async () => {
    vi.mocked(adminApi.disableAdmin).mockResolvedValue({
      ...bo,
      status: "disabled",
    });
    const c = await mountAs(root);
    c.ask("disable", bo);
    expect(c.confirm.value).toEqual({ kind: "disable", admin: bo });
    await c.confirmAction();
    expect(adminApi.disableAdmin).toHaveBeenCalledWith(bo.id);
    expect(c.confirm.value).toBeNull();
    expect(c.notice.value).toBe("bo@example.com is turned off and signed out.");
  });

  it("keeps the dialog open with the reason when removing fails", async () => {
    vi.mocked(adminApi.deleteAdmin).mockRejectedValue(
      apiError(403, "ROOT_PROTECTED", "The root account can't be changed."),
    );
    const c = await mountAs(root);
    c.ask("delete", bo);
    await c.confirmAction();
    expect(c.confirm.value).not.toBeNull();
    expect(c.actionError.value).toBe("The root account can't be changed.");
  });

  it("turns an admin back on", async () => {
    vi.mocked(adminApi.enableAdmin).mockResolvedValue(bo);
    const c = await mountAs(root);
    await c.enable({ ...bo, status: "disabled" });
    expect(adminApi.enableAdmin).toHaveBeenCalledWith(bo.id);
    expect(c.notice.value).toBe("bo@example.com can sign in again.");
  });
});
