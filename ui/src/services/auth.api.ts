import { api } from "./api";
import type { Admin, AuthMethods, ConsoleTokens, Session } from "./types";

/**
 * Setup, console sign-in, and the signed-in admin's own endpoints. Admins
 * sign in under `/console`, never through your app's `/auth` endpoints.
 */

export function fetchBootstrapStatus(
  signal?: AbortSignal,
): Promise<{ initialized: boolean }> {
  return api("/bootstrap/status", { auth: false, signal });
}

export function createRoot(body: {
  setupToken: string;
  email: string;
  password: string;
}): Promise<{ adminId: string; email: string }> {
  return api("/bootstrap/root", { method: "POST", body, auth: false });
}

/** The app name and logo for the sign-in screen. */
export function fetchAuthMethods(signal?: AbortSignal): Promise<AuthMethods> {
  return api("/auth/methods", { auth: false, signal });
}

export function login(email: string, password: string): Promise<ConsoleTokens> {
  return api("/console/login", {
    method: "POST",
    body: { email, password },
    auth: false,
    cookie: true,
  });
}

/** Emails a sign-in code. The server answers the same for unknown addresses. */
export function sendCode(email: string): Promise<null> {
  return api("/console/codes/send", {
    method: "POST",
    body: { email },
    auth: false,
  });
}

/** Confirms a sign-in code and signs in. */
export function confirmSignInCode(
  email: string,
  code: string,
): Promise<ConsoleTokens> {
  return api("/console/codes/confirm", {
    method: "POST",
    body: { email, purpose: "login", code },
    auth: false,
    cookie: true,
  });
}

/** Confirms an `email_change` code sent to the new address. */
export function confirmEmailChange(
  newEmail: string,
  code: string,
): Promise<Admin> {
  return api("/console/codes/confirm", {
    method: "POST",
    body: { email: newEmail, purpose: "email_change", code },
    cookie: true,
  });
}

/** Trades the refresh cookie for a new access token. 401 means signed out. */
export function refreshSession(): Promise<ConsoleTokens> {
  return api("/console/refresh", {
    method: "POST",
    body: {},
    auth: false,
    cookie: true,
  });
}

export function logout(allSessions = false): Promise<null> {
  return api("/console/logout", {
    method: "POST",
    body: allSessions ? { allSessions: true } : {},
    cookie: true,
  });
}

export function fetchMe(signal?: AbortSignal): Promise<Admin> {
  return api("/console/me", { signal });
}

export function updateMe(body: {
  displayName?: string | null;
  avatarUrl?: string | null;
}): Promise<Admin> {
  return api("/console/me", { method: "PATCH", body });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<null> {
  return api("/console/password/change", {
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
  return api("/console/email/change", {
    method: "POST",
    body: password === undefined ? { newEmail } : { newEmail, password },
  });
}

export function fetchMySessions(signal?: AbortSignal): Promise<Session[]> {
  return api("/console/sessions", { signal });
}

export function revokeMySession(id: string): Promise<null> {
  return api(`/console/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function revokeOtherSessions(): Promise<null> {
  return api("/console/sessions", {
    method: "DELETE",
    query: { keepCurrent: true },
  });
}
