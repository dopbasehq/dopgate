import { api } from "./api";
import type {
  AuthMethods,
  AuthTokens,
  CodePurpose,
  Session,
  User,
} from "./types";

/** Setup, sign-in and the signed-in account's own endpoints. */

export function fetchBootstrapStatus(
  signal?: AbortSignal,
): Promise<{ initialized: boolean }> {
  return api("/bootstrap/status", { auth: false, signal });
}

export function createRoot(body: {
  setupToken: string;
  email: string;
  password: string;
}): Promise<{ userId: string; email: string }> {
  return api("/bootstrap/root", { method: "POST", body, auth: false });
}

export function fetchAuthMethods(signal?: AbortSignal): Promise<AuthMethods> {
  return api("/auth/methods", { auth: false, signal });
}

export function login(email: string, password: string): Promise<AuthTokens> {
  return api("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
    cookie: true,
  });
}

/** Emails a code. The server answers the same for unknown addresses. */
export function sendCode(
  email: string,
  purpose: Exclude<CodePurpose, "email_change">,
): Promise<null> {
  return api("/auth/verification/send", {
    method: "POST",
    body: { email, purpose },
    auth: false,
  });
}

/** Confirms a `login` or `email_verify` code and signs in. */
export function confirmSignInCode(
  email: string,
  purpose: "login" | "email_verify",
  code: string,
): Promise<AuthTokens> {
  return api("/auth/verification/confirm", {
    method: "POST",
    body: { email, purpose, code },
    auth: false,
    cookie: true,
  });
}

/** Confirms an `email_change` code sent to the new address. */
export function confirmEmailChange(
  newEmail: string,
  code: string,
): Promise<User> {
  return api("/auth/verification/confirm", {
    method: "POST",
    body: { email: newEmail, purpose: "email_change", code },
    cookie: true,
  });
}

/** Trades the refresh cookie for a new access token. 401 means signed out. */
export function refreshSession(): Promise<AuthTokens> {
  return api("/auth/refresh", {
    method: "POST",
    body: {},
    auth: false,
    cookie: true,
  });
}

export function logout(allSessions = false): Promise<null> {
  return api("/auth/logout", {
    method: "POST",
    body: allSessions ? { allSessions: true } : {},
    cookie: true,
  });
}

export function fetchMe(signal?: AbortSignal): Promise<User> {
  return api("/auth/me", { signal });
}

export function updateMe(body: {
  displayName?: string | null;
  avatarUrl?: string | null;
}): Promise<User> {
  return api("/auth/me", { method: "PATCH", body });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<null> {
  return api("/auth/password/change", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

/**
 * Sends a code to the new address; confirm with {@link confirmEmailChange}.
 * `password` is the current one, required when the account has one.
 */
export function changeEmail(
  newEmail: string,
  password?: string,
): Promise<null> {
  return api("/auth/email/change", {
    method: "POST",
    body: password === undefined ? { newEmail } : { newEmail, password },
  });
}

export function fetchMySessions(signal?: AbortSignal): Promise<Session[]> {
  return api("/auth/sessions", { signal });
}

export function revokeMySession(id: string): Promise<null> {
  return api(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function revokeOtherSessions(): Promise<null> {
  return api("/auth/sessions", {
    method: "DELETE",
    query: { keepCurrent: true },
  });
}
