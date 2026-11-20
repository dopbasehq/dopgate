<script setup lang="ts">
import { useId } from "vue";
import { DgSwitch } from "~/components/ui";

/**
 * SwitchRow — a row of a SectionCard that turns one thing on or off: a
 * short name, a line or two on what it does, and the switch with On or
 * Off beside it. The switch is named by `title` and described by the
 * text under it.
 */
defineProps<{
  modelValue: boolean;
  title: string;
  /** One paragraph, or several. */
  description?: string | string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const id = useId();
</script>

<template>
  <div class="flex items-center gap-6 border-t border-line-soft py-3.5">
    <div class="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
      <p class="font-semibold text-ink-strong">{{ title }}</p>
      <div :id="`${id}-description`" class="flex flex-col gap-1 text-ink-muted">
        <p v-for="(line, index) in [description ?? []].flat()" :key="index">
          {{ line }}
        </p>
        <slot />
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <DgSwitch
        :model-value="modelValue"
        :label="title"
        hide-label
        :disabled="disabled"
        :describedby="`${id}-description`"
        @update:model-value="emit('update:modelValue', $event)" />
      <span class="hidden w-6 text-sm text-ink sm:inline" aria-hidden="true">
        {{ modelValue ? "On" : "Off" }}
      </span>
    </div>
  </div>
</template>
