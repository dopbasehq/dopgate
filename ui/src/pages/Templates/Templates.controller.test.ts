import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import { mountController, settle } from "~/tests/mount-controller";
import { apiError, signInAs } from "~/tests/fixtures";
import { templateTitle, useTemplatesController } from "./Templates.controller";

vi.mock("~/services/admin.api");

beforeEach(() => {
  vi.clearAllMocks();
  signInAs();
});

describe("useTemplatesController", () => {
  it("lists the templates", async () => {
    vi.mocked(adminApi.fetchTemplates).mockResolvedValue([
      {
        name: "login_code",
        description: "Sent when someone signs in with a code.",
        customized: true,
        subject: "Your code",
        updatedAt: "2026-11-01T10:00:00Z",
      },
    ]);
    const { controller } = mountController(useTemplatesController);
    await settle();
    expect(controller.templates.value?.[0]?.customized).toBe(true);
    expect(controller.loadError.value).toBeNull();
  });

  it("says when the list can't load", async () => {
    vi.mocked(adminApi.fetchTemplates).mockRejectedValue(
      apiError(500, "INTERNAL_ERROR"),
    );
    const { controller } = mountController(useTemplatesController);
    await settle();
    expect(controller.loadError.value).toBe(
      "Couldn't load the email templates.",
    );
  });

  it("names templates for people, falling back to the key", () => {
    expect(templateTitle("password_reset")).toBe("Password reset");
    expect(templateTitle("something_new")).toBe("something_new");
  });
});
