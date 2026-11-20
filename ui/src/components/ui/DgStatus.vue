<script setup lang="ts">
/**
 * DgStatus — a small coloured dot and a word, for states that are normal
 * and don't need attention, such as Active or On. Use DgBadge for states
 * that do, such as Turned off. Presentation-only.
 */
withDefaults(
  defineProps<{
    tone?: "ok" | "warn" | "crit" | "neutral";
  }>(),
  { tone: "ok" },
);

const DOTS = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  neutral: "bg-ink-faint",
};
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-sm text-ink">
    <span
      class="h-1.5 w-1.5 shrink-0 rounded-full"
      :class="DOTS[tone]"
      aria-hidden="true" />
    <slot />
  </span>
</template>
