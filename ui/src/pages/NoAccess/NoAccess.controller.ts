import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "~/stores/auth.store";

/**
 * No access page controller: a member signed in, but the console is for
 * admins. All they can do here is sign out.
 */
export function useNoAccessController() {
  const router = useRouter();
  const auth = useAuthStore();
  const email = computed(() => auth.user?.email ?? "");
  const signingOut = ref(false);

  async function signOut(): Promise<void> {
    if (signingOut.value) return;
    signingOut.value = true;
    try {
      await auth.logout();
    } catch {
      // The local session is gone either way.
    } finally {
      signingOut.value = false;
      await router.replace({ name: "sign-in" });
    }
  }

  return { email, signingOut, signOut };
}
