import { describe, expect, it } from "vitest";
import type { AuditEvent, AuditVerification } from "~/services/types";
import {
  AUDIT_ACTIONS,
  actionTone,
  chainLine,
  shortId,
  utcTimestamp,
} from "./audit";

const record = (seq: number | null): AuditEvent => ({
  id: "aud_1",
  actorType: "user",
  actorId: "usr_maya",
  actorLabel: "maya@example.com",
  action: "user.signed_in",
  resourceType: null,
  resourceId: null,
  ipAddress: null,
  metadata: {},
  createdAt: "2026-11-19T07:41:07.123Z",
  seq,
  prevHash: null,
  recordHash: null,
});

const check = (
  overrides: Partial<AuditVerification> = {},
): AuditVerification => ({
  ok: true,
  records: 10,
  headSeq: 10,
  headHash: "abc",
  legacy: 0,
  unsequenced: 0,
  prunedSeq: null,
  broken: null,
  anchor: null,
  ...overrides,
});

describe("chainLine", () => {
  it("says a record without a sequence isn't in the chain", () => {
    expect(chainLine(record(null), check()).tone).toBe("neutral");
  });

  it("asks for a check before one has run", () => {
    expect(chainLine(record(4), null).text).toBe(
      "Not checked yet. Verify chain checks every record.",
    );
  });

  it("marks the record where the chain breaks, and the ones after it", () => {
    const broken = check({
      ok: false,
      broken: { seq: 5, id: "aud_5", reason: "Hash does not match" },
    });
    expect(chainLine(record(5), broken)).toEqual({
      tone: "crit",
      text: "The chain breaks at this record: Hash does not match",
    });
    expect(chainLine(record(7), broken).text).toBe(
      "After the break at #5, so this record can't be trusted.",
    );
    expect(chainLine(record(4), broken).tone).toBe("ok");
  });

  it("notes a record written after the last check", () => {
    expect(chainLine(record(11), check()).text).toBe(
      "Written after the last check, which went up to #10.",
    );
  });
});

describe("audit helpers", () => {
  it("lists realm actions for users and admins once each, sorted", () => {
    expect(AUDIT_ACTIONS).toContain("user.sign_in_failed");
    expect(AUDIT_ACTIONS).toContain("admin.signed_in");
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect([...AUDIT_ACTIONS].sort((a, b) => a.localeCompare(b))).toEqual(
      AUDIT_ACTIONS,
    );
  });

  it("marks failures and refusals", () => {
    expect(actionTone("user.sign_in_failed")).toBe("crit");
    expect(actionTone("agent.token_rejected")).toBe("crit");
    expect(actionTone("user.created")).toBe("neutral");
  });

  it("cuts long IDs in the middle and leaves short ones alone", () => {
    expect(shortId("usr_01M7KPTD9PW828K48S7KVR7GWV")).toBe("usr_01M7KP…R7GWV");
    expect(shortId("usr_1")).toBe("usr_1");
  });

  it("gives the UTC time without milliseconds", () => {
    expect(utcTimestamp("2026-11-19T07:41:07.123Z")).toBe(
      "2026-11-19T07:41:07Z",
    );
  });
});
