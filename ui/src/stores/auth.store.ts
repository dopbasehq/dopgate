import { computed, ref } from "vue";
import { defineStore } from "pinia";
import * as authApi from "~/services/auth.api";
import { registerAuth } from "~/services/api";
import type { AuthTokens, CodePurpose, User } from "~/services/types";
import { clearQueryCache } from "~/queries/session-cache";

/**
 * The console's session.
 *
 * The access token lives in memory only. The refresh token sits in an
 * HttpOnly cookie the server sets in cookie mode, so on page load
 * {@link restore} trades it for a new access token. Every session change
 * goes through {@link adopt} or {@link clear}, which empty the query
 * cache, so no data read as one account is shown to the next.
 */
export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const accessToken = ref<string | null>(null);
  /** Whether the server has a root account. `null` until asked. */
  const initialized = ref<boolean | null>(null);
  /** True after the page-load refresh has been tried once. */
  const restored = ref(false);
  /** A signed-in call failed and the refresh did too. */
  const sessionExpired = ref(false);

  const isSignedIn = computed(() => user.value !== null);
  const isRoot = computed(() => user.value?.role === "root");
  const isAdmin = computed(
    () => user.value?.role === "root" || user.value?.role === "admin",
  );

  function adopt(tokens: AuthTokens): void {
    if (user.value?.id !== tokens.user.id) clearQueryCache();
    accessToken.value = tokens.accessToken;
    user.value = tokens.user;
    sessionExpired.value = false;
    restored.value = true;
  }

  function clear(): void {
    clearQueryCache();
    accessToken.value = null;
    user.value = null;
  }

  /** Gets a new access token from the refresh cookie. */
  async function refresh(): Promise<boolean> {
    try {
      adopt(await authApi.refreshSession());
      return true;
    } catch {
      return false;
    }
  }

  registerAuth({
    token: () => accessToken.value,
    refresh,
    signedOut: () => {
      if (user.value) sessionExpired.value = true;
      clear();
    },
  });

  /**
   * Asks once whether the server has been set up. A network failure leaves
   * it unknown so the next navigation asks again.
   */
  async function loadBootstrapStatus(): Promise<boolean | null> {
    try {
      initialized.value = (await authApi.fetchBootstrapStatus()).initialized;
    } catch {
      initialized.value = null;
    }
    return initialized.value;
  }

  /** Restores the session from the refresh cookie, once per page load. */
  async function restore(): Promise<boolean> {
    if (user.value) return true;
    if (restored.value) return false;
    restored.value = true;
    return refresh();
  }

  async function login(email: string, password: string): Promise<User> {
    adopt(await authApi.login(email, password));
    return user.value as User;
  }

  async function confirmCode(
    email: string,
    purpose: Exclude<CodePurpose, "email_change">,
    code: string,
  ): Promise<User> {
    adopt(await authApi.confirmSignInCode(email, purpose, code));
    return user.value as User;
  }

  /** Creates the root account with the setup token, then signs in. */
  async function setup(request: {
    setupToken: string;
    email: string;
    password: string;
  }): Promise<void> {
    await authApi.createRoot(request);
    initialized.value = true;
    await login(request.email, request.password);
  }

  /** Signs out on the server, then drops everything local either way. */
  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      clear();
      sessionExpired.value = false;
    }
  }

  /** Takes on a newer copy of the signed-in account. */
  function setUser(next: User): void {
    if (user.value?.id === next.id) user.value = next;
  }

  return {
    user,
    accessToken,
    initialized,
    restored,
    sessionExpired,
    isSignedIn,
    isRoot,
    isAdmin,
    adopt,
    clear,
    refresh,
    loadBootstrapStatus,
    restore,
    login,
    confirmCode,
    setup,
    logout,
    setUser,
  };
});
