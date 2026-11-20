<script setup lang="ts">
import { computed } from "vue";

/**
 * DgAvatar — a round tile with the first letter of a name or email, for
 * lists of people. `muted` dims it for a turned-off account. Decorative:
 * the name next to it is what screen readers read.
 */
const props = withDefaults(
  defineProps<{
    name: string;
    muted?: boolean;
    size?: "sm" | "md" | "lg";
  }>(),
  { muted: false, size: "md" },
);

const initial = computed(
  () => props.name.trim().charAt(0).toUpperCase() || "?",
);

const sizeClass = computed(
  () =>
    ({
      sm: "h-6 w-6 text-xs",
      md: "h-7 w-7 text-xs",
      lg: "h-10 w-10 text-[15px]",
    })[props.size],
);
</script>

<template>
  <span
    class="inline-flex shrink-0 select-none items-center justify-center rounded-full bg-raised font-semibold text-ink-strong"
    :class="[sizeClass, muted ? 'opacity-50' : '']"
    aria-hidden="true">
    {{ initial }}
  </span>
</template>
