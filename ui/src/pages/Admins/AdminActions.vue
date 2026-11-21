<script setup lang="ts">
import { DgMenu, DgMenuItem } from "~/components/ui";
import { LockIcon, TrashIcon } from "~/assets/icons";
import type { Admin } from "~/services/types";

/**
 * AdminActions — the ⋯ menu on one admin's row or card: turn off or back
 * on, and remove. The page decides what each choice does.
 */
defineProps<{
  admin: Admin;
  busy: boolean;
}>();

const emit = defineEmits<{ enable: []; disable: []; remove: [] }>();
</script>

<template>
  <DgMenu :label="`Actions for ${admin.email}`">
    <DgMenuItem
      v-if="admin.status === 'disabled'"
      :disabled="busy"
      @select="emit('enable')">
      <template #icon><LockIcon class="h-4 w-4" /></template>
      Turn back on
    </DgMenuItem>
    <DgMenuItem v-else :disabled="busy" @select="emit('disable')">
      <template #icon><LockIcon class="h-4 w-4" /></template>
      Turn off
    </DgMenuItem>
    <div class="my-0.5 h-px bg-line-soft" role="separator" />
    <DgMenuItem tone="danger" @select="emit('remove')">
      <template #icon><TrashIcon class="h-4 w-4" /></template>
      Remove admin
    </DgMenuItem>
  </DgMenu>
</template>
