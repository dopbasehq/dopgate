<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import CapabilitiesEditor from "~/components/app/CapabilitiesEditor.vue";
import FactList, { type Fact } from "~/components/app/FactList.vue";
import SaveFooter from "~/components/app/SaveFooter.vue";
import SectionCard from "~/components/app/SectionCard.vue";
import SettingRow from "~/components/app/SettingRow.vue";
import TokenReveal from "~/components/app/TokenReveal.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgInput,
  DgMenu,
  DgMenuItem,
  DgSkeleton,
  DgStatus,
} from "~/components/ui";
import {
  BotIcon,
  HistoryIcon,
  LockIcon,
  MoreHorizontalIcon,
  RefreshIcon,
  TrashIcon,
} from "~/assets/icons";
import { formatDateTime, formatRelativeTime } from "~/utils/format";
import { useAgentController } from "./Agent.controller";

const {
  agent,
  loadError,
  reload,
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
  discardDetails,
  saveCapabilities,
  discardCapabilities,
  enable,
  confirming,
  confirmError,
  ask,
  cancelConfirm,
  confirm,
  closeRevealed,
} = useAgentController();

const facts = computed<Fact[]>(() => {
  const current = agent.value;
  if (!current) return [];
  const { owner } = current;
  return [
    { label: "Agent ID", value: current.id, mono: true, copy: true },
    {
      label: "Owner",
      value: `${owner.email} (${owner.kind})`,
      mono: true,
      to:
        owner.kind === "user"
          ? { name: "user", params: { id: owner.id } }
          : undefined,
    },
    { label: "Created", value: formatDateTime(current.createdAt) },
    { label: "Last used", value: formatRelativeTime(current.lastUsedAt) },
  ];
});

