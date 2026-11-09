import { ApiError } from "~/services/api";
import type {
  Admin,
  AdminUser,
  ConsoleTokens,
  Session,
} from "~/services/types";
import { useAuthStore } from "~/stores/auth.store";

/** A user of the app, as the admin API returns it. */
export function userFixture(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "usr_maya",
    email: "maya@example.com",
    emailVerified: true,
    displayName: "Maya",
    avatarUrl: null,
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

/** Root or an admin, as the console sees them. */
export function adminFixture(overrides: Partial<Admin> = {}): Admin {
  return {
    id: "adm_ada",
    email: "admin@example.com",
    displayName: "Ada",
    avatarUrl: null,
    role: "admin",
    status: "active",
    hasPassword: true,
    lockedUntil: null,
    lastSignInAt: null,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

export const root = adminFixture({
  id: "adm_root",
  email: "root@example.com",
  displayName: null,
  role: "root",
});
export const admin = adminFixture();
/** A user of the app. */
export const maya = userFixture();

export function tokensFor(signedIn: Admin): ConsoleTokens {
  return {
    accessToken: `token-${signedIn.id}`,
    tokenType: "Bearer",
    expiresIn: 900,
    refreshToken: null,
    admin: signedIn,
  };
}

/** Signs the test in as `signedIn` without calling the server. */
export function signInAs(signedIn: Admin = root): void {
  const auth = useAuthStore();
  auth.initialized = true;
  auth.adopt(tokensFor(signedIn));
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
