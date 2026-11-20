<script setup lang="ts">
import { CheckIcon, InfoIcon } from "~/assets/icons";
import { DgButton } from "~/components/ui";

/**
 * SaveFooter — the bottom of a card that saves on its own. Save stays
 * neutral and off until something changes, then turns red with Discard
 * beside it. The left side says "Unsaved changes", then "Saved" after a
 * save, and otherwise shows `note` if there is one. Save submits the form
 * the footer sits in.
 */
withDefaults(
  defineProps<{
    dirty: boolean;
    saving?: boolean;
    saved?: boolean;
    note?: string | null;
    label?: string;
    /** Turns Save off even with changes, for example while input is invalid. */
    blocked?: boolean;
  }>(),
  { saving: false, saved: false, note: null, label: "Save", blocked: false },
);

const emit = defineEmits<{ discard: [] }>();
</script>

<template>
  <footer
    class="flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-line-soft pt-4">
    <p class="flex min-w-0 flex-1 basis-56 items-start gap-2 text-sm">
      <template v-if="dirty">
        <span
          class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
          aria-hidden="true" />
        <span class="text-ink">Unsaved changes</span>
      </template>
      <template v-else-if="saved">
        <CheckIcon class="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
        <span class="text-ink">Saved</span>
      </template>
      <template v-else-if="note">
        <InfoIcon
          class="mt-0.5 h-4 w-4 shrink-0 text-ink-faint"
          aria-hidden="true" />
        <span class="text-ink-muted">{{ note }}</span>
      </template>
    </p>
    <div class="ml-auto flex items-center gap-2">
      <DgButton
        v-if="dirty"
        variant="ghost"
        :disabled="saving"
        @click="emit('discard')">
        Discard
      </DgButton>
      <DgButton
        type="submit"
        :variant="dirty ? 'primary' : 'secondary'"
        :disabled="!dirty || blocked"
        :loading="saving">
        {{ label }}
      </DgButton>
    </div>
  </footer>
</template>
