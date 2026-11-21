<script setup lang="ts">
import DopgateLockup from "~/components/app/DopgateLockup.vue";

/**
 * FocusLayout — one centred column and nothing else, for pages outside
 * the console's navigation: No access and Not found.
 */
</script>

<template>
  <div class="flex min-h-svh flex-col bg-canvas">
    <header
      class="flex items-center gap-2.5 border-b border-line-soft px-5 py-4 sm:px-8">
      <DopgateLockup :size="24" />
    </header>
    <main
      class="flex flex-1 items-start justify-center px-5 py-12 sm:items-center sm:py-16">
      <div class="w-full max-w-md">
        <slot />
      </div>
    </main>
  </div>
</template>
