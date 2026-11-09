import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import type { SigningKey } from "~/services/types";
import { mountController, settle } from "~/tests/mount-controller";
import { admin, apiError, root, signInAs } from "~/tests/fixtures";
import { useKeysController } from "./Keys.controller";

vi.mock("~/services/admin.api");

const key = (
  id: string,
  status: SigningKey["status"],
  createdAt: string,
): SigningKey => ({
  id,
  algorithm: "ES256",
  status,
  createdAt,
  rotatedAt: null,
  retiredAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.fetchSigningKeys).mockResolvedValue([
    key("key_old", "retired", "2026-01-01T00:00:00Z"),
    key("key_now", "active", "2026-10-01T00:00:00Z"),
    key("key_prev", "retiring", "2026-06-01T00:00:00Z"),
  ]);
  vi.mocked(adminApi.listAuditEvents).mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

async function mountAs(user = root) {
  signInAs(user);
  const { controller } = mountController(useKeysController);
  await settle();
  return controller;
}

describe("useKeysController", () => {
  it("lists the active key first, then retiring, then retired", async () => {
    const c = await mountAs();
    expect(c.keys.value?.map((k) => k.id)).toEqual([
      "key_now",
      "key_prev",
      "key_old",
    ]);
  });

  it("lets only root rotate", async () => {
    expect((await mountAs(root)).canRotate.value).toBe(true);
    expect((await mountAs(admin)).canRotate.value).toBe(false);
  });

  it("rotates after confirming and refreshes the list", async () => {
    vi.mocked(adminApi.rotateSigningKey).mockResolvedValue(
      key("key_new", "active", "2026-11-09T00:00:00Z"),
    );
    const c = await mountAs();
    c.askRotate();
    expect(c.confirmOpen.value).toBe(true);
    await c.rotate();
    expect(adminApi.rotateSigningKey).toHaveBeenCalled();
    expect(c.confirmOpen.value).toBe(false);
    expect(c.notice.value).toBe("New key key_new is now signing tokens.");
    expect(adminApi.fetchSigningKeys).toHaveBeenCalledTimes(2);
  });

  it("keeps the dialog open when rotating fails", async () => {
    vi.mocked(adminApi.rotateSigningKey).mockRejectedValue(
      apiError(403, "AUTHORIZATION_DENIED", "Only root can rotate keys."),
    );
    const c = await mountAs();
    c.askRotate();
    await c.rotate();
    expect(c.confirmOpen.value).toBe(true);
    expect(c.rotateError.value).toBe("Only root can rotate keys.");
  });
});
