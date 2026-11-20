<script setup lang="ts">
import { computed, ref } from "vue";
import { DgMenu, DgMenuItem, DgSearchField } from "~/components/ui";
import { PlusIcon, XIcon } from "~/assets/icons";
import { AUDIT_ACTIONS } from "~/utils/audit";

/**
 * AuditActionFilter — the Action chip on the audit log. Empty, it reads
 * "+ Action" and opens a list of actions with a search box on top; Enter
 * in the box filters by whatever was typed, so an action missing from the
 * list still works. Set, it reads "Action: user.created" with a × to clear
 * it. The server matches actions exactly.
 */
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const search = ref("");

const matches = computed(() => {
  const text = search.value.trim().toLowerCase();
  return text
    ? AUDIT_ACTIONS.filter((action) => action.includes(text))
    : AUDIT_ACTIONS;
});

function pick(action: string, close: () => void): void {
  const value = action.trim();
  if (!value) return;
  emit("update:modelValue", value);
  search.value = "";
  close();
}
</script>

<template>
  <span
    v-if="props.modelValue"
    class="inline-flex h-9 max-w-full items-center gap-1 rounded-control border border-accent/50 bg-accent-soft pl-2.5 pr-1 text-sm text-ink-strong"
    data-testid="action-filter">
    <span class="shrink-0 text-ink-muted">Action:</span>
    <span class="truncate font-mono">{{ props.modelValue }}</span>
    <button
      type="button"
      class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-raised hover:text-ink-strong"
      aria-label="Clear Action filter"
      @click="emit('update:modelValue', '')">
      <XIcon class="h-3.5 w-3.5" />
    </button>
  </span>
  <DgMenu v-else align="start">
    <template #trigger="{ toggle, attrs }">
      <button
        type="button"
        class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-control border border-dashed border-line-strong px-3 text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink-strong"
        v-bind="attrs"
        data-testid="action-filter"
        @click="toggle">
        <PlusIcon class="h-3.5 w-3.5" />
        Action
      </button>
    </template>
    <template #default="{ close }">
      <div class="p-1 pb-1.5">
        <DgSearchField
          v-model="search"
          placeholder="Type or pick an action"
          label="Filter by action"
          @keydown.enter.prevent="pick(search, () => close(true))" />
      </div>
      <DgMenuItem
        v-for="action in matches"
        :key="action"
        @select="pick(action, () => close(true))">
        <span class="font-mono">{{ action }}</span>
      </DgMenuItem>
      <p v-if="matches.length === 0" class="px-2.5 py-2 text-sm text-ink-muted">
        Press Enter to filter by “{{ search.trim() }}”.
      </p>
    </template>
  </DgMenu>
</template>
