import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@pinia/colada";
import { ApiError, errorMessage } from "~/services/api";
import {
  deleteAgent,
  disableAgent,
  enableAgent,
  regenerateAgent,
  updateAgent,
} from "~/services/admin.api";
import type { Agent } from "~/services/types";
import { agentQuery } from "~/queries/admin";
import { useInvalidate } from "~/queries/invalidate";
import { useAuthStore } from "~/stores/auth.store";
import {
  rowsFrom,
  toCapabilities,
  type CapabilityRow,
} from "~/utils/capabilities";

/** Actions that ask before they run. */
export type AgentConfirm = "disable" | "delete" | "regenerate";

/**
 * Agent page controller: one agent, its owner, capabilities, and token.
 * Any admin can turn it off, back on, or delete it. Only its owner edits
 * the details and capabilities or regenerates the token; everyone else
 * sees them read-only.
 */
export function useAgentController() {
  const route = useRoute();
  const router = useRouter();
  const auth = useAuthStore();
  const invalidate = useInvalidate();

  const id = computed(() => String(route.params.id ?? ""));
  const read = useQuery(() => agentQuery(id.value));
  const agent = computed<Agent | null>(() => read.data.value ?? null);
  const loadError = computed(() =>
    read.error.value && !read.isLoading.value
      ? errorMessage(read.error.value, "Couldn't load this agent.")
      : null,
  );
  const isOwner = computed(() => agent.value?.owner.id === auth.admin?.id);

  // Drafts follow the loaded agent until edited.
  const name = ref("");
  const description = ref("");
  const capabilities = ref<CapabilityRow[]>([]);
  watch(
    agent,
    (next, previous) => {
      if (!next) return;
      if (!previous || name.value === previous.name) name.value = next.name;
      if (!previous || description.value === (previous.description ?? ""))
        description.value = next.description ?? "";
      if (
        !previous ||
        JSON.stringify(capabilities.value) ===
          JSON.stringify(rowsFrom(previous.capabilities))
      )
        capabilities.value = rowsFrom(next.capabilities);
    },
    { immediate: true },
  );

  const detailsDirty = computed(
    () =>
      agent.value !== null &&
      (name.value.trim() !== agent.value.name ||
        description.value.trim() !== (agent.value.description ?? "")),
  );
  const capabilitiesDirty = computed(
    () =>
      agent.value !== null &&
      JSON.stringify(capabilities.value) !==
        JSON.stringify(rowsFrom(agent.value.capabilities)),
  );

  const busy = ref<string | null>(null);
  const notice = ref<string | null>(null);
  const error = ref<string | null>(null);
  const nameError = ref<string | null>(null);
  const capabilityErrors = ref<Record<number, string>>({});
  /** A regenerated token, shown once. */
  const revealed = ref<string | null>(null);

  async function changed(next: Agent): Promise<void> {
    await invalidate.agentChanged(next);
  }

  async function run(
    name: string,
    action: () => Promise<void>,
    fallback: string,
  ): Promise<boolean> {
    if (busy.value) return false;
    busy.value = name;
    error.value = null;
    notice.value = null;
    try {
      await action();
      return true;
    } catch (cause) {
      error.value = errorMessage(cause, fallback);
      return false;
    } finally {
      busy.value = null;
    }
  }

  async function saveDetails(): Promise<boolean> {
    nameError.value = null;
    const nextName = name.value.trim();
    if (!/^[a-z0-9-]{1,64}$/.test(nextName)) {
      nameError.value = "Use 1 to 64 lowercase letters, digits, and dashes.";
      return false;
    }
    return run(
      "details",
      async () => {
        try {
          const next = await updateAgent(id.value, {
            name: nextName,
            description: description.value.trim(),
          });
          await changed(next);
          notice.value = "Details saved.";
        } catch (cause) {
          if (cause instanceof ApiError && cause.hasCode("AGENT_NAME_TAKEN")) {
            nameError.value = "You already have an agent with this name.";
            return;
          }
          throw cause;
        }
      },
      "Couldn't save the details.",
    );
  }

  async function saveCapabilities(): Promise<boolean> {
    const parsed = toCapabilities(capabilities.value);
    capabilityErrors.value = parsed.ok ? {} : parsed.errors;
    if (!parsed.ok) {
      error.value = parsed.message;
      return false;
    }
    return run(
      "capabilities",
      async () => {
        const next = await updateAgent(id.value, {
          capabilities: parsed.value,
        });
        capabilities.value = rowsFrom(next.capabilities);
        await changed(next);
        notice.value =
          "Capabilities saved. They show up in the agent's next access token.";
      },
      "Couldn't save the capabilities.",
    );
  }

  function enable(): Promise<boolean> {
    return run(
      "enable",
      async () => {
        await changed(await enableAgent(id.value));
        notice.value = "Agent turned back on.";
      },
      "Couldn't turn the agent on.",
    );
  }

  // Confirmed actions
  const confirming = ref<AgentConfirm | null>(null);
  const confirmError = ref<string | null>(null);

  function ask(kind: AgentConfirm): void {
    confirmError.value = null;
    confirming.value = kind;
  }

  function cancelConfirm(): void {
    if (!busy.value) confirming.value = null;
  }

  async function confirm(): Promise<void> {
    const kind = confirming.value;
    if (!kind || busy.value) return;
    busy.value = kind;
    confirmError.value = null;
    notice.value = null;
    try {
      if (kind === "disable") {
        await changed(await disableAgent(id.value));
        notice.value = "Agent turned off. Its next token trade is refused.";
      } else if (kind === "regenerate") {
        const result = await regenerateAgent(id.value);
        await changed(result.agent);
        revealed.value = result.token;
      } else {
        await deleteAgent(id.value);
        void invalidate.agentsChanged();
        await router.push({ name: "agents" });
      }
      confirming.value = null;
    } catch (cause) {
      confirmError.value = errorMessage(cause, "That didn't work. Try again.");
    } finally {
      busy.value = null;
    }
  }

  return {
    id,
    agent,
    loadError,
    reload: () => read.refetch(),
    isOwner,
    name,
    description,
    capabilities,
    detailsDirty,
    capabilitiesDirty,
    busy,
    notice,
    error,
    nameError,
    capabilityErrors,
    revealed,
    saveDetails,
    saveCapabilities,
    enable,
    confirming,
    confirmError,
    ask,
    cancelConfirm,
    confirm,
    closeRevealed: () => (revealed.value = null),
  };
}
