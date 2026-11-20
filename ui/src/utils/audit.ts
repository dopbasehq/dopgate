import type { AuditEvent, AuditVerification } from "~/services/types";

/** Actions the server builds as `user.<name>` and `admin.<name>`. */
const REALM_ACTIONS = [
  "email_changed",
  "password_changed",
  "password_check_failed",
  "password_reset",
  "sign_in_failed",
  "signed_in",
  "signed_out",
];

/**
 * The audit actions the server writes, for the Action filter's list. The
 * filter also takes any action typed into it, so one missing here is still
 * reachable.
 */
export const AUDIT_ACTIONS: readonly string[] = [
  ...REALM_ACTIONS.flatMap((name) => [`user.${name}`, `admin.${name}`]),
  "admin.created",
  "admin.deleted",
  "admin.disabled",
  "admin.enabled",
  "admin.profile_updated",
  "admin.updated",
  "agent.created",
  "agent.deleted",
  "agent.disabled",
  "agent.enabled",
  "agent.token_regenerated",
  "agent.token_rejected",
  "agent.updated",
  "email_template.reset",
  "email_template.updated",
  "instance.initialized",
  "key.rotated",
  "personal_token.created",
  "personal_token.deleted",
  "session.refresh_reused",
  "session.revoked",
  "session.revoked_all",
  "settings.updated",
  "token.rejected",
  "user.created",
  "user.deleted",
  "user.disabled",
  "user.email_verified",
  "user.enabled",
  "user.password_reset_sent",
  "user.profile_updated",
  "user.session_revoked",
  "user.sessions_revoked",
  "user.signed_up",
  "user.updated",
].sort();

/** Failures and refusals stand out; everything else stays neutral. */
export function actionTone(action: string): "crit" | "neutral" {
  return /(failed|rejected|reused)$/.test(action) ? "crit" : "neutral";
}

/** Who did it, in a few words: a label, an ID or the kind of actor. */
export function actorName(event: AuditEvent): string {
  return event.actorLabel ?? event.actorId ?? event.actorType;
}

/** `usr_01M7KP…R7GWV`: long IDs cut in the middle for table cells. */
export function shortId(id: string, head = 10, tail = 5): string {
  return id.length > head + tail + 1
    ? `${id.slice(0, head)}…${id.slice(-tail)}`
    : id;
}

/** `2026-11-19T07:41:07Z`: the exact time, for matching server logs. */
export function utcTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface ChainLine {
  tone: "ok" | "crit" | "neutral";
  text: string;
}

/**
 * Where one record stands in the hash chain, after a check or before one.
 * Records written before the chain existed, or not sequenced yet, say so.
 */
export function chainLine(
  event: AuditEvent,
  verification: AuditVerification | null,
): ChainLine {
  if (event.seq === null)
    return {
      tone: "neutral",
      text: "Not in the chain. Older records and ones written in the last few seconds have no sequence number.",
    };
  if (!verification)
    return {
      tone: "neutral",
      text: "Not checked yet. Verify chain checks every record.",
    };
  const broken = verification.broken;
  if (broken && event.seq >= broken.seq)
    return {
      tone: "crit",
      text:
        event.seq === broken.seq
          ? `The chain breaks at this record: ${broken.reason}`
          : `After the break at #${broken.seq}, so this record can't be trusted.`,
    };
  if (verification.headSeq !== null && event.seq > verification.headSeq)
    return {
      tone: "neutral",
      text: `Written after the last check, which went up to #${verification.headSeq}.`,
    };
  if (!verification.ok && !broken)
    return { tone: "crit", text: "The last check failed." };
  return {
    tone: "ok",
    text: `Inside the verified chain, checked up to #${verification.headSeq ?? event.seq}.`,
  };
}