const confirmCopy = computed(() => {
  const label = agent.value?.name ?? "this agent";
  switch (confirming.value) {
    case "disable":
      return {
        title: `Turn off ${label}?`,
        description:
          "Its next token trade is refused. Access tokens it already holds keep working on your backend until they expire.",
        confirmLabel: "Turn off",
        tone: "danger" as const,
      };
    case "regenerate":
      return {
        title: `Regenerate the token for ${label}?`,
        description:
          "The current token stops working right away. You'll see the new one once.",
        confirmLabel: "Regenerate",
        tone: "primary" as const,
      };
    default:
      return {
        title: `Delete ${label}?`,
        description:
          "The agent and its token are gone for good. The audit log keeps what happened.",
        confirmLabel: "Delete",
        tone: "danger" as const,
      };
  }
});
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <div v-if="loadError" class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div v-else-if="!agent" class="flex flex-col gap-3">
        <DgSkeleton class="h-10 w-72 rounded-control" />
        <DgSkeleton class="h-40 w-full rounded-card" />
      </div>

      <template v-else>
        <PageHeader
          :title="agent.name"
          :subtitle="agent.description ?? undefined"
          :trail="[{ label: 'Agents', to: { name: 'agents' } }]">
          <template #leading>
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-raised text-ink-strong"
              aria-hidden="true">
              <BotIcon class="h-5 w-5" />
            </span>
          </template>
          <template #meta>
            <div class="mt-2.5 flex flex-wrap items-center gap-3">
              <DgStatus v-if="agent.status === 'active'">On</DgStatus>
              <DgBadge v-else tone="crit">Turned off</DgBadge>
              <DgBadge v-if="isOwner">Yours</DgBadge>
            </div>
          </template>
          <template #actions>
            <RouterLink
              :to="{ name: 'audit', query: { actor: agent.id } }"
              class="inline-flex h-10 items-center gap-2 rounded-control px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-raised hover:text-ink-strong">
              <HistoryIcon class="h-4 w-4" />
              View in audit log
            </RouterLink>
            <DgMenu label="Agent actions">
              <template #trigger="{ toggle, attrs }">
                <DgButton
                  v-bind="attrs"
                  data-testid="agent-actions"
                  @click="toggle">
                  <MoreHorizontalIcon class="h-4 w-4" />
                  Actions
                </DgButton>
              </template>
              <DgMenuItem
                v-if="agent.status === 'disabled'"
                :disabled="busy !== null"
                @select="enable">
                <template #icon><LockIcon class="h-4 w-4" /></template>
                Turn back on
              </DgMenuItem>
              <DgMenuItem
                v-else
                :disabled="busy !== null"
                @select="ask('disable')">
                <template #icon><LockIcon class="h-4 w-4" /></template>
                Turn off
              </DgMenuItem>
              <div class="my-0.5 h-px bg-line-soft" role="separator" />
              <DgMenuItem tone="danger" @select="ask('delete')">
                <template #icon><TrashIcon class="h-4 w-4" /></template>
                Delete agent
              </DgMenuItem>
            </DgMenu>
          </template>
        </PageHeader>

        <DgAlert v-if="!isOwner" tone="info" data-testid="owner-note">
          Only {{ agent.owner.email }} can edit this agent or regenerate its
          token. You can turn it off or delete it.
        </DgAlert>
        <DgAlert v-if="notice" tone="success">{{ notice }}</DgAlert>
        <DgAlert v-if="error">{{ error }}</DgAlert>

        <!-- From 1024px the facts sit beside the cards; below that, above. -->
        <div
          class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <FactList :facts="facts" class="lg:col-start-2 lg:row-start-1" />

          <div
            class="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
            <SectionCard
              v-if="isOwner"
              as="form"
              title="Details"
              @submit.prevent="saveDetails">
              <SettingRow
                title="Name"
                description="Lowercase letters, digits, and dashes.">
                <DgInput
                  v-model="name"
                  label="Name"
                  mono
                  autocomplete="off"
                  :error="nameError" />
              </SettingRow>
              <SettingRow
                title="Description"
                description="What this agent is for.">
                <DgInput
                  v-model="description"
                  label="Description"
                  autocomplete="off"
                  placeholder="Optional. Only admins see it." />
              </SettingRow>
              <template #footer>
                <SaveFooter
                  :dirty="detailsDirty"
                  :saving="busy === 'details'"
                  @discard="discardDetails" />
              </template>
            </SectionCard>

            <SectionCard
              title="Token"
              description="The agent trades it at /api/v1/auth/token for a short-lived access token.">
              <div
                class="flex flex-col items-start gap-3 border-t border-line-soft pt-4 sm:flex-row sm:items-center">
                <p
                  class="flex h-9 w-full min-w-0 items-center rounded-control bg-raised px-3 font-mono text-sm text-ink-strong sm:flex-1">
                  dga_••••{{ agent.lastFour }}
                </p>
                <DgButton
                  v-if="isOwner"
                  class="shrink-0"
                  data-testid="regenerate-token"
                  :disabled="busy !== null"
                  @click="ask('regenerate')">
                  <RefreshIcon class="h-4 w-4" />
                  Regenerate token
                </DgButton>
              </div>
            </SectionCard>

            <SectionCard
              as="form"
              title="Capabilities"
              description="Your app reads these from the agent's access token. Dopgate doesn't enforce them."
              @submit.prevent="saveCapabilities">
              <div
                class="border-t border-line-soft pt-4"
                :class="isOwner ? 'pb-4' : ''">
                <CapabilitiesEditor
                  v-model="capabilities"
                  :readonly="!isOwner"
                  :errors="capabilityErrors" />
              </div>
              <template v-if="isOwner" #footer>
                <SaveFooter
                  :dirty="capabilitiesDirty"
                  :saving="busy === 'capabilities'"
                  @discard="discardCapabilities" />
              </template>
            </SectionCard>
          </div>
        </div>
      </template>
    </div>

    <DgConfirmDialog
      :open="confirming !== null"
      :title="confirmCopy.title"
      :description="confirmCopy.description"
      :confirm-label="confirmCopy.confirmLabel"
      :tone="confirmCopy.tone"
      :loading="busy !== null"
      :error="confirmError"
      @confirm="confirm"
      @close="cancelConfirm" />

    <TokenReveal
      :open="revealed !== null"
      title="New token"
      :token="revealed"
      @close="closeRevealed" />
  </DashboardLayout>
</template>
