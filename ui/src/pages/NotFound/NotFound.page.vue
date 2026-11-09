<script setup lang="ts">
import { FocusLayout } from "~/layouts";
</script>

<template>
  <FocusLayout>
    <div class="flex flex-col items-start gap-3">
      <p class="font-mono text-sm text-ink-faint">404</p>
      <h1 class="text-xl font-semibold text-ink-strong">Page not found</h1>
      <p class="text-sm text-ink-muted">
        Nothing lives at this address. Check the link, or start from the users
        list.
      </p>
      <RouterLink
        :to="{ name: 'users' }"
        class="text-sm text-accent-strong underline underline-offset-4">
        Go to users
      </RouterLink>
    </div>
  </FocusLayout>
</template>
