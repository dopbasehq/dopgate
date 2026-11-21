<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import { DgCopyButton } from "~/components/ui";

export interface Fact {
  label: string;
  value: string;
  /** IDs, emails and the like. */
  mono?: boolean;
  /** Adds a copy button after the value. */
  copy?: boolean;
  /** Makes the value a link, such as an owner's email to their page. */
  to?: RouteLocationRaw;
}

/**
 * FactList — the read-only facts about a person or an agent (ID, when it
 * was made, when it was last used) in a narrow card. Detail pages put it
 * beside their cards from 1024px up and above them below that.
 */
defineProps<{
  facts: Fact[];
}>();
</script>

<template>
  <dl
    class="flex flex-col gap-3.5 rounded-card border border-line bg-panel px-4 py-4 text-sm sm:px-5">
    <div v-for="fact in facts" :key="fact.label" class="flex flex-col gap-0.5">
      <dt class="text-ink-muted">{{ fact.label }}</dt>
      <dd class="flex min-w-0 items-start gap-1.5">
        <RouterLink
          v-if="fact.to"
          :to="fact.to"
          class="min-w-0 text-ink-strong [overflow-wrap:anywhere] hover:underline"
          :class="fact.mono ? 'font-mono' : ''">
          {{ fact.value }}
        </RouterLink>
        <span
          v-else
          class="min-w-0 text-ink-strong [overflow-wrap:anywhere]"
          :class="fact.mono ? 'font-mono' : ''">
          {{ fact.value }}
        </span>
        <DgCopyButton
          v-if="fact.copy"
          class="-my-1.5 shrink-0"
          :value="fact.value"
          :label="`Copy ${fact.label.charAt(0).toLowerCase()}${fact.label.slice(1)}`"
          icon-only />
      </dd>
    </div>
    <slot />
  </dl>
</template>
