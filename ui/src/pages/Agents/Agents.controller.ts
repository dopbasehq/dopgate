import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useInfiniteQuery } from "@pinia/colada";
import { ApiError, errorMessage } from "~/services/api";
import { createAgent, type AgentFilters } from "~/services/admin.api";
import type { Agent, UserStatus } from "~/services/types";
import { agentsQuery } from "~/queries/admin";
import { useInvalidate } from "~/queries/invalidate";
import { useAuthStore } from "~/stores/auth.store";
import { useDebounced } from "~/utils/debounce";
import { formatRelativeTime } from "~/utils/format";
import { toCapabilities, type CapabilityRow } from "~/utils/capabilities";

export const STATUS_FILTERS: { value: UserStatus; label: string }[] = [
  { value: "active", label: "On" },
  { value: "disabled", label: "Turned off" },
];

export interface AgentRow {
  agent: Agent;
  lastUsed: string;
  /** The signed-in admin owns it. */
  yours: boolean;
}

export interface NewAgentDraft {
  name: string;
  description: string;
  capabilities: CapabilityRow[];
}

const emptyDraft = (): NewAgentDraft => ({
  name: "",
  description: "",
  capabilities: [],
});

const NAME = /^[a-z0-9-]{1,64}$/;

/**
 * Agents page controller: every agent, whoever owns it, a page at a time,
 * and new agents the signed-in admin owns. A new agent's token shows once,
 * then the page opens the agent.
 */
export function useAgentsController() {
  const router = useRouter();
  const auth = useAuthStore();
  const invalidate = useInvalidate();

  const search = ref("");
  const searchQuery = useDebounced(search, "");
  const statusFilter = ref<string | null>(null);

  const filters = computed<AgentFilters>(() => ({
    search: searchQuery.value.trim(),
    status: (statusFilter.value as UserStatus | null) ?? null,
    owner: null,
  }));

  const feed = useInfiniteQuery(() => ({
    ...agentsQuery(filters.value),
    placeholderData: (previous) => previous,
  }));

  const loadingMore = ref(false);
  const moreError = ref<string | null>(null);
  const agents = computed<Agent[]>(
    () => feed.data.value?.pages.flatMap((page) => page?.items ?? []) ?? [],
  );
  const loading = computed(
    () => feed.data.value === undefined && feed.error.value === null,
  );
  const loadError = computed(() =>
    feed.error.value && !feed.isLoading.value
      ? errorMessage(feed.error.value, "Couldn't load agents.")
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
  const rows = computed<AgentRow[]>(() =>
    agents.value.map((agent) => ({
      agent,
      lastUsed: formatRelativeTime(agent.lastUsedAt),
      yours: agent.owner.id === auth.admin?.id,
    })),
  );

  async function loadMore(): Promise<void> {
    if (!hasMore.value || loadingMore.value) return;
    loadingMore.value = true;
    moreError.value = null;
    try {
      await feed.loadNextPage({ throwOnError: true });
    } catch (cause) {
      moreError.value = errorMessage(cause, "Couldn't load more agents.");
    } finally {
      loadingMore.value = false;
    }
  }

  // New agent
  const createOpen = ref(false);
  const draft = ref<NewAgentDraft>(emptyDraft());
  const createErrors = ref<{ name?: string; description?: string }>({});
  const capabilityErrors = ref<Record<number, string>>({});
  const createError = ref<string | null>(null);
  const creating = ref(false);
  /** The new agent and its token, shown once. */
  const created = ref<{ id: string; token: string } | null>(null);

  function openCreate(): void {
    draft.value = emptyDraft();
    createErrors.value = {};
    capabilityErrors.value = {};
    createError.value = null;
    createOpen.value = true;
  }

  function closeCreate(): void {
    if (!creating.value) createOpen.value = false;
  }

  async function submitCreate(): Promise<void> {
    if (creating.value) return;
    createError.value = null;
    const name = draft.value.name.trim();
    const errors: { name?: string; description?: string } = {};
    if (!NAME.test(name))
      errors.name = "Use 1 to 64 lowercase letters, digits, and dashes.";
    if (draft.value.description.trim().length > 280)
      errors.description = "Keep it to 280 characters.";
    const parsed = toCapabilities(draft.value.capabilities);
    capabilityErrors.value = parsed.ok ? {} : parsed.errors;
    createErrors.value = errors;
    if (!parsed.ok) createError.value = parsed.message;
    if (Object.keys(errors).length > 0 || !parsed.ok) return;

    creating.value = true;
    try {
      const description = draft.value.description.trim();
      const result = await createAgent({
        name,
        ...(description ? { description } : {}),
        capabilities: parsed.value,
      });
      createOpen.value = false;
      created.value = { id: result.agent.id, token: result.token };
      void invalidate.agentsChanged();
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.hasCode("AGENT_NAME_TAKEN")) {
          createErrors.value = {
            name: "You already have an agent with this name.",
          };
          return;
        }
        if (cause.hasCode("REQUEST_INVALID")) {
          createErrors.value = { name: cause.message };
          return;
        }
        if (cause.hasCode("CAPABILITIES_INVALID")) {
          createError.value = cause.message;
          return;
        }
      }
      createError.value = errorMessage(cause, "Couldn't create the agent.");
    } finally {
      creating.value = false;
    }
  }

  /** After the token is copied, open the new agent. */
  async function closeCreated(): Promise<void> {
    const id = created.value?.id;
    created.value = null;
    if (id) await router.push({ name: "agent", params: { id } });
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
    reload: () => feed.refetch(),
    loadMore,
    createOpen,
    draft,
    createErrors,
    capabilityErrors,
    createError,
    creating,
    created,
    openCreate,
    closeCreate,
    submitCreate,
    closeCreated,
  };
}
