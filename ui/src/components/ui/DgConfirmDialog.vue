<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DgModal from "./DgModal.vue";
import DgButton from "./DgButton.vue";
import DgInput from "./DgInput.vue";
import { AlertTriangleIcon } from "~/assets/icons";

/**
 * DgConfirmDialog — confirmation dialog for ordinary and destructive
 * actions. In destructive mode (`confirmWord` set) the user must type the
 * exact resource name before confirming, and optional affected counts are
 * listed up front.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: "danger" | "primary";
    /** When set, must be typed exactly to enable the confirm button. */
    confirmWord?: string;
    affectedCounts?: Array<{ label: string; count: number }>;
    loading?: boolean;
    error?: string | null;
  }>(),
  {
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    tone: "danger",
    description: undefined,
    confirmWord: undefined,
    affectedCounts: undefined,
    error: undefined,
  },
);

const emit = defineEmits<{ confirm: []; close: [] }>();

const typed = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) typed.value = "";
  },
);

const canConfirm = computed(
  () => !props.confirmWord || typed.value === props.confirmWord,
);

const confirmPrompt = computed(() =>
  props.confirmWord ? `Type "${props.confirmWord}" to confirm` : undefined,
);
</script>

<template>
  <DgModal :open="open" :title="title" size="sm" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <p v-if="description" class="text-sm text-ink">
        {{ description }}
      </p>

      <ul
        v-if="affectedCounts && affectedCounts.length > 0"
        class="flex flex-col gap-1 rounded-control border border-line-soft bg-canvas px-3 py-2 font-mono text-xs text-ink-muted">
        <li
          v-for="item in affectedCounts"
          :key="item.label"
          class="flex items-center justify-between gap-4">
          <span>{{ item.label }}</span>
          <span class="text-ink-strong">{{ item.count }}</span>
        </li>
      </ul>

      <DgInput
        v-if="confirmWord"
        v-model="typed"
        :label="confirmPrompt"
        :placeholder="confirmWord"
        mono />

      <p
        v-if="error"
        role="alert"
        class="flex items-start gap-1.5 text-xs text-crit">
        <AlertTriangleIcon
          class="mt-0.5 h-3.5 w-3.5 shrink-0"
          aria-hidden="true" />
        <span>{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <DgButton variant="ghost" :disabled="loading" @click="emit('close')">
        {{ cancelLabel }}
      </DgButton>
      <DgButton
        :variant="tone === 'danger' ? 'danger' : 'primary'"
        :loading="loading"
        :disabled="!canConfirm"
        @click="emit('confirm')">
        {{ confirmLabel }}
      </DgButton>
    </template>
  </DgModal>
</template>
