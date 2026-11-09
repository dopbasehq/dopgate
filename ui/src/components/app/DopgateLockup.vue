<script setup lang="ts">
import { DopgateIcon } from "~/assets/icons";

/**
 * DopgateLockup — the Hash D mark with the "Dopgate" wordmark, as the
 * "Dopgate / Logo" lockup in Figma: Geist SemiBold at -2% tracking, the
 * wordmark 46/52 of the mark's height and a 14/52 gap. `size` is the mark's
 * height in pixels; everything scales from it.
 */
const props = withDefaults(defineProps<{ size?: number }>(), { size: 24 });

const markStyle = {
  height: `${props.size}px`,
  width: `${(props.size * 48) / 52}px`,
};
const wordStyle = {
  fontSize: `${(props.size * 46) / 52}px`,
  lineHeight: `${props.size}px`,
};
const gapStyle = { gap: `${(props.size * 14) / 52}px` };
</script>

<template>
  <span class="inline-flex shrink-0 items-center" :style="gapStyle">
    <DopgateIcon class="shrink-0" :style="markStyle" />
    <span
      class="font-brand font-semibold tracking-[-0.02em] whitespace-nowrap text-ink-strong"
      :style="wordStyle"
      >Dopgate</span
    >
  </span>
</template>
