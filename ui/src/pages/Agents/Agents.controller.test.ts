import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import type { Agent } from "~/services/types";
import { mountController, settle } from "~/tests/mount-controller";
import { apiError, root, signInAs } from "~/tests/fixtures";
import { useAgentsController } from "./Agents.controller";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("~/services/admin.api", async (original) => ({
  ...(await original<typeof adminApi>()),
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  listAuditEvents: vi.fn(),
}));

function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agt_cursor",
    name: "cursor",
    description: null,
    owner: { id: "usr_maya", kind: "user", email: "maya@example.com" },
    capabilities: { repo: "dopgate" },
    status: "active",
    lastFour: "3f9c",
    lastUsedAt: null,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

const mine = agentFixture({
  id: "agt_invoice",
  name: "invoice-bot",
  owner: { id: root.id, kind: "admin", email: root.email },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.listAgents).mockResolvedValue({
    items: [agentFixture(), mine],
    nextCursor: null,
  });
  vi.mocked(adminApi.listAuditEvents).mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

async function mount() {
  signInAs(root);
  const { controller } = mountController(useAgentsController);
  await settle();
  return controller;
}

describe("useAgentsController", () => {
  it("lists every agent and marks the ones you own", async () => {
    const c = await mount();
    expect(c.rows.value.map((row) => [row.agent.name, row.yours])).toEqual([
      ["cursor", false],
      ["invoice-bot", true],
    ]);
    expect(c.rows.value[0]?.lastUsed).toBe("Never");
  });

  it("checks the name and capabilities before sending", async () => {
    const c = await mount();
    c.openCreate();
    c.draft.value.name = "Invoice Bot";
    c.draft.value.capabilities = [{ key: "bad key", type: "text", value: "x" }];
    await c.submitCreate();
    expect(c.createErrors.value.name).toMatch(/lowercase/);
    expect(c.capabilityErrors.value[0]).toBeTruthy();
    expect(adminApi.createAgent).not.toHaveBeenCalled();
  });

  it("creates an agent, shows its token once, then opens it", async () => {
    vi.mocked(adminApi.createAgent).mockResolvedValue({
      token: "dga_secret",
      agent: mine,
    });
    const c = await mount();
    c.openCreate();
    c.draft.value = {
      name: "invoice-bot",
      description: "",
      capabilities: [{ key: "invoices", type: "text", value: "read" }],
    };
    await c.submitCreate();
    expect(adminApi.createAgent).toHaveBeenCalledWith({
      name: "invoice-bot",
      capabilities: { invoices: "read" },
    });
    expect(c.createOpen.value).toBe(false);
    expect(c.created.value).toEqual({ id: mine.id, token: "dga_secret" });
    await c.closeCreated();
    expect(c.created.value).toBeNull();
    expect(push).toHaveBeenCalledWith({
      name: "agent",
      params: { id: mine.id },
    });
  });

  it("puts a taken name on the field", async () => {
    vi.mocked(adminApi.createAgent).mockRejectedValue(
      apiError(409, "AGENT_NAME_TAKEN"),
    );
    const c = await mount();
    c.openCreate();
    c.draft.value.name = "invoice-bot";
    await c.submitCreate();
    expect(c.createErrors.value.name).toBe(
      "You already have an agent with this name.",
    );
    expect(c.createOpen.value).toBe(true);
  });
});
