<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgSkeleton,
} from "~/components/ui";
import { RefreshIcon } from "~/assets/icons";
import { formatDateTime } from "~/utils/format";
import { useKeysController } from "./Keys.controller";

const {
  keys,
  loadError,
  reload,
  canRotate,
  confirmOpen,
  rotating,
  rotateError,
  notice,
  askRotate,
  closeRotate,
  rotate,
} = useKeysController();

const TONES = { active: "ok", retiring: "warn", retired: "neutral" } as const;
const LABELS = { active: "Active", retiring: "Retiring", retired: "Retired" };
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Signing keys"
        subtitle="The keys that sign access tokens. Apps check tokens with the public keys dopgate publishes under /.well-known.">
        <template v-if="canRotate" #actions>
          <DgButton data-testid="rotate-key" @click="askRotate">
            <RefreshIcon class="h-4 w-4" />
            Rotate
          </DgButton>
        </template>
      </PageHeader>

      <DgAlert v-if="notice" tone="success">{{ notice }}</DgAlert>

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
        class="overflow-x-auto rounded-card border border-line bg-panel">
        <table class="min-w-full text-left text-sm" data-testid="keys-table">
          <thead>
            <tr class="border-b border-line-soft bg-raised/50">
              <th class="h-11 px-4 font-medium text-ink-muted">Key ID</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Algorithm</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Status</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Created</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Rotated</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Retired</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="key in keys"
              :key="key.id"
              class="border-b border-line-soft last:border-b-0">
              <td class="h-[52px] px-4 font-mono text-ink-strong">
                {{ key.id }}
              </td>
              <td class="px-4 font-mono text-ink">{{ key.algorithm }}</td>
              <td class="px-4">
                <DgBadge :tone="TONES[key.status]">{{
                  LABELS[key.status]
                }}</DgBadge>
              </td>
              <td class="whitespace-nowrap px-4 text-ink-muted">
                {{ formatDateTime(key.createdAt) }}
              </td>
              <td class="whitespace-nowrap px-4 text-ink-muted">
                {{ key.rotatedAt ? formatDateTime(key.rotatedAt) : "" }}
              </td>
              <td class="whitespace-nowrap px-4 text-ink-muted">
                {{ key.retiredAt ? formatDateTime(key.retiredAt) : "" }}
              </td>
            </tr>
          </tbody>
        </table>
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
