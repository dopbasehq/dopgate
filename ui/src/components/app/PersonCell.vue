<script setup lang="ts">
import { DgAvatar } from "~/components/ui";

/**
 * PersonCell — an avatar, the display name and the email, for the first
 * column of a list of people. Without a name the email takes its place.
 * `muted` dims everything for a turned-off account. Extra marks such as
 * "you" or "unverified" go in the default slot, after the email.
 */
defineProps<{
  email: string;
  name?: string | null;
  muted?: boolean;
}>();
</script>

<template>
  <span class="flex min-w-0 items-center gap-2.5">
    <DgAvatar :name="name || email" :muted="muted" />
    <span class="flex min-w-0 flex-col">
      <span
        v-if="name"
        class="truncate text-sm font-medium"
        :class="muted ? 'text-ink-faint' : 'text-ink-strong'">
        {{ name }}
      </span>
      <span class="flex min-w-0 items-center gap-2">
        <span
          class="truncate font-mono text-sm"
          :class="
            muted
              ? 'text-ink-faint'
              : name
                ? 'text-ink-muted'
                : 'text-ink-strong'
          ">
          {{ email }}
        </span>
        <slot />
      </span>
    </span>
  </span>
</template>
