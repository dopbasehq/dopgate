<script setup lang="ts">
import { useId } from "vue";
import { AlertTriangleIcon } from "~/assets/icons";

/**
 * DgTextarea — labeled multiline input, monospace by default for code
 * such as email HTML. Presentation-only.
 */
withDefaults(
  defineProps<{
    modelValue: string;
    label?: string;
    placeholder?: string;
    name?: string;
    rows?: number;
    error?: string | null;
    hint?: string | null;
    disabled?: boolean;
    readonly?: boolean;
    required?: boolean;
  }>(),
  {
    rows: 4,
    label: undefined,
    placeholder: undefined,
    name: undefined,
    error: undefined,
    hint: undefined,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const id = useId();

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <!-- The label sits inside the filled, borderless textarea. The fill
         lightens on focus. -->
    <div
      class="rounded-control bg-raised transition-colors duration-150 focus-within:bg-line"
      :class="[
        error ? 'bg-crit/20 focus-within:bg-crit/25' : '',
        disabled ? 'opacity-50' : '',
      ]">
      <label
        v-if="label"
        :for="id"
        class="block px-3.5 pb-0.5 pt-2 text-xs font-semibold text-ink-muted">
        {{ label
        }}<span v-if="required" class="ml-0.5 text-crit" aria-hidden="true"
          >*</span
        >
      </label>
      <textarea
        :id="id"
        :name="name"
        :value="modelValue"
        :rows="rows"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :required="required"
        spellcheck="false"
        :aria-invalid="error ? true : undefined"
        class="w-full resize-y bg-transparent pb-2.5 pl-3.5 pr-3.5 pt-1 font-mono text-base leading-relaxed text-ink-strong sm:text-xs outline-none placeholder:text-ink-faint disabled:cursor-default"
        :class="!label ? 'pb-2.5 pt-2.5' : ''"
        @input="onInput" />
    </div>
    <p v-if="error" class="flex items-start gap-1.5 text-xs text-crit">
      <AlertTriangleIcon
        class="mt-0.5 h-3.5 w-3.5 shrink-0"
        aria-hidden="true" />
      <span>{{ error }}</span>
    </p>
    <p v-else-if="hint" class="text-xs text-ink-muted">
      {{ hint }}
    </p>
  </div>
</template>

<style scoped>
textarea {
  font-variant-ligatures: none;
}
textarea:-webkit-autofill {
  box-shadow: 0 0 0 50px var(--color-raised) inset;
  -webkit-text-fill-color: var(--color-ink-strong);
  transition: background-color 9999s ease-out;
}
</style>
