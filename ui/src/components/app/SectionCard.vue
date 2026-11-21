<script setup lang="ts">
import { useId } from "vue";

/**
 * SectionCard — one titled card on a settings or detail page: a heading,
 * an optional line under it, a slot beside the heading for a badge
 * (`badge`) and one for a button (`action`), the card's rows, and an
 * optional `footer`. Pass `as="form"` to make the whole card a form. The
 * heading names the card for screen readers.
 */
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    as?: "section" | "form";
  }>(),
  { description: undefined, as: "section" },
);

const id = useId();
</script>

<template>
  <component
    :is="as"
    class="@container flex flex-col rounded-card border border-line bg-panel px-4 py-4 sm:px-5"
    :aria-labelledby="`${id}-title`"
    :novalidate="as === 'form' ? true : undefined">
    <header class="flex items-start gap-4 pb-4">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h2 :id="`${id}-title`" class="text-[15px] text-ink-strong">
            {{ title }}
          </h2>
          <slot name="badge" />
        </div>
        <p
          v-if="description || $slots.description"
          class="mt-0.5 text-sm text-ink-muted">
          <slot name="description">{{ description }}</slot>
        </p>
      </div>
      <div v-if="$slots.action" class="flex shrink-0 items-center gap-2">
        <slot name="action" />
      </div>
    </header>
    <slot />
    <slot name="footer" />
  </component>
</template>
