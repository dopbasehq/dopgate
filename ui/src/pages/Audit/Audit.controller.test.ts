import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import type { AuditEvent, AuditVerification } from "~/services/types";
import { mountController, settle } from "~/tests/mount-controller";
import { signInAs } from "~/tests/fixtures";
import { describeVerification, useAuditController } from "./Audit.controller";

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

  it("filters by action and actor", async () => {
    const c = await mount();
    c.action.value = "user.deleted";
    c.actor.value = "root@example.com";
    await wait(350);
    await settle();
    expect(adminApi.listAuditEvents).toHaveBeenLastCalledWith(
      { action: "user.deleted", actor: "root@example.com" },
      null,
      expect.any(AbortSignal),
    );
    c.clearFilters();
    expect(c.action.value).toBe("");
  });

  it("expands and collapses rows", async () => {
    const c = await mount();
    c.toggle("evt_1");
    expect(c.expanded.value.has("evt_1")).toBe(true);
    c.toggle("evt_1");
    expect(c.expanded.value.has("evt_1")).toBe(false);
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
