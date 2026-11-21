<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgCopyButton,
  DgEmptyState,
  DgSearchField,
  DgSheet,
  DgSkeleton,
} from "~/components/ui";
import {
  ChevronRightIcon,
  HistoryIcon,
  ShieldIcon,
  TerminalIcon,
} from "~/assets/icons";
import { formatDateTime, formatRelativeTime } from "~/utils/format";
import { formatJson } from "~/utils/json";
import { actionTone, actorName, shortId, utcTimestamp } from "~/utils/audit";
import AuditActionFilter from "./AuditActionFilter.vue";
import { useAuditController } from "./Audit.controller";

/**
 * Audit log: every change on this server, newest first. Filters narrow it
 * by action and actor and stay in the address. A row opens the event in a
 * drawer on the right, with its metadata and where it stands in the hash
 * chain. From 1024px the table has a Resource column; below 640px the rows
 * are cards.
 */
const {
  action,
  actor,
  setAction,
  filtered,
  events,
  loading,
  loadError,
  hasMore,
  loadingMore,
  reload,
  loadMore,
  clearFilters,
  selected,
  openEvent,
  closeEvent,
  verifying,
  verification,
  verifyError,
  verify,
  chainLine,
} = useAuditController();

const actionModel = computed({
  get: () => action.value,
  set: (value: string) => setAction(value),
});

const CHAIN_TONES = {
  ok: "bg-ok/15 text-ink-strong [&>svg]:text-ok",
  crit: "bg-crit/15 text-ink-strong [&>svg]:text-crit",
  neutral: "bg-raised text-ink-muted",
};

const metadata = computed(() =>
  selected.value ? formatJson(selected.value.metadata) : "",
);

