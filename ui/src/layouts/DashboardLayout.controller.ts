import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "~/stores/auth.store";
import { modalsSuspended } from "~/composable/modal-suspension";
import { formatRole } from "~/utils/format";
import { isPageName, SIDEBAR, type PageName } from "./navigation";

/**
 * DashboardLayout controller: the sidebar, the account menu and sign out.
 * Sign out always lands on the sign-in page, even when the server call
 * fails, because the store has already dropped the local session.
 *
 * Below the desktop breakpoint the sidebar folds into a sheet; `navOpen`
 * closes on every route change so a tapped link lands on the new page.
 */
export function useDashboardLayoutController() {
  const router = useRouter();
  const route = useRoute();
  const auth = useAuthStore();

  const email = computed(() => auth.admin?.email ?? "");
  const roleName = computed(() =>
    auth.admin ? formatRole(auth.admin.role) : "",
  );
  const activePage = computed<PageName | null>(() => {
    const segment = route.path.split("/")[1];
    return isPageName(segment) ? segment : null;
  });
  const sessionExpired = computed(() => auth.sessionExpired);
  const signingOut = ref(false);
  const navOpen = ref(false);

  // Hide every other dialog while "Session expired" is up.
  watch(
    sessionExpired,
    (expired) => {
      modalsSuspended.value = expired;
    },
    { immediate: true },
  );
  onUnmounted(() => {
    modalsSuspended.value = false;
  });

  watch(
    () => route.fullPath,
    () => {
      navOpen.value = false;
    },
  );

  async function signOut(): Promise<void> {
    if (signingOut.value) return;
    signingOut.value = true;
    try {
      await auth.logout();
    } catch {
      // The local session is gone either way.
    } finally {
      signingOut.value = false;
      await router.push({ name: "sign-in" });
    }
  }

  async function signInAgain(): Promise<void> {
    auth.sessionExpired = false;
    await router.replace({
      name: "sign-in",
      query: { redirect: route.fullPath },
    });
  }

  return {
    email,
    roleName,
    sections: SIDEBAR,
    activePage,
    sessionExpired,
    signingOut,
    navOpen,
    signOut,
    signInAgain,
  };
}
