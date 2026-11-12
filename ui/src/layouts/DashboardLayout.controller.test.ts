import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "~/services/auth.api";
import { useAuthStore } from "~/stores/auth.store";
import { mountController } from "~/tests/mount-controller";
import { admin, signInAs } from "~/tests/fixtures";
import { useDashboardLayoutController } from "./DashboardLayout.controller";

const { push, replace, route } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  route: { path: "/users/usr_1", fullPath: "/users/usr_1" },
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push, replace }),
  useRoute: () => route,
}));
vi.mock("~/services/auth.api");

beforeEach(() => {
  vi.clearAllMocks();
  signInAs(admin);
});

describe("useDashboardLayoutController", () => {
  it("shows the account and highlights the section of the page", () => {
    const { controller: c } = mountController(useDashboardLayoutController);
    expect(c.email.value).toBe(admin.email);
    expect(c.roleName.value).toBe("Admin");
    expect(c.activePage.value).toBe("users");
    expect(c.sections.map((s) => s.label)).toEqual([
      "People",
      "Email",
      "Instance",
    ]);
  });

  it("signs out and lands on the sign-in page", async () => {
    vi.mocked(authApi.logout).mockResolvedValue(null);
    const { controller: c } = mountController(useDashboardLayoutController);
    await c.signOut();
    expect(useAuthStore().admin).toBeNull();
    expect(push).toHaveBeenCalledWith({ name: "sign-in" });
  });

  it("sends an expired session back to sign in, keeping the page", async () => {
    const { controller: c } = mountController(useDashboardLayoutController);
    useAuthStore().sessionExpired = true;
    expect(c.sessionExpired.value).toBe(true);
    await c.signInAgain();
    expect(replace).toHaveBeenCalledWith({
      name: "sign-in",
      query: { redirect: "/users/usr_1" },
    });
  });
});
