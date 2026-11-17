// Helpers for the admin API specs (users, settings, email templates, audit).
import type { ApiClient } from "../harness/index.ts";

/** The fields of a user as `/auth/*` returns it. */
export const USER_FIELDS = [
  "avatarUrl",
  "createdAt",
  "displayName",
  "email",
  "emailVerified",
  "hasPassword",
  "id",
  "lastSignInAt",
  "publicMetadata",
  "status",
  "updatedAt",
  "userMetadata",
];

/** The audit events for one action, newest first. */
export async function eventsOf(
  api: ApiClient,
  action: string,
  extra = "",
): Promise<any[]> {
  const page = await api.get(
    `/admin/audit-events?action=${encodeURIComponent(action)}&limit=200${extra}`,
    { record: false },
  );
  return page.data.items;
}

/** A JSON object whose serialized form is about `bytes` long. */
export function metadataOfSize(bytes: number): Record<string, string> {
  // `{"k":"…"}` is 8 bytes around the value.
  return { k: "x".repeat(Math.max(0, bytes - 8)) };
}

/** Every setting a test may have touched, put back to the defaults. */
export const DEFAULT_SECTIONS = {
  signup: {},
  password: {},
  tokens: {},
  limits: {},
  selfService: {},
  branding: {},
};

/** The limits the harness raises, so a file full of sign-ins isn't throttled. */
export const RELAXED_LIMITS = {
  ipRequestsPerMinute: 10_000,
  codeResendSeconds: 0,
  codesPerHour: 100,
};
