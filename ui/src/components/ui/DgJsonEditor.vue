<script setup lang="ts">
import { computed } from "vue";
import { parseJsonObject, formatJson } from "~/utils/json";
import DgTextarea from "./DgTextarea.vue";

/**
 * DgJsonEditor — a monospace editor for a JSON object, such as user
 * metadata. It checks the text as you type and shows why it doesn't
 * parse. "Format" pretty-prints valid JSON. Read-only editors show the
 * value and nothing else. Presentation-only.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    hint?: string | null;
    readonly?: boolean;
    rows?: number;
  }>(),
  { hint: undefined, readonly: false, rows: 6 },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const parsed = computed(() => parseJsonObject(props.modelValue));
const error = computed(() =>
  parsed.value.ok ? null : (parsed.value as { error: string }).error,
);

function format(): void {
  const result = parsed.value;
  if (result.ok) emit("update:modelValue", formatJson(result.value));
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <DgTextarea
      :model-value="modelValue"
      :label="label"
      :rows="rows"
      :readonly="readonly"
      :error="readonly ? null : error"
      :hint="hint"
      @update:model-value="emit('update:modelValue', $event)" />
    <div v-if="!readonly" class="flex justify-end">
      <button
        type="button"
        class="cursor-pointer rounded-control px-2 py-0.5 text-xs text-ink-muted transition-colors hover:bg-raised hover:text-ink-strong disabled:cursor-default disabled:opacity-50"
        :disabled="!parsed.ok"
        @click="format">
        Format
      </button>
    </div>
  </div>
</template>
