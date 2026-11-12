import type { Role, Session } from "~/services/types";

/** An RFC 3339 timestamp as a short age, e.g. `2h ago`. */
export function formatRelativeTime(
  iso: string | null,
  now: Date = new Date(),
): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** An RFC 3339 timestamp in the browser locale, e.g. `Nov 9, 2026, 10:04 AM`. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ROLE_LABELS: Record<Role, string> = {
  root: "Root",
  admin: "Admin",
};

export function formatRole(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

const METHOD_LABELS: Record<Session["method"], string> = {
  password: "Password",
  otp: "Email code",
  sso: "Single sign-on",
};

export function formatSignInMethod(method: Session["method"]): string {
  return METHOD_LABELS[method] ?? method;
}

/** A short name for the device behind a session, from its user agent. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser =
    [
      ["Edg/", "Edge"],
      ["Firefox/", "Firefox"],
      ["Chrome/", "Chrome"],
      ["Safari/", "Safari"],
      ["curl/", "curl"],
    ].find(([needle]) => userAgent.includes(needle as string))?.[1] ?? null;
  const os =
    [
      ["iPhone", "iOS"],
      ["iPad", "iPadOS"],
      ["Android", "Android"],
      ["Mac OS X", "macOS"],
      ["Windows", "Windows"],
      ["Linux", "Linux"],
    ].find(([needle]) => userAgent.includes(needle as string))?.[1] ?? null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? userAgent.slice(0, 60);
}
