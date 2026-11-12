import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useInfiniteQuery } from "@pinia/colada";
import { ApiError, errorMessage } from "~/services/api";
import {
  createUser,
  type NewUser,
  type UserFilters,
} from "~/services/admin.api";
import type { AdminUser, UserStatus } from "~/services/types";
import { usersQuery } from "~/queries/admin";
import { useInvalidate } from "~/queries/invalidate";
import { useDebounced } from "~/utils/debounce";
import { formatRelativeTime } from "~/utils/format";
import { isValidEmail } from "~/utils/validation";

export const STATUS_FILTERS: { value: UserStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

export interface UserRow {
  user: AdminUser;
  name: string | null;
  lastSignIn: string;
}

export interface NewUserDraft {
  email: string;
  displayName: string;
  password: string;
  emailVerified: boolean;
}

const emptyDraft = (): NewUserDraft => ({
  email: "",
  displayName: "",
  password: "",
  emailVerified: false,
});

/**
 * Users page controller: search and filter your app's users on the server,
 * a page at a time, and add new ones. Admins live on the Admins page.
 */
export function useUsersController() {
  const router = useRouter();
  const invalidate = useInvalidate();

  const search = ref("");
  const searchQuery = useDebounced(search, "");
  const statusFilter = ref<string | null>(null);

  const filters = computed<UserFilters>(() => ({
    search: searchQuery.value.trim(),
    status: (statusFilter.value as UserStatus | null) ?? null,
  }));

  const feed = useInfiniteQuery(() => ({
    ...usersQuery(filters.value),
    placeholderData: (previous) => previous,
  }));

  const loadingMore = ref(false);
  const moreError = ref<string | null>(null);

  const users = computed<AdminUser[]>(
    () => feed.data.value?.pages.flatMap((page) => page?.items ?? []) ?? [],
  );
  const loading = computed(
    () => feed.data.value === undefined && feed.error.value === null,
  );
  const loadError = computed(() =>
    feed.error.value && !feed.isLoading.value
      ? errorMessage(feed.error.value, "Couldn't load users.")
      : moreError.value,
  );
  const hasMore = computed(
    () =>
      !feed.isPlaceholderData.value &&
      (feed.data.value?.pages.at(-1)?.nextCursor ?? null) !== null,
  );
  const filtered = computed(
    () => filters.value.search !== "" || filters.value.status !== null,
  );

  const rows = computed<UserRow[]>(() =>
    users.value.map((user) => ({
      user,
      name: user.displayName,
      lastSignIn: formatRelativeTime(user.lastSignInAt),
    })),
  );

  async function reload(): Promise<void> {
    moreError.value = null;
    await feed.refetch();
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || loadingMore.value) return;
    loadingMore.value = true;
    moreError.value = null;
    try {
      await feed.loadNextPage({ throwOnError: true });
    } catch (cause) {
      moreError.value = errorMessage(cause, "Couldn't load more users.");
    } finally {
      loadingMore.value = false;
    }
  }

  // New user
  const createOpen = ref(false);
  const draft = ref<NewUserDraft>(emptyDraft());
  const createErrors = ref<{ email?: string; password?: string }>({});
  const createError = ref<string | null>(null);
  const creating = ref(false);

  function openCreate(): void {
    draft.value = emptyDraft();
    createErrors.value = {};
    createError.value = null;
    createOpen.value = true;
  }

  function closeCreate(): void {
    if (!creating.value) createOpen.value = false;
  }

  async function submitCreate(): Promise<void> {
    if (creating.value) return;
    createError.value = null;
    const email = draft.value.email.trim();
    if (email === "") {
      createErrors.value = { email: "Enter an email address." };
      return;
    }
    if (!isValidEmail(email)) {
      createErrors.value = { email: "Enter a valid email address." };
      return;
    }
    createErrors.value = {};

    const body: NewUser = { email, emailVerified: draft.value.emailVerified };
    const displayName = draft.value.displayName.trim();
    if (displayName) body.displayName = displayName;
    if (draft.value.password) body.password = draft.value.password;

    creating.value = true;
    try {
      const user = await createUser(body);
      createOpen.value = false;
      void invalidate.usersChanged();
      await router.push({ name: "user", params: { id: user.id } });
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.hasCode("EMAIL_TAKEN")) {
          createErrors.value = {
            email: "A user with this email already exists.",
          };
          return;
        }
        if (cause.hasCode("EMAIL_INVALID")) {
          createErrors.value = { email: cause.message };
          return;
        }
        if (cause.hasCode("PASSWORD_INVALID")) {
          createErrors.value = { password: cause.message };
          return;
        }
      }
      createError.value = errorMessage(cause, "Couldn't create the user.");
    } finally {
      creating.value = false;
    }
  }

  return {
    search,
    statusFilter,
    filtered,
    rows,
    loading,
    loadError,
    hasMore,
    loadingMore,
    reload,
    loadMore,
    createOpen,
    draft,
    createErrors,
    createError,
    creating,
    openCreate,
    closeCreate,
    submitCreate,
  };
}
