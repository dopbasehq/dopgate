<script setup lang="ts">
import { DgButton, DgInput, DgSelect, DgTextarea } from "~/components/ui";
import { PlusIcon, TrashIcon } from "~/assets/icons";
import {
  CAPABILITY_TYPES,
  emptyRow,
  type CapabilityRow,
} from "~/utils/capabilities";

/**
 * CapabilitiesEditor — an agent's capabilities as rows of key, type, and
 * value, so nobody has to write JSON. Read-only when the viewer isn't the
 * agent's owner.
 */
const props = defineProps<{
  modelValue: CapabilityRow[];
  readonly?: boolean;
  /** Per-row problems, by index. */
  errors?: Record<number, string>;
}>();

const emit = defineEmits<{ "update:modelValue": [rows: CapabilityRow[]] }>();

const BOOLEAN_OPTIONS = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

function change(index: number, patch: Partial<CapabilityRow>): void {
  const rows = props.modelValue.map((row, at) =>
    at === index ? { ...row, ...patch } : row,
  );
  const row = rows[index];
  if (patch.type === "boolean" && row && !["true", "false"].includes(row.value))
    row.value = "true";
  emit("update:modelValue", rows);
}

function add(): void {
  emit("update:modelValue", [...props.modelValue, emptyRow()]);
}

function remove(index: number): void {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, at) => at !== index),
  );
}

function shown(row: CapabilityRow): string {
  return row.type === "list"
    ? row.value.split("\n").filter(Boolean).join(", ")
    : row.value;
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="capabilities-editor">
    <p v-if="modelValue.length === 0" class="text-sm text-ink-muted">
      No capabilities yet.
    </p>

    <template v-if="readonly">
      <dl
        v-if="modelValue.length > 0"
        class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <template v-for="row in modelValue" :key="row.key">
          <dt class="font-mono text-ink-muted">{{ row.key }}</dt>
          <dd class="break-all font-mono text-ink">{{ shown(row) }}</dd>
        </template>
      </dl>
    </template>

    <template v-else>
      <div
        v-for="(row, index) in modelValue"
        :key="index"
        class="grid gap-2 rounded-control border border-line-soft p-3 sm:grid-cols-[1fr_10rem_1.4fr_auto] sm:items-start"
        data-testid="capability-row">
        <DgInput
          :model-value="row.key"
          label="Key"
          mono
          placeholder="max_amount"
          :error="errors?.[index]"
          @update:model-value="change(index, { key: $event })" />
        <DgSelect
          :model-value="row.type"
          label="Type"
          :options="CAPABILITY_TYPES"
          @update:model-value="
            change(index, { type: $event as CapabilityRow['type'] })
          " />
        <DgSelect
          v-if="row.type === 'boolean'"
          :model-value="row.value"
          label="Value"
          :options="BOOLEAN_OPTIONS"
          @update:model-value="change(index, { value: $event })" />
        <DgTextarea
          v-else-if="row.type === 'list'"
          :model-value="row.value"
          label="Values"
          hint="One per line."
          :rows="3"
          @update:model-value="change(index, { value: $event })" />
        <DgInput
          v-else
          :model-value="row.value"
          label="Value"
          :type="row.type === 'number' ? 'number' : 'text'"
          @update:model-value="change(index, { value: $event })" />
        <DgButton
          variant="ghost"
          size="sm"
          class="sm:mt-2"
          :aria-label="`Remove ${row.key || 'this capability'}`"
          @click="remove(index)">
          <TrashIcon class="h-4 w-4" />
        </DgButton>
      </div>
      <div>
        <DgButton size="sm" data-testid="add-capability" @click="add">
          <PlusIcon class="h-4 w-4" />
          Add capability
        </DgButton>
      </div>
    </template>
  </div>
</template>
