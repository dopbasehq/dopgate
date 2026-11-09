import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "~/services/auth.api";
import { useAuthStore } from "~/stores/auth.store";
import { mountController } from "~/tests/mount-controller";
import { apiError, member, signInAs } from "~/tests/fixtures";
import { useNoAccessController } from "./NoAccess.controller";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ replace }) }));
vi.mock("~/services/auth.api");

beforeEach(() => {
  vi.clearAllMocks();
  signInAs(member);
});

describe("useNoAccessController", () => {
  it("shows who is signed in", () => {
    const { controller } = mountController(useNoAccessController);
    expect(controller.email.value).toBe(member.email);
  });

  it("signs out and goes to the sign-in page", async () => {
    vi.mocked(authApi.logout).mockResolvedValue(null);
    const { controller } = mountController(useNoAccessController);
    await controller.signOut();
    expect(authApi.logout).toHaveBeenCalled();
    expect(useAuthStore().user).toBeNull();
    expect(replace).toHaveBeenCalledWith({ name: "sign-in" });
  });

  it("still leaves when the server can't be reached", async () => {
    vi.mocked(authApi.logout).mockRejectedValue(apiError(0, "NETWORK_ERROR"));
    const { controller } = mountController(useNoAccessController);
    await controller.signOut();
    expect(useAuthStore().accessToken).toBeNull();
    expect(replace).toHaveBeenCalledWith({ name: "sign-in" });
  });
});
