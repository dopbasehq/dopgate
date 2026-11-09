import { computed, ref } from "vue";
import { useQuery } from "@pinia/colada";
import { errorMessage } from "~/services/api";
import { rotateSigningKey } from "~/services/admin.api";
import type { SigningKey } from "~/services/types";
import { signingKeysQuery } from "~/queries/admin";
import { useInvalidate } from "~/queries/invalidate";
import { useAuthStore } from "~/stores/auth.store";

const ORDER: Record<SigningKey["status"], number> = {
  active: 0,
  retiring: 1,
  retired: 2,
};

/**
 * Signing keys page controller: the keys that sign tokens, newest in use
 * first. Root can rotate: a new key starts signing and the old one keeps
 * verifying until it retires.
 */
export function useKeysController() {
  const auth = useAuthStore();
  const invalidate = useInvalidate();
  const read = useQuery(signingKeysQuery);

  const keys = computed<SigningKey[] | null>(() =>
    read.data.value
      ? [...read.data.value].sort(
          (a, b) =>
            ORDER[a.status] - ORDER[b.status] ||
            b.createdAt.localeCompare(a.createdAt),
        )
      : null,
  );
  const loadError = computed(() =>
    read.error.value && !read.isLoading.value && !read.data.value
      ? errorMessage(read.error.value, "Couldn't load the signing keys.")
      : null,
  );

  const canRotate = computed(() => auth.isRoot);
  const confirmOpen = ref(false);
  const rotating = ref(false);
  const rotateError = ref<string | null>(null);
  const notice = ref<string | null>(null);

  function askRotate(): void {
    rotateError.value = null;
    confirmOpen.value = true;
  }

  function closeRotate(): void {
    if (!rotating.value) confirmOpen.value = false;
  }

  async function rotate(): Promise<void> {
    if (rotating.value || !canRotate.value) return;
    rotating.value = true;
    rotateError.value = null;
    notice.value = null;
    try {
      const key = await rotateSigningKey();
      confirmOpen.value = false;
      notice.value = `New key ${key.id} is now signing tokens.`;
      await invalidate.signingKeysChanged();
    } catch (cause) {
      rotateError.value = errorMessage(cause, "Couldn't rotate the key.");
    } finally {
      rotating.value = false;
    }
  }

  return {
    keys,
    loadError,
    reload: () => read.refetch(),
    canRotate,
    confirmOpen,
    rotating,
    rotateError,
    notice,
    askRotate,
    closeRotate,
    rotate,
  };
}
