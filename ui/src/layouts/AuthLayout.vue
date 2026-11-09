<script setup lang="ts">
import { DopgateIcon } from "~/assets/icons";
import AuthArtwork from "./AuthArtwork.vue";

/**
 * AuthLayout — split screen for setup and sign in.
 *
 * Left: the logo, the form slot in the middle and a `footer` slot at the
 * bottom. Right: the artwork. The right side drops below `lg`, and the
 * left column's content centres on the page.
 */
</script>

<template>
  <div class="flex min-h-svh bg-canvas">
    <div
      class="flex min-h-svh w-full flex-col px-6 py-8 sm:px-12 sm:py-10 lg:w-[560px] lg:shrink-0 lg:border-r lg:border-line-soft lg:px-16">
      <div class="mx-auto flex w-full max-w-[432px] flex-1 flex-col">
        <div class="flex items-center gap-2">
          <DopgateIcon class="h-6 w-6 shrink-0" />
          <span class="text-[15px] font-semibold text-ink-strong">dopgate</span>
        </div>

        <main class="flex flex-1 items-center py-10">
          <div class="w-full">
            <slot />
          </div>
        </main>

        <footer
          v-if="$slots.footer"
          class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] text-ink-muted">
          <slot name="footer" />
        </footer>
      </div>
    </div>

    <aside class="relative hidden flex-1 overflow-hidden bg-panel lg:flex">
      <div class="flex flex-1 items-center justify-center">
        <AuthArtwork />
      </div>
    </aside>
  </div>
</template>
