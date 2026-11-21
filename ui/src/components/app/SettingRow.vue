<script setup lang="ts">
/**
 * SettingRow — one row of a SectionCard: what the setting is and why on
 * the left, the fields on the right. The two sit side by side once the
 * card is 640px wide and stack below that, so a card in a narrow column
 * stacks even on a wide screen. The fields go in the default slot and
 * stack with a 12px gap. The field column is a container too: put
 * `@md:grid-cols-2` on a grid of two fields to pair them when it has room.
 */
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <div
    class="grid grid-cols-1 gap-x-8 gap-y-3 border-t border-line-soft py-[18px] @[40rem]:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
    <div class="flex flex-col gap-1 text-sm">
      <h3 class="text-sm font-semibold text-ink-strong">{{ title }}</h3>
      <p v-if="description || $slots.description" class="text-ink-muted">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div class="@container flex min-w-0 flex-col gap-3">
      <slot />
    </div>
  </div>
</template>
