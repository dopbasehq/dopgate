import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import type { Template } from "~/services/types";
import { copyText } from "~/utils/clipboard";
import { mountController, settle } from "~/tests/mount-controller";
import { apiError, root, signInAs } from "~/tests/fixtures";
import { LEAVE_PROMPT, useTemplateController } from "./Template.controller";

const { leaveGuards } = vi.hoisted(() => ({
  leaveGuards: [] as (() => boolean)[],
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { name: "login_code" } }),
  onBeforeRouteLeave: (guard: () => boolean) => leaveGuards.push(guard),
}));
vi.mock("~/services/admin.api");
vi.mock("~/utils/clipboard", () => ({ copyText: vi.fn(async () => true) }));

const builtIn = {
  subject: "Your code",
  html: "<p>{{code}}</p>",
  text: "{{code}}",
};
const template: Template = {
  name: "login_code",
  description: "Sent when someone signs in with a code.",
  customized: false,
  ...builtIn,
  variables: ["app_name", "email", "code"],
  updatedAt: null,
  defaults: builtIn,
};

const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
  leaveGuards.length = 0;
  signInAs(root);
  vi.mocked(adminApi.fetchTemplate).mockResolvedValue(template);
  vi.mocked(adminApi.fetchTemplates).mockResolvedValue([]);
  vi.mocked(adminApi.listAuditEvents).mockResolvedValue({
    items: [],
    nextCursor: null,
  });
  vi.mocked(adminApi.previewTemplate).mockImplementation(
    async (_name, body) => ({
      subject: body.subject,
      html: body.html.replace("{{code}}", "123456"),
      text: body.text.replace("{{code}}", "123456"),
    }),
  );
});

async function mount() {
  const { controller } = mountController(() =>
    useTemplateController({ previewDelay: 0 }),
  );
  await settle();
  await wait();
  return controller;
}

describe("useTemplateController", () => {
  it("loads the template into the editor and previews it", async () => {
    const c = await mount();
    expect(c.draft.value).toEqual(builtIn);
    expect(c.dirty.value).toBe(false);
    expect(c.preview.value?.html).toBe("<p>123456</p>");
  });

  it("previews again as you type", async () => {
    const c = await mount();
    c.draft.value!.html = "<b>{{code}}</b>";
    await wait();
    expect(adminApi.previewTemplate).toHaveBeenLastCalledWith(
      "login_code",
      { ...builtIn, html: "<b>{{code}}</b>" },
      expect.any(AbortSignal),
    );
    expect(c.preview.value?.html).toBe("<b>123456</b>");
    expect(c.dirty.value).toBe(true);
  });

  it("shows why a preview failed", async () => {
    const c = await mount();
    vi.mocked(adminApi.previewTemplate).mockRejectedValue(
      apiError(422, "TEMPLATE_INVALID", "Unknown variable {{nope}}."),
    );
    c.draft.value!.subject = "{{nope}}";
    await wait();
    expect(c.previewError.value).toBe("Unknown variable {{nope}}.");
  });

  it("saves and is clean again", async () => {
    const saved = { ...template, customized: true, subject: "Sign in" };
    vi.mocked(adminApi.saveTemplate).mockResolvedValue(saved);
    const c = await mount();
    c.draft.value!.subject = "Sign in";
    await c.save();
    expect(adminApi.saveTemplate).toHaveBeenCalledWith("login_code", {
      ...builtIn,
      subject: "Sign in",
    });
    expect(c.dirty.value).toBe(false);
    expect(c.template.value?.customized).toBe(true);
    expect(c.notice.value).toBe("Template saved.");
  });

  it("sends a test to your own address", async () => {
    vi.mocked(adminApi.sendTemplateTest).mockResolvedValue(null);
    const c = await mount();
    await c.sendTest();
    expect(adminApi.sendTemplateTest).toHaveBeenCalledWith(
      "login_code",
      builtIn,
    );
    expect(c.notice.value).toBe(`Sent a test email to ${root.email}.`);
  });

  it("shows the server's reason when sending fails", async () => {
    vi.mocked(adminApi.sendTemplateTest).mockRejectedValue(
      apiError(502, "SMTP_SEND_FAILED", "The mail server refused the message."),
    );
    const c = await mount();
    await c.sendTest();
    expect(c.error.value).toBe("The mail server refused the message.");
  });

  it("resets to the built-in template", async () => {
    vi.mocked(adminApi.resetTemplate).mockResolvedValue(template);
    vi.mocked(adminApi.fetchTemplate).mockResolvedValue({
      ...template,
      customized: true,
      subject: "Mine",
    });
    const c = await mount();
    c.resetOpen.value = true;
    await c.confirmReset();
    expect(adminApi.resetTemplate).toHaveBeenCalledWith("login_code");
    expect(c.draft.value).toEqual(builtIn);
    expect(c.resetOpen.value).toBe(false);
  });

  it("copies a variable as a placeholder", async () => {
    const c = await mount();
    await c.copyVariable("code");
    expect(copyText).toHaveBeenCalledWith("{{code}}");
    expect(c.copied.value).toBe("code");
  });

  it("asks before leaving with unsaved changes", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const c = await mount();
    const guard = leaveGuards[0]!;
    expect(guard()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    c.draft.value!.text = "changed";
    expect(guard()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(LEAVE_PROMPT);
    vi.unstubAllGlobals();
  });
});
