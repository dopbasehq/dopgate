<script setup lang="ts">
import { DgAlert, DgButton, DgCopyButton, DgModal } from "~/components/ui";

/**
 * TokenReveal — shows a new token once, with a copy button. Dopgate keeps
 * only a hash, so this is the only time anyone sees it.
 */
defineProps<{
  open: boolean;
  title: string;
  token: string | null;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <DgModal :open="open" :title="title" persistent @close="emit('close')">
    <div class="flex flex-col gap-3">
      <DgAlert tone="warn">
        Copy this token now. You won't see it again.
      </DgAlert>
      <div
        class="break-all rounded-control bg-raised px-3.5 py-3 font-mono text-sm text-ink-strong"
        data-testid="revealed-token">
        {{ token }}
      </div>
    </div>
    <template #footer>
      <DgCopyButton v-if="token" :value="token" label="Copy token" />
      <DgButton variant="primary" @click="emit('close')">Done</DgButton>
    </template>
  </DgModal>
</template>
