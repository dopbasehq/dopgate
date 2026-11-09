<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangleIcon, CheckIcon, InfoIcon } from "~/assets/icons";

/**
 * DgAlert — inline banner for form-level and load errors, and notes.
 * Every tone shows its icon, so an error never relies on colour alone.
 * With a `title`, the slot becomes the description below it. Presentation-only.
 */
const props = withDefaults(
  defineProps<{
    tone?: "error" | "info" | "success" | "warn";
    title?: string;
  }>(),
  { tone: "error", title: undefined },
);

const icon = computed(() => {
  switch (props.tone) {
    case "info":
      return InfoIcon;
    case "success":
      return CheckIcon;
    default:
      return AlertTriangleIcon;
  }
});

/** Only errors interrupt a screen reader; notes are read in place. */
const role = computed(() => {
  switch (props.tone) {
    case "info":
      return "note";
    case "success":
      return "status";
    case "warn":
      return "note";
    default:
      return "alert";
  }
});

const toneClasses = computed(() => {
  switch (props.tone) {
    case "info":
      return "border-accent/30 bg-accent-soft text-accent-strong";
    case "success":
      return "border-ok/30 bg-ok/10 text-ok";
    case "warn":
      return "border-warn/30 bg-warn/10 text-warn";
    default:
      return "border-crit/30 bg-crit/10 text-crit";
  }
});
</script>

<template>
  <div
    class="flex items-start gap-2.5 rounded-control border px-3.5 py-2.5 text-xs leading-relaxed"
    :class="toneClasses"
    :role="role">
    <component :is="icon" class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <div v-if="title" class="min-w-0 flex-1">
      <p class="text-sm font-semibold leading-5 text-ink-strong">
        {{ title }}
      </p>
      <div class="mt-0.5 text-[13px] leading-5 text-ink">
        <slot />
      </div>
    </div>
    <div v-else class="min-w-0 flex-1">
      <slot />
    </div>
  </div>
</template>
