<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from "vue";
import { ChevronDownIcon, LogOutIcon, UserIcon } from "~/assets/icons";
import { DgSpinner } from "~/components/ui";

/**
 * AccountMenu — the sidebar footer. Shows the signed-in email and role and
 * opens a menu with Account and Sign out. Closes on Escape, an outside
 * click, or a chosen link.
 */
defineProps<{
  email: string;
  roleName: string;
  signingOut: boolean;
}>();

const emit = defineEmits<{ "sign-out": [] }>();

const menuId = useId();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

function close(): void {
  open.value = false;
}

function onPointerDown(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  close();
  trigger.value?.focus();
}

function stopListening(): void {
  document.removeEventListener("mousedown", onPointerDown);
  document.removeEventListener("keydown", onKeydown);
}

watch(open, (isOpen) => {
  if (!isOpen) return stopListening();
  document.addEventListener("mousedown", onPointerDown);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(stopListening);

const itemClass =
  "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-sm font-medium leading-5 text-ink transition-colors hover:bg-raised hover:text-ink-strong disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11";
</script>

<template>
  <div ref="root" class="relative">
    <div
      v-if="open"
      :id="menuId"
      class="absolute inset-x-0 bottom-full z-10 mb-1 flex flex-col gap-0.5 rounded-card border border-line bg-panel p-1 shadow-xl"
      data-testid="account-menu">
      <RouterLink :to="{ name: 'account' }" :class="itemClass" @click="close">
        <UserIcon class="h-4 w-4 text-ink-muted" />
        Account
      </RouterLink>
      <div class="my-0.5 h-px bg-line-soft" role="separator" />
      <button
        type="button"
        :class="itemClass"
        :disabled="signingOut"
        data-testid="sign-out-button"
        @click="emit('sign-out')">
        <DgSpinner v-if="signingOut" class="h-4 w-4 text-ink-muted" />
        <LogOutIcon v-else class="h-4 w-4 text-ink-muted" />
        {{ signingOut ? "Signing out..." : "Sign out" }}
      </button>
    </div>

    <button
      ref="trigger"
      type="button"
      class="flex h-13 w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-left transition-colors hover:bg-raised"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      aria-label="Account menu"
      data-testid="account-menu-button"
      @click="open = !open">
      <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span
          class="w-full truncate font-mono text-sm leading-[22px] text-ink"
          :title="email">
          {{ email }}
        </span>
        <span
          class="rounded-control bg-raised px-2 py-px text-sm font-medium leading-5 text-ink">
          {{ roleName }}
        </span>
      </span>
      <ChevronDownIcon
        class="h-4 w-4 shrink-0 text-ink-muted transition-transform"
        :class="open ? 'rotate-180' : ''" />
    </button>
  </div>
</template>
