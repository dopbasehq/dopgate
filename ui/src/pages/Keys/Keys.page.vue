<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import SectionCard from "~/components/app/SectionCard.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgCopyButton,
  DgSkeleton,
  DgStatus,
} from "~/components/ui";
import { RefreshIcon } from "~/assets/icons";
import { formatDateTime } from "~/utils/format";
import { useKeysController } from "./Keys.controller";

const {
  keys,
  loadError,
  reload,
  jwksUrl,
  canRotate,
  confirmOpen,
  rotating,
  rotateError,
  notice,
  askRotate,
  closeRotate,
  rotate,
} = useKeysController();

/** Active is the normal state, so it gets a dot; the others a badge. */
const BADGES = {
  retiring: { tone: "warn", label: "Retiring" },
  retired: { tone: "neutral", label: "Retired" },
} as const;

const date = (iso: string | null) => (iso ? formatDateTime(iso) : "—");
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Signing keys"
        subtitle="The keys that sign access tokens.">
        <template v-if="canRotate" #actions>
          <DgButton data-testid="rotate-key" @click="askRotate">
            <RefreshIcon class="h-4 w-4" />
            Rotate
          </DgButton>
        </template>
      </PageHeader>

      <DgAlert v-if="notice" tone="success">{{ notice }}</DgAlert>

      <SectionCard
        title="Key set"
        description="Apps check tokens with the public keys at this address.">
        <div
          class="flex h-10 min-w-0 items-center gap-2 rounded-control border border-line pl-3 pr-1">
          <span
            class="min-w-0 flex-1 truncate font-mono text-sm text-ink-strong sm:text-xs"
            data-testid="jwks-url">
            {{ jwksUrl }}
          </span>
          <DgCopyButton :value="jwksUrl" label="Copy" />
        </div>
      </SectionCard>

      <div v-if="loadError" class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div v-else-if="!keys" class="flex flex-col gap-2">
        <DgSkeleton
          v-for="line in 3"
          :key="line"
          class="h-12 w-full rounded-control" />
      </div>

      <div
        v-else
        class="overflow-hidden rounded-card border border-line bg-panel">
        <!-- From 640px: a table. Algorithm and the rotated and retired
             dates come in at 1024px. -->
        <table
          class="hidden min-w-full text-left text-sm sm:table"
          data-testid="keys-table">
          <thead>
            <tr class="border-b border-line-soft">
              <th class="h-11 px-4 font-medium text-ink-muted">Key ID</th>
              <th
                class="hidden h-11 px-4 font-medium text-ink-muted lg:table-cell">
                Algorithm
              </th>
              <th class="h-11 px-4 font-medium text-ink-muted">Status</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Created</th>
              <th
                class="hidden h-11 px-4 font-medium text-ink-muted lg:table-cell">
                Rotated
              </th>
              <th
                class="hidden h-11 px-4 font-medium text-ink-muted lg:table-cell">
                Retired
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="key in keys"
              :key="key.id"
              class="border-b border-line-soft last:border-b-0">
              <td
                class="h-[52px] px-4 font-mono"
                :class="
                  key.status === 'retired'
                    ? 'text-ink-faint'
                    : 'text-ink-strong'
                ">
                {{ key.id }}
              </td>
              <td class="hidden px-4 font-mono text-ink lg:table-cell">
                {{ key.algorithm }}
              </td>
              <td class="px-4">
                <DgStatus v-if="key.status === 'active'">Active</DgStatus>
                <DgBadge v-else :tone="BADGES[key.status].tone">{{
                  BADGES[key.status].label
                }}</DgBadge>
              </td>
              <td class="whitespace-nowrap px-4 text-ink-muted">
                {{ date(key.createdAt) }}
              </td>
              <td
                class="hidden whitespace-nowrap px-4 text-ink-muted lg:table-cell">
                {{ date(key.rotatedAt) }}
              </td>
              <td
                class="hidden whitespace-nowrap px-4 text-ink-muted lg:table-cell">
                {{ date(key.retiredAt) }}
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Below 640px: one card per key. -->
        <ul class="divide-y divide-line-soft sm:hidden">
          <li
            v-for="key in keys"
            :key="key.id"
            class="flex flex-col gap-1 px-4 py-3.5 text-sm">
            <div class="flex items-center justify-between gap-3">
              <DgStatus v-if="key.status === 'active'">Active</DgStatus>
              <DgBadge v-else :tone="BADGES[key.status].tone">{{
                BADGES[key.status].label
              }}</DgBadge>
              <span class="font-mono text-ink-muted">{{ key.algorithm }}</span>
            </div>
            <p
              class="mt-1 font-mono [overflow-wrap:anywhere]"
              :class="
                key.status === 'retired' ? 'text-ink-faint' : 'text-ink-strong'
              ">
              {{ key.id }}
            </p>
            <p class="mt-1 text-ink-muted">
              Created {{ formatDateTime(key.createdAt) }}
            </p>
            <p v-if="key.rotatedAt" class="text-ink-muted">
              Rotated {{ formatDateTime(key.rotatedAt) }}
            </p>
            <p v-if="key.retiredAt" class="text-ink-muted">
              Retired {{ formatDateTime(key.retiredAt) }}
            </p>
          </li>
        </ul>

        <p
          v-if="keys.length === 0"
          class="px-4 py-8 text-center text-sm text-ink-muted">
          No signing keys yet.
        </p>
      </div>
    </div>

    <DgConfirmDialog
      :open="confirmOpen"
      title="Rotate the signing key?"
      description="A new key starts signing tokens now. The current key keeps verifying tokens it already signed until they expire, then retires."
      confirm-label="Rotate"
      tone="primary"
      :loading="rotating"
      :error="rotateError"
      @confirm="rotate"
      @close="closeRotate" />
  </DashboardLayout>
</template>
