<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import { DgAlert, DgButton, DgSearchField, DgSkeleton } from "~/components/ui";
import { ChevronRightIcon, ShieldIcon } from "~/assets/icons";
import { formatDateTime, formatRelativeTime } from "~/utils/format";
import { formatJson } from "~/utils/json";
import { useAuditController } from "./Audit.controller";

const {
  action,
  actor,
  filtered,
  events,
  loading,
  loadError,
  hasMore,
  loadingMore,
  reload,
  loadMore,
  expanded,
  toggle,
  clearFilters,
  verifying,
  verification,
  verifyError,
  verify,
} = useAuditController();
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Audit log"
        subtitle="Every change on this server, newest first. Each record is chained to the one before it.">
        <template #actions>
          <DgButton
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

      <div class="flex flex-wrap items-center gap-2">
        <DgSearchField
          v-model="action"
          class="w-full sm:w-64"
          placeholder="Action, e.g. user.created"
          label="Filter by action" />
        <DgSearchField
          v-model="actor"
          class="w-full sm:w-64"
          placeholder="Actor ID or email"
          label="Filter by actor" />
        <DgButton
          v-if="action || actor"
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

      <div v-else-if="loading" class="flex flex-col gap-2">
        <DgSkeleton
          v-for="line in 6"
          :key="line"
          class="h-12 w-full rounded-control" />
      </div>

      <template v-else>
        <ul
          v-if="events.length > 0"
          class="divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-panel"
          data-testid="audit-list">
          <li v-for="event in events" :key="event.id">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-raised/40"
              :aria-expanded="expanded.has(event.id)"
              @click="toggle(event.id)">
              <ChevronRightIcon
                class="h-4 w-4 shrink-0 text-ink-faint transition-transform"
                :class="expanded.has(event.id) ? 'rotate-90' : ''" />
              <span class="w-44 shrink-0 font-mono text-ink-strong">{{
                event.action
              }}</span>
              <span class="min-w-0 flex-1 truncate text-ink">
                {{ event.actorLabel ?? event.actorId ?? event.actorType }}
                <template v-if="event.resourceId">
                  <span class="text-ink-faint"> on </span>
                  <span class="font-mono">{{ event.resourceId }}</span>
                </template>
              </span>
              <span
                class="hidden shrink-0 text-ink-muted sm:block"
                :title="formatDateTime(event.createdAt)">
                {{ formatRelativeTime(event.createdAt) }}
              </span>
            </button>
            <div
              v-if="expanded.has(event.id)"
              class="flex flex-col gap-3 border-t border-line-soft bg-canvas/40 px-4 py-3 pl-11 text-sm">
              <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                <dt class="text-ink-muted">When</dt>
                <dd class="text-ink">{{ formatDateTime(event.createdAt) }}</dd>
                <dt class="text-ink-muted">Actor</dt>
                <dd class="font-mono text-ink">
                  {{ event.actorType
                  }}{{ event.actorId ? ` ${event.actorId}` : "" }}
                </dd>
                <template v-if="event.resourceType">
                  <dt class="text-ink-muted">Resource</dt>
                  <dd class="font-mono text-ink">
                    {{ event.resourceType }} {{ event.resourceId ?? "" }}
                  </dd>
                </template>
                <template v-if="event.ipAddress">
                  <dt class="text-ink-muted">IP address</dt>
                  <dd class="font-mono text-ink">{{ event.ipAddress }}</dd>
                </template>
                <template v-if="event.seq !== null">
                  <dt class="text-ink-muted">Sequence</dt>
                  <dd class="font-mono text-ink">#{{ event.seq }}</dd>
                </template>
                <template v-if="event.recordHash">
                  <dt class="text-ink-muted">Hash</dt>
                  <dd
                    class="truncate font-mono text-ink"
                    :title="event.recordHash">
                    {{ event.recordHash }}
                  </dd>
                </template>
              </dl>
              <pre
                class="overflow-x-auto rounded-control bg-raised px-3 py-2 font-mono text-xs text-ink"
                data-testid="audit-metadata"
                >{{ formatJson(event.metadata) }}</pre>
            </div>
          </li>
        </ul>
        <p
          v-else
          class="rounded-card border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
          {{ filtered ? "No events match these filters." : "No events yet." }}
        </p>

        <DgAlert v-if="loadError">{{ loadError }}</DgAlert>
        <div v-if="hasMore" class="flex justify-center">
          <DgButton
            :loading="loadingMore"
            data-testid="load-more"
            @click="loadMore">
            Load more
          </DgButton>
        </div>
      </template>
    </div>
  </DashboardLayout>
</template>
