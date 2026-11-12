import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import type { Agent } from "~/services/types";
import { mountController, settle } from "~/tests/mount-controller";
import { admin, apiError, root, signInAs } from "~/tests/fixtures";
import { useAgentController } from "./Agent.controller";

const { push, route } = vi.hoisted(() => ({
  push: vi.fn(),
  route: { params: { id: "agt_invoice" } as Record<string, string> },
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
  useRoute: () => route,
}));
vi.mock("~/services/admin.api");

const agent: Agent = {
  id: "agt_invoice",
  name: "invoice-bot",
  description: "Posts invoices",
  owner: { id: root.id, kind: "admin", email: root.email },
  capabilities: { invoices: "read", max_amount: 500 },
  status: "active",
  lastFour: "3f9c",
  lastUsedAt: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.fetchAgent).mockResolvedValue(agent);
  vi.mocked(adminApi.listAuditEvents).mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

async function mountAs(viewer = root) {
  signInAs(viewer);
  const { controller } = mountController(useAgentController);
  await settle();
  return controller;
}

describe("useAgentController", () => {
  it("loads the agent into editable drafts for its owner", async () => {
    const c = await mountAs(root);
    expect(c.isOwner.value).toBe(true);
    expect(c.name.value).toBe("invoice-bot");
    expect(c.capabilities.value).toEqual([
      { key: "invoices", type: "text", value: "read" },
      { key: "max_amount", type: "number", value: "500" },
    ]);
    expect(c.capabilitiesDirty.value).toBe(false);
  });

  it("shows another admin the agent read-only", async () => {
    const c = await mountAs(admin);
    expect(c.isOwner.value).toBe(false);
  });

  it("saves capabilities as a flat object", async () => {
    vi.mocked(adminApi.updateAgent).mockResolvedValue({
      ...agent,
      capabilities: { invoices: "write", max_amount: 500 },
    });
    const c = await mountAs(root);
    c.capabilities.value = [
      { key: "invoices", type: "text", value: "write" },
      { key: "max_amount", type: "number", value: "500" },
    ];
    expect(c.capabilitiesDirty.value).toBe(true);
    await c.saveCapabilities();
    expect(adminApi.updateAgent).toHaveBeenCalledWith(agent.id, {
      capabilities: { invoices: "write", max_amount: 500 },
    });
    expect(c.notice.value).toMatch(/next access token/);
  });

  it("regenerates the token after asking and reveals it once", async () => {
    vi.mocked(adminApi.regenerateAgent).mockResolvedValue({
      token: "dga_new",
      agent: { ...agent, lastFour: "a1b2" },
    });
    const c = await mountAs(root);
    c.ask("regenerate");
    await c.confirm();
    expect(adminApi.regenerateAgent).toHaveBeenCalledWith(agent.id);
    expect(c.revealed.value).toBe("dga_new");
    c.closeRevealed();
    expect(c.revealed.value).toBeNull();
  });

  it("lets any admin turn it off, and shows a refusal in the dialog", async () => {
    vi.mocked(adminApi.disableAgent).mockResolvedValue({
      ...agent,
      status: "disabled",
    });
    const c = await mountAs(admin);
    c.ask("disable");
    await c.confirm();
    expect(adminApi.disableAgent).toHaveBeenCalledWith(agent.id);
    expect(c.confirming.value).toBeNull();

    vi.mocked(adminApi.deleteAgent).mockRejectedValue(
      apiError(403, "AUTHORIZATION_DENIED", "Only admins in the console."),
    );
    c.ask("delete");
    await c.confirm();
    expect(c.confirming.value).toBe("delete");
    expect(c.confirmError.value).toBe("Only admins in the console.");
  });

  it("deletes and goes back to the list", async () => {
    vi.mocked(adminApi.deleteAgent).mockResolvedValue(null);
    const c = await mountAs(root);
    c.ask("delete");
    await c.confirm();
    expect(push).toHaveBeenCalledWith({ name: "agents" });
  });
});
