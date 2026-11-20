import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import type { AuditEvent, AuditVerification } from "~/services/types";
import { mountController, settle } from "~/tests/mount-controller";
import { signInAs } from "~/tests/fixtures";
import { describeVerification, useAuditController } from "./Audit.controller";

const { replace, route } = vi.hoisted(() => ({
  replace: vi.fn(),
  route: { query: {} as Record<string, string> },
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ replace }),
  useRoute: () => route,
}));
vi.mock("~/services/admin.api");

const event = (id: string, seq: number): AuditEvent => ({
  id,
  actorType: "user",
  actorId: "usr_root",
  actorLabel: "root@example.com",
  action: "user.created",
  resourceType: "user",
  resourceId: "usr_maya",
  ipAddress: "10.0.0.1",
  metadata: { role: "member" },
  createdAt: "2026-11-09T10:00:00Z",
  seq,
  prevHash: null,
  recordHash: "abc",
});

const verification = (
  overrides: Partial<AuditVerification> = {},
): AuditVerification => ({
  ok: true,
  records: 42,
  headSeq: 42,
  headHash: "abc",
  legacy: 0,
  unsequenced: 0,
  prunedSeq: null,
  broken: null,
  anchor: null,
  ...overrides,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
  route.query = {};
  signInAs();
  vi.mocked(adminApi.listAuditEvents).mockResolvedValue({
    items: [event("evt_2", 2), event("evt_1", 1)],
    nextCursor: "c2",
  });
});

async function mount() {
  const { controller } = mountController(useAuditController);
  await settle();
  return controller;
}

describe("useAuditController", () => {
  it("lists events and offers more", async () => {
    const c = await mount();
    expect(c.events.value.map((e) => e.id)).toEqual(["evt_2", "evt_1"]);
    expect(c.hasMore.value).toBe(true);
  });

  it("loads the next page", async () => {
    vi.mocked(adminApi.listAuditEvents)
      .mockResolvedValueOnce({ items: [event("evt_2", 2)], nextCursor: "c2" })
      .mockResolvedValueOnce({ items: [event("evt_1", 1)], nextCursor: null });
    const c = await mount();
    await c.loadMore();
    expect(vi.mocked(adminApi.listAuditEvents).mock.calls[1]?.[1]).toBe("c2");
    expect(c.events.value).toHaveLength(2);
    expect(c.hasMore.value).toBe(false);
  });

  it("filters by action and actor and keeps both in the address", async () => {
    const c = await mount();
    c.setAction(" user.deleted ");
    c.actor.value = "root@example.com";
    await wait(350);
    await settle();
    expect(adminApi.listAuditEvents).toHaveBeenLastCalledWith(
      { action: "user.deleted", actor: "root@example.com" },
      null,
      expect.any(AbortSignal),
    );
    expect(replace).toHaveBeenLastCalledWith({
      query: { action: "user.deleted", actor: "root@example.com" },
    });
    c.clearFilters();
    await wait(350);
    expect(c.action.value).toBe("");
    expect(replace).toHaveBeenLastCalledWith({ query: {} });
  });

  it("starts from the filters in the address", async () => {
    route.query = { actor: "usr_maya" };
    const c = await mount();
    expect(c.actor.value).toBe("usr_maya");
    expect(adminApi.listAuditEvents).toHaveBeenCalledWith(
      { action: "", actor: "usr_maya" },
      null,
      expect.any(AbortSignal),
    );
  });

  it("opens an event in the drawer and closes it", async () => {
    const c = await mount();
    const second = c.events.value[1]!;
    c.openEvent(second);
    expect(c.selected.value?.id).toBe("evt_1");
    c.closeEvent();
    expect(c.selected.value).toBeNull();
  });

  it("says where an open record stands after a check", async () => {
    vi.mocked(adminApi.verifyAuditChain).mockResolvedValue(
      verification({ headSeq: 2 }),
    );
    const c = await mount();
    const record = c.events.value[0]!;
    expect(c.chainLine(record).tone).toBe("neutral");
    await c.verify();
    expect(c.chainLine(record)).toEqual({
      tone: "ok",
      text: "Inside the verified chain, checked up to #2.",
    });
  });

  it("verifies the chain", async () => {
    vi.mocked(adminApi.verifyAuditChain).mockResolvedValue(verification());
    const c = await mount();
    await c.verify();
    expect(c.verification.value).toEqual({
      ok: true,
      title: "Chain intact",
      detail: "42 records checked, head #42.",
    });
  });

  describe("describeVerification", () => {
    it("names where the chain broke and why", () => {
      expect(
        describeVerification(
          verification({
            ok: false,
            broken: { seq: 17, id: "evt_17", reason: "Hash does not match" },
          }),
        ),
      ).toEqual({
        ok: false,
        title: "Chain broken at #17",
        detail: "Hash does not match (event evt_17). 42 records checked.",
      });
    });

    it("mentions older and pruned records on an intact chain", () => {
      expect(
        describeVerification(verification({ legacy: 3, prunedSeq: 5 })).detail,
      ).toBe(
        "42 records checked, head #42. 3 older records have no chain; pruned up to #5.",
      );
    });

    it("reports an anchor that doesn't match", () => {
      expect(
        describeVerification(
          verification({ ok: false, anchor: { seq: 9, status: "mismatch" } }),
        ).title,
      ).toBe("Anchor mismatch at #9");
    });
  });
});
