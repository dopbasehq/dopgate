<script setup lang="ts" generic="T extends string">
/**
 * DgSegment — two or three choices side by side, one of them on, such as
 * Edit and Preview. It is a radio group: Tab reaches the chosen option and
 * the arrow keys move between them. `block` stretches it to the full
 * width. Presentation-only.
 */
const props = withDefaults(
  defineProps<{
    modelValue: T;
    options: readonly { value: T; label: string }[];
    label: string;
    block?: boolean;
  }>(),
  { block: false },
);

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

function move(event: KeyboardEvent, step: number): void {
  const index = props.options.findIndex((o) => o.value === props.modelValue);
  const next =
    props.options[(index + step + props.options.length) % props.options.length];
  if (!next) return;
  emit("update:modelValue", next.value);
  const group = (event.currentTarget as HTMLElement).parentElement;
  requestAnimationFrame(() =>
    group
      ?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)
      ?.focus(),
  );
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="label"
    class="inline-flex gap-0.5 rounded-control border border-line bg-editor p-0.5"
    :class="block ? 'flex w-full' : ''">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :data-value="option.value"
      :aria-checked="option.value === modelValue"
      :tabindex="option.value === modelValue ? 0 : -1"
      class="h-7 cursor-pointer rounded-[4px] px-3 text-sm transition-colors"
      :class="[
        block ? 'flex-1' : '',
        option.value === modelValue
          ? 'bg-raised font-medium text-ink-strong'
          : 'text-ink-muted hover:text-ink-strong',
      ]"
      @click="emit('update:modelValue', option.value)"
      @keydown.right.prevent="move($event, 1)"
      @keydown.down.prevent="move($event, 1)"
      @keydown.left.prevent="move($event, -1)"
      @keydown.up.prevent="move($event, -1)">
      {{ option.label }}
    </button>
  </div>
</template>
