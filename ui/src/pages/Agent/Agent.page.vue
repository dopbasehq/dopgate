<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import CapabilitiesEditor from "~/components/app/CapabilitiesEditor.vue";
import TokenReveal from "~/components/app/TokenReveal.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgCopyButton,
  DgInput,
  DgMenu,
  DgMenuItem,
  DgSkeleton,
  DgTextarea,
} from "~/components/ui";
import { LockIcon, RefreshIcon, TrashIcon } from "~/assets/icons";
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
  saveCapabilities,
  enable,
  confirming,
  confirmError,
  ask,
  cancelConfirm,
  confirm,
  closeRevealed,
} = useAgentController();

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

const card = "rounded-card border border-line bg-panel";
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
          <template #meta>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <DgBadge :tone="agent.status === 'active' ? 'ok' : 'crit'">
                {{ agent.status === "active" ? "On" : "Turned off" }}
              </DgBadge>
              <DgBadge
                :tone="agent.owner.kind === 'admin' ? 'accent' : 'neutral'">
                Owned by
                {{ agent.owner.kind === "admin" ? "an admin" : "a user" }}
              </DgBadge>
              <DgBadge v-if="isOwner">Yours</DgBadge>
            </div>
          </template>
          <template #actions>
            <DgMenu label="Agent actions">
              <template #trigger="{ toggle, attrs }">
                <DgButton
                  v-bind="attrs"
                  data-testid="agent-actions"
                  @click="toggle">
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

        <div class="grid gap-5 lg:grid-cols-2">
          <section :class="card" aria-labelledby="details-heading">
            <header class="border-b border-line-soft px-5 py-3.5">
              <h2 id="details-heading" class="text-[15px]">Details</h2>
            </header>
            <div class="flex flex-col gap-4 px-5 py-4">
              <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt class="text-ink-muted">Agent ID</dt>
                <dd class="flex min-w-0 items-center gap-1">
                  <span class="truncate font-mono text-ink">{{
                    agent.id
                  }}</span>
                  <DgCopyButton
                    :value="agent.id"
                    label="Copy agent ID"
                    icon-only />
                </dd>
                <dt class="text-ink-muted">Owner</dt>
                <dd class="flex min-w-0 items-center gap-1">
                  <RouterLink
                    v-if="agent.owner.kind === 'user'"
                    :to="{ name: 'user', params: { id: agent.owner.id } }"
                    class="truncate font-mono text-ink hover:underline">
                    {{ agent.owner.email }}
                  </RouterLink>
                  <span v-else class="truncate font-mono text-ink">{{
                    agent.owner.email
                  }}</span>
                </dd>
                <dt class="text-ink-muted">Created</dt>
                <dd class="text-ink">{{ formatDateTime(agent.createdAt) }}</dd>
                <dt class="text-ink-muted">Last used</dt>
                <dd class="text-ink">
                  {{ formatRelativeTime(agent.lastUsedAt) }}
                </dd>
              </dl>
              <form
                v-if="isOwner"
                class="flex flex-col gap-3"
                novalidate
                @submit.prevent="saveDetails">
                <DgInput v-model="name" label="Name" mono :error="nameError" />
                <DgTextarea
                  v-model="description"
                  label="Description"
                  :rows="2" />
                <div class="flex justify-end">
                  <DgButton
                    type="submit"
                    variant="primary"
                    :disabled="!detailsDirty"
                    :loading="busy === 'details'">
                    Save
                  </DgButton>
                </div>
              </form>
            </div>
          </section>

          <section :class="card" aria-labelledby="token-heading">
            <header class="border-b border-line-soft px-5 py-3.5">
              <h2 id="token-heading" class="text-[15px]">Token</h2>
              <p class="mt-0.5 text-sm text-ink-muted">
                The agent trades it at /api/v1/auth/token for a short-lived
                access token.
              </p>
            </header>
            <div class="flex flex-col gap-4 px-5 py-4">
              <p class="font-mono text-sm text-ink">
                dga_••••{{ agent.lastFour }}
              </p>
              <div v-if="isOwner">
                <DgButton
                  data-testid="regenerate-token"
                  :disabled="busy !== null"
                  @click="ask('regenerate')">
                  <RefreshIcon class="h-4 w-4" />
                  Regenerate token
                </DgButton>
              </div>
            </div>
          </section>
        </div>

        <section :class="card" aria-labelledby="capabilities-heading">
          <header class="border-b border-line-soft px-5 py-3.5">
            <h2 id="capabilities-heading" class="text-[15px]">Capabilities</h2>
            <p class="mt-0.5 text-sm text-ink-muted">
              Your app reads these from the agent's access token. Dopgate
              doesn't enforce them.
            </p>
          </header>
          <form
            class="flex flex-col gap-4 px-5 py-4"
            novalidate
            @submit.prevent="saveCapabilities">
            <CapabilitiesEditor
              v-model="capabilities"
              :readonly="!isOwner"
              :errors="capabilityErrors" />
            <div v-if="isOwner" class="flex justify-end">
              <DgButton
                type="submit"
                variant="primary"
                :disabled="!capabilitiesDirty"
                :loading="busy === 'capabilities'">
                Save capabilities
              </DgButton>
            </div>
          </form>
        </section>
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