/** The actor's ID when the label alone doesn't show it. */
const actorId = computed(() => {
  const event = selected.value;
  if (!event?.actorId || event.actorLabel === null) return null;
  return event.actorId;
});
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Audit log"
        subtitle="Every change on this server, newest first. Each record is chained to the one before it.">
        <template #actions>
          <DgButton
            variant="primary"
            :loading="verifying"
            data-testid="verify-chain"
            @click="verify">
            <ShieldIcon class="h-4 w-4" />
            Verify chain
          </DgButton>
        </template>
      </PageHeader>

      <DgAlert
        v-if="verification"
        :tone="verification.ok ? 'success' : 'error'"
        :title="verification.title"
        data-testid="verification">
        {{ verification.detail }}
      </DgAlert>
      <DgAlert v-if="verifyError">{{ verifyError }}</DgAlert>

      <div
        class="flex flex-wrap items-center gap-2"
        data-testid="audit-filters">
        <AuditActionFilter v-model="actionModel" />
        <DgSearchField
          v-model="actor"
          class="w-full sm:w-64"
          placeholder="Actor ID or email"
          label="Filter by actor" />
        <DgButton
          v-if="filtered"
          size="sm"
          variant="ghost"
          @click="clearFilters">
          Clear
        </DgButton>
      </div>

      <div
        v-if="loadError && events.length === 0"
        class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div
        v-else-if="loading"
        class="flex flex-col overflow-hidden rounded-card border border-line bg-panel"
        data-testid="audit-skeleton">
        <div
          v-for="line in 6"
          :key="line"
          class="flex h-[52px] items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
          <DgSkeleton class="h-4 w-16" />
          <DgSkeleton class="h-6 w-40 rounded-control" />
          <DgSkeleton class="hidden h-4 w-48 sm:block" />
        </div>
      </div>

      <DgEmptyState
        v-else-if="events.length === 0"
        :title="filtered ? 'No matching events' : 'No events yet'"
        :description="
          filtered
            ? 'No events match these filters.'
            : 'Changes on this server show up here as they happen.'
        "
        data-testid="audit-empty">
        <template #icon>
          <HistoryIcon class="h-5 w-5" />
        </template>
      </DgEmptyState>

      <template v-else>
        <!-- Phones: one card per event. -->
        <ul
          class="flex flex-col overflow-hidden rounded-card border border-line bg-panel sm:hidden"
          data-testid="audit-cards">
          <li
            v-for="event in events"
            :key="event.id"
            class="border-b border-line-soft last:border-b-0">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-3 py-3 pl-4 pr-3 text-left transition-colors hover:bg-raised/60"
              @click="openEvent(event)">
              <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                <span class="flex items-center justify-between gap-2">
                  <DgBadge :tone="actionTone(event.action)" class="truncate">
                    {{ event.action }}
                  </DgBadge>
                  <span
                    class="shrink-0 text-sm text-ink-muted"
                    :title="formatDateTime(event.createdAt)">
                    {{ formatRelativeTime(event.createdAt) }}
                  </span>
                </span>
                <span class="truncate font-mono text-sm text-ink">
                  {{ actorName(event)
                  }}<template v-if="event.resourceId">
                    · {{ shortId(event.resourceId, 8, 4) }}</template
                  >
                </span>
              </span>
              <ChevronRightIcon class="h-4 w-4 shrink-0 text-ink-faint" />
            </button>
          </li>
        </ul>

        <div
          class="hidden overflow-hidden rounded-card border border-line sm:block">
          <table
            class="w-full table-fixed text-left text-sm"
            data-testid="audit-table">
            <thead class="bg-panel">
              <tr class="border-b border-line-soft">
                <th class="h-10 w-28 px-4 font-medium text-ink-muted">Time</th>
                <th class="h-10 w-60 px-4 font-medium text-ink-muted">
                  Action
                </th>
                <th class="h-10 px-4 font-medium text-ink-muted">Actor</th>
                <th
                  class="hidden h-10 w-[300px] px-4 font-medium text-ink-muted lg:table-cell">
                  Resource
                </th>
                <th class="h-10 w-10 px-2">
                  <span class="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="event in events"
                :key="event.id"
                class="cursor-pointer border-b border-line-soft transition-colors last:border-b-0 hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline-none"
                :class="selected?.id === event.id ? 'bg-raised' : ''"
                tabindex="0"
                :aria-label="`${event.action} by ${actorName(event)}, ${formatRelativeTime(event.createdAt)}`"
                data-testid="audit-row"
                @click="openEvent(event)"
                @keydown.enter="openEvent(event)">
                <td
                  class="h-[52px] whitespace-nowrap px-4 text-ink"
                  :title="formatDateTime(event.createdAt)">
                  {{ formatRelativeTime(event.createdAt) }}
                </td>
                <td class="px-4">
                  <DgBadge
                    :tone="actionTone(event.action)"
                    class="max-w-full truncate">
                    {{ event.action }}
                  </DgBadge>
                </td>
                <td class="px-4">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate font-mono text-ink">
                      {{ actorName(event) }}
                    </span>
                    <span
                      v-if="event.actorLabel && event.actorType !== 'service'"
                      class="shrink-0 text-ink-faint">
                      {{ event.actorType }}
                    </span>
                  </span>
                </td>
                <td class="hidden px-4 lg:table-cell">
                  <span
                    v-if="event.resourceType"
                    class="flex min-w-0 items-center gap-2"
                    :title="event.resourceId ?? undefined">
                    <span class="shrink-0 text-ink-muted">
                      {{ event.resourceType }}
                    </span>
                    <span
                      v-if="event.resourceId"
                      class="truncate font-mono text-ink">
                      {{ event.resourceId }}
                    </span>
                  </span>
                </td>
                <td class="px-2">
                  <ChevronRightIcon class="h-4 w-4 text-ink-faint" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <DgAlert v-if="loadError">{{ loadError }}</DgAlert>
        <div v-if="hasMore" class="flex justify-center">
          <DgButton
            variant="ghost"
            :loading="loadingMore"
            data-testid="load-more"
            @click="loadMore">
            Load more
          </DgButton>
        </div>
      </template>
    </div>

    <DgSheet
      :open="selected !== null"
      :title="selected?.action ?? ''"
      side="right"
      @close="closeEvent">
      <div
        v-if="selected"
        class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm"
        data-testid="audit-event">
        <p class="text-ink-muted">
          Event
          {{ selected.seq !== null ? `#${selected.seq}` : selected.id }}
          ·
          {{ formatRelativeTime(selected.createdAt) }}
        </p>

        <dl
          class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-3 sm:grid-cols-[130px_minmax(0,1fr)]">
          <dt class="text-ink-muted">When</dt>
          <dd class="text-ink-strong">
            {{ formatDateTime(selected.createdAt) }}
          </dd>
          <dt class="text-ink-muted">UTC</dt>
          <dd class="font-mono text-ink-strong">
            {{ utcTimestamp(selected.createdAt) }}
          </dd>
          <dt class="text-ink-muted">Actor</dt>
          <dd class="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span class="font-mono text-ink-strong [overflow-wrap:anywhere]">
              {{ actorName(selected) }}
            </span>
            <span
              v-if="selected.actorType !== actorName(selected)"
              class="text-ink-faint">
              {{ selected.actorType }}
            </span>
          </dd>
          <template v-if="actorId">
            <dt class="text-ink-muted">Actor ID</dt>
            <dd class="font-mono text-ink-strong [overflow-wrap:anywhere]">
              {{ actorId }}
            </dd>
          </template>
          <template v-if="selected.resourceType">
            <dt class="text-ink-muted">Resource</dt>
            <dd class="font-mono text-ink-strong [overflow-wrap:anywhere]">
              {{ selected.resourceType }} {{ selected.resourceId ?? "" }}
            </dd>
          </template>
          <template v-if="selected.ipAddress">
            <dt class="text-ink-muted">IP address</dt>
            <dd class="font-mono text-ink-strong">
              {{ selected.ipAddress }}
            </dd>
          </template>
        </dl>

        <div class="rounded-card border border-line bg-editor">
          <div
            class="flex items-center gap-2 border-b border-line-soft py-1 pl-3 pr-1">
            <TerminalIcon class="h-3.5 w-3.5 text-ink-muted" />
            <p class="flex-1 font-medium text-ink-muted">Metadata</p>
            <DgCopyButton :value="metadata" label="Copy metadata" icon-only />
          </div>
          <pre
            class="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-ink-strong"
            data-testid="audit-metadata"
            >{{ metadata }}</pre>
        </div>

        <section
          v-if="selected.seq !== null || selected.recordHash"
          class="flex flex-col gap-3 border-t border-line-soft pt-4"
          aria-label="Hash chain">
          <h3 class="text-sm font-medium text-ink-muted">Hash chain</h3>
          <dl
            class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-3 sm:grid-cols-[130px_minmax(0,1fr)]">
            <template v-if="selected.seq !== null">
              <dt class="text-ink-muted">Sequence</dt>
              <dd class="font-mono text-ink-strong">#{{ selected.seq }}</dd>
            </template>
            <template v-if="selected.recordHash">
              <dt class="text-ink-muted">Hash</dt>
              <dd class="font-mono text-ink-strong break-all">
                {{ selected.recordHash }}
              </dd>
            </template>
            <template v-if="selected.prevHash">
              <dt class="text-ink-muted">Previous hash</dt>
              <dd class="font-mono text-ink-strong break-all">
                {{ selected.prevHash }}
              </dd>
            </template>
          </dl>
        </section>

        <p
          class="flex items-start gap-2.5 rounded-control px-3 py-2.5 leading-5"
          :class="CHAIN_TONES[chainLine(selected).tone]"
          data-testid="audit-chain">
          <ShieldIcon class="mt-0.5 h-4 w-4 shrink-0" />
          <span class="min-w-0 break-words">{{
            chainLine(selected).text
          }}</span>
        </p>
      </div>
    </DgSheet>
  </DashboardLayout>
</template>
