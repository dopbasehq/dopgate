import { ApiError } from "~/services/api";
import type { AdminUser, AuthTokens, Session, User } from "~/services/types";
import { useAuthStore } from "~/stores/auth.store";

export function userFixture(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "usr_maya",
    email: "maya@example.com",
    emailVerified: true,
    displayName: "Maya",
    avatarUrl: null,
    role: "member",
    status: "active",
    publicMetadata: {},
    userMetadata: {},
    privateMetadata: {},
    hasPassword: true,
    lastSignInAt: null,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    lockedUntil: null,
    ...overrides,
  };
}

export const root = userFixture({
  id: "usr_root",
  email: "root@example.com",
  displayName: null,
  role: "root",
});
export const admin = userFixture({
  id: "usr_admin",
  email: "admin@example.com",
  displayName: "Ada",
  role: "admin",
});
export const member = userFixture();

export function tokensFor(user: User): AuthTokens {
  return {
    accessToken: `token-${user.id}`,
    tokenType: "Bearer",
    expiresIn: 900,
    refreshToken: null,
    user,
  };
}

/** Signs the test in as `user` without calling the server. */
export function signInAs(user: User = root): void {
  const auth = useAuthStore();
  auth.initialized = true;
  auth.adopt(tokensFor(user));
}

export function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_1",
    method: "password",
    ipAddress: "10.0.0.1",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    createdAt: "2026-11-01T10:00:00Z",
    lastUsedAt: "2026-11-09T10:00:00Z",
    current: false,
    ...overrides,
  };
}

export function apiError(
  status: number,
  code: string,
  message = "Something went wrong.",
  retryAfter: number | null = null,
): ApiError {
  return new ApiError(status, { [code]: message }, retryAfter);
}
