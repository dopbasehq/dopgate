<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import CapabilitiesEditor from "~/components/app/CapabilitiesEditor.vue";
import TokenReveal from "~/components/app/TokenReveal.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgFilterMenu,
  DgInput,
  DgModal,
  DgSearchField,
  DgSkeleton,
  DgStatus,
  DgTextarea,
} from "~/components/ui";
import { ChevronRightIcon, PlusIcon } from "~/assets/icons";
import {
  STATUS_FILTERS,
  useAgentsController,
  type AgentRow,
} from "./Agents.controller";

const {
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
  open,
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
} = useAgentsController();

const off = (row: AgentRow) => row.agent.status !== "active";

/**
 * A click anywhere on a row opens the agent. The name is a real link, so
 * keyboard users, middle clicks and "open in new tab" go through it.
 */
function onRowClick(event: MouseEvent, row: AgentRow): void {
  if ((event.target as Element).closest("a, button")) return;
  if (window.getSelection()?.toString()) return;
  void open(row);
}
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Agents"
        subtitle="Bots and AI agents. Each belongs to an admin or a user and signs in with its own token.">
        <template #actions>
          <DgButton
            variant="primary"
            data-testid="new-agent"
            @click="openCreate">
            <PlusIcon class="h-4 w-4" />
            New agent
          </DgButton>
        </template>
      </PageHeader>

      <div class="flex flex-wrap items-center gap-2">
        <DgSearchField
          v-model="search"
          class="w-full sm:w-72"
          placeholder="Search by name" />
        <DgFilterMenu
          v-model="statusFilter"
          label="Status"
          :options="STATUS_FILTERS" />
      </div>

      <div
        v-if="loadError && rows.length === 0"
        class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div v-else-if="loading" class="flex flex-col gap-2">
        <DgSkeleton
          v-for="line in 4"
          :key="line"
          class="h-12 w-full rounded-control" />
      </div>

      <template v-else>
        <div class="overflow-x-auto rounded-card border border-line bg-panel">
          <!-- Table from 640px; Last used shows from 1024px. -->
          <table
            class="hidden min-w-full text-left text-sm sm:table"
            data-testid="agents-table">
            <thead>
              <tr class="border-b border-line-soft bg-raised/50">
                <th class="h-11 w-[35%] px-4 font-medium text-ink-muted">
                  Name
                </th>
                <th class="h-11 w-[35%] px-4 font-medium text-ink-muted">
                  Owner
                </th>
                <th class="h-11 px-4 font-medium text-ink-muted">Status</th>
                <th
                  class="hidden h-11 whitespace-nowrap px-4 font-medium text-ink-muted lg:table-cell">
                  Last used
                </th>
                <th class="h-11 w-10 px-2">
                  <span class="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.agent.id"
                class="cursor-pointer border-b border-line-soft last:border-b-0 hover:bg-raised/40"
                data-testid="agent-row"
                @click="onRowClick($event, row)">
                <td class="h-[52px] px-4">
                  <RouterLink
                    :to="{ name: 'agent', params: { id: row.agent.id } }"
                    class="font-mono hover:underline"
                    :class="off(row) ? 'text-ink-faint' : 'text-ink-strong'">
                    {{ row.agent.name }}
                  </RouterLink>
                </td>
                <td class="max-w-0 px-4">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate font-mono text-ink">{{
                      row.agent.owner.email
                    }}</span>
                    <span class="shrink-0 whitespace-nowrap text-ink-faint"
                      >{{ row.agent.owner.kind
                      }}<template v-if="row.yours"> · you</template></span
                    >
                  </span>
                </td>
                <td class="whitespace-nowrap px-4">
                  <DgBadge v-if="off(row)" tone="crit">Turned off</DgBadge>
                  <DgStatus v-else>On</DgStatus>
                </td>
                <td
                  class="hidden whitespace-nowrap px-4 text-ink-muted lg:table-cell">
                  {{ row.lastUsed }}
                </td>
                <td class="px-2 text-ink-muted">
                  <ChevronRightIcon
                    class="ml-auto h-4 w-4"
                    aria-hidden="true" />
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Cards below 640px -->
          <ul class="divide-y divide-line-soft sm:hidden">
            <li
              v-for="row in rows"
              :key="row.agent.id"
              data-testid="agent-card">
              <RouterLink
                :to="{ name: 'agent', params: { id: row.agent.id } }"
                class="flex items-center gap-3 px-4 py-3 hover:bg-raised/40">
                <span class="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <span
                    class="font-mono [overflow-wrap:anywhere]"
                    :class="off(row) ? 'text-ink-faint' : 'text-ink-strong'">
                    {{ row.agent.name }}
                  </span>
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate font-mono text-ink">{{
                      row.agent.owner.email
                    }}</span>
                    <span class="shrink-0 whitespace-nowrap text-ink-faint"
                      >{{ row.agent.owner.kind
                      }}<template v-if="row.yours"> · you</template></span
                    >
                  </span>
                  <span class="mt-0.5 flex flex-wrap items-center gap-3">
                    <DgBadge v-if="off(row)" tone="crit">Turned off</DgBadge>
                    <DgStatus v-else>On</DgStatus>
                    <span class="text-ink-muted">{{ row.lastUsed }}</span>
                  </span>
                </span>
                <ChevronRightIcon
                  class="h-4 w-4 shrink-0 text-ink-muted"
                  aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>

          <p
            v-if="rows.length === 0"
            class="px-4 py-8 text-center text-sm text-ink-muted">
            {{
              filtered
                ? "No agents match these filters."
                : "No agents yet. Make one for a bot that calls your app."
            }}
          </p>
        </div>
        <DgAlert v-if="loadError">{{ loadError }}</DgAlert>
        <div v-if="hasMore" class="flex justify-center">
          <DgButton :loading="loadingMore" @click="loadMore">
            Load more
          </DgButton>
        </div>
      </template>
    </div>

    <DgModal
      :open="createOpen"
      title="New agent"
      size="lg"
      @close="closeCreate">
      <form
        id="new-agent-form"
        class="flex flex-col gap-3"
        novalidate
        @submit.prevent="submitCreate">
        <DgInput
          v-model="draft.name"
          label="Name"
          mono
          autocomplete="off"
          placeholder="invoice-bot"
          hint="Lowercase letters, digits, and dashes."
          required
          autofocus
          :error="createErrors.name" />
        <DgTextarea
          v-model="draft.description"
          label="Description"
          placeholder="Optional. Only admins see it."
          :rows="2"
          :error="createErrors.description" />
        <div class="flex flex-col gap-1.5">
          <span class="text-sm font-semibold text-ink-strong"
            >Capabilities</span
          >
          <p class="text-sm text-ink-muted">
            Your app reads these from the agent's access token to decide what it
            may do. You'll own this agent.
          </p>
        </div>
        <CapabilitiesEditor
          v-model="draft.capabilities"
          :errors="capabilityErrors" />
        <DgAlert v-if="createError">{{ createError }}</DgAlert>
      </form>
      <template #footer>
        <DgButton variant="ghost" :disabled="creating" @click="closeCreate">
          Cancel
        </DgButton>
        <DgButton
          type="submit"
          form="new-agent-form"
          variant="primary"
          :loading="creating">
          Create agent
        </DgButton>
      </template>
    </DgModal>

    <TokenReveal
      :open="created !== null"
      title="Your agent's token"
      :token="created?.token ?? null"
      @close="closeCreated" />
  </DashboardLayout>
</template>
