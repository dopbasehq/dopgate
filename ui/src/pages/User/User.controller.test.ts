import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import type { AdminUser } from "~/services/types";
import { mountController, settle } from "~/tests/mount-controller";
import {
  admin,
  apiError,
  maya,
  root,
  sessionFixture,
  signInAs,
  userFixture,
} from "~/tests/fixtures";
import { useUserController } from "./User.controller";

const { push, route } = vi.hoisted(() => ({
  push: vi.fn(),
  route: { params: { id: "usr_maya" } as Record<string, string> },
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
  useRoute: () => route,
}));
vi.mock("~/services/admin.api");

let shown: AdminUser;

beforeEach(() => {
  vi.clearAllMocks();
  shown = maya;
  route.params = { id: maya.id };
  vi.mocked(adminApi.fetchUser).mockImplementation(async () => shown);
  vi.mocked(adminApi.fetchUserSessions).mockResolvedValue([sessionFixture()]);
  vi.mocked(adminApi.listAuditEvents).mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

async function mountAs(viewer = root, target: AdminUser = maya) {
  shown = target;
  route.params = { id: target.id };
  signInAs(viewer);
  const { controller } = mountController(useUserController);
  await settle();
  return controller;
}

describe("useUserController", () => {
  it("loads the user, sessions and metadata drafts", async () => {
    const c = await mountAs(
      root,
      userFixture({
        publicMetadata: { plan: "pro" },
        userMetadata: { theme: "dark" },
      }),
    );
    expect(c.user.value?.email).toBe(maya.email);
    expect(c.sessions.value).toHaveLength(1);
    expect(c.displayName.value).toBe("Maya");
    expect(JSON.parse(c.publicMetadata.value)).toEqual({ plan: "pro" });
    expect(JSON.parse(c.userMetadata.value)).toEqual({ theme: "dark" });
    expect(c.metadataDirty.value).toBe(false);
  });

  it("lets every admin manage every user", async () => {
    expect((await mountAs(root, maya)).canManage.value).toBe(true);
    const c = await mountAs(admin, maya);
    expect(c.canManage.value).toBe(true);
    expect(c.canDisableOrDelete.value).toBe(true);
  });

  it("saves the display name", async () => {
    vi.mocked(adminApi.updateUser).mockResolvedValue({
      ...maya,
      displayName: "Maya B",
    });
    const c = await mountAs();
    c.displayName.value = " Maya B ";
    expect(c.profileDirty.value).toBe(true);
    await c.saveProfile();
    expect(adminApi.updateUser).toHaveBeenCalledWith(maya.id, {
      displayName: "Maya B",
    });
    expect(c.user.value?.displayName).toBe("Maya B");
    expect(c.notice.value).toBe("Profile saved.");
  });

  describe("metadata", () => {
    it("won't save JSON that doesn't parse or isn't an object", async () => {
      const c = await mountAs();
      c.publicMetadata.value = "{ nope";
      expect(c.metadataError.value).toBe("Fix the public metadata first.");
      c.publicMetadata.value = "[1, 2]";
      expect(c.metadataError.value).toBe("Fix the public metadata first.");
      expect(await c.saveMetadata()).toBe(false);
      expect(adminApi.updateUser).not.toHaveBeenCalled();
    });

    it("saves both objects and keeps the server's copy", async () => {
      const saved = {
        ...maya,
        publicMetadata: { plan: "pro" },
        privateMetadata: { crm: 7 },
      };
      vi.mocked(adminApi.updateUser).mockResolvedValue(saved);
      const c = await mountAs();
      c.publicMetadata.value = '{"plan":"pro"}';
      c.privateMetadata.value = '{"crm":7}';
      await c.saveMetadata();
      expect(adminApi.updateUser).toHaveBeenCalledWith(maya.id, {
        publicMetadata: { plan: "pro" },
        privateMetadata: { crm: 7 },
      });
      expect(c.metadataDirty.value).toBe(false);
    });
  });

  it("turns an account off after confirming", async () => {
    vi.mocked(adminApi.disableUser).mockResolvedValue({
      ...maya,
      status: "disabled",
    });
    const c = await mountAs();
    c.ask("disable");
    await c.confirm();
    expect(adminApi.disableUser).toHaveBeenCalledWith(maya.id);
    expect(c.user.value?.status).toBe("disabled");
    expect(c.confirming.value).toBeNull();
  });

  it("turns it back on", async () => {
    vi.mocked(adminApi.enableUser).mockResolvedValue(maya);
    const c = await mountAs(root, { ...maya, status: "disabled" });
    await c.enable();
    expect(c.user.value?.status).toBe("active");
  });

  it("sends a password reset code", async () => {
    vi.mocked(adminApi.sendPasswordReset).mockResolvedValue(null);
    const c = await mountAs();
    await c.sendReset();
    expect(c.notice.value).toBe(`Sent a password reset code to ${maya.email}.`);
  });

  it("signs the user out everywhere", async () => {
    vi.mocked(adminApi.revokeUserSessions).mockResolvedValue(null);
    const c = await mountAs();
    vi.mocked(adminApi.fetchUserSessions).mockResolvedValue([]);
    c.ask("sign-out-all");
    await c.confirm();
    expect(adminApi.revokeUserSessions).toHaveBeenCalledWith(maya.id);
    expect(c.sessions.value).toEqual([]);
  });

  it("deletes and goes back to the list", async () => {
    vi.mocked(adminApi.deleteUser).mockResolvedValue(null);
    const c = await mountAs();
    c.ask("delete");
    await c.confirm();
    expect(adminApi.deleteUser).toHaveBeenCalledWith(maya.id);
    expect(push).toHaveBeenCalledWith({ name: "users" });
  });

  it("keeps the dialog open with the server's reason when it refuses", async () => {
    vi.mocked(adminApi.deleteUser).mockRejectedValue(
      apiError(403, "ROOT_PROTECTED", "Root can't be deleted."),
    );
    const c = await mountAs();
    c.ask("delete");
    await c.confirm();
    expect(c.confirming.value).toBe("delete");
    expect(c.confirmError.value).toBe("Root can't be deleted.");
  });
});
