<script setup lang="ts">
import type { Component } from "vue";
import {
  HistoryIcon,
  KeyIcon,
  MailIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "~/assets/icons";
import type { PageName, SidebarSection } from "./navigation";
import AccountMenu from "./AccountMenu.vue";

/**
 * DashboardNav — the grouped sidebar navigation plus the account menu.
 * DashboardLayout renders it in the desktop sidebar and in the navigation
 * sheet on narrow screens, so both stay in sync.
 */
defineProps<{
  sections: SidebarSection[];
  activePage: PageName | null;
  email: string;
  roleName: string;
  signingOut: boolean;
}>();

const emit = defineEmits<{ "sign-out": [] }>();

const icons: Record<PageName, Component> = {
  users: UsersIcon,
  templates: MailIcon,
  settings: SlidersHorizontalIcon,
  keys: KeyIcon,
  audit: HistoryIcon,
};
</script>

<template>
  <nav
    class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1"
    aria-label="Primary">
    <section
      v-for="section in sections"
      :key="section.label"
      class="flex flex-col gap-0.5 py-2"
      :aria-label="section.label">
      <p class="px-2.5 py-1 text-sm font-medium leading-5 text-ink-faint">
        {{ section.label }}
      </p>
      <RouterLink
        v-for="item in section.items"
        :key="item.name"
        :to="{ name: item.name }"
        class="group flex h-[34px] items-center gap-2.5 rounded-control px-2.5 text-sm font-medium leading-5 transition-colors pointer-coarse:min-h-11"
        :class="
          item.name === activePage
            ? 'bg-accent-soft text-ink-strong'
            : 'text-ink hover:bg-raised hover:text-ink-strong'
        "
        :aria-current="item.name === activePage ? 'page' : undefined">
        <component
          :is="icons[item.name]"
          class="h-4 w-4 shrink-0"
          :class="
            item.name === activePage
              ? 'text-accent-strong'
              : 'text-ink-muted group-hover:text-ink-strong'
          " />
        <span class="truncate">{{ item.label }}</span>
      </RouterLink>
    </section>
  </nav>

  <div class="border-t border-line-soft px-3 pb-3 pt-2">
    <AccountMenu
      :email="email"
      :role-name="roleName"
      :signing-out="signingOut"
      @sign-out="emit('sign-out')" />
  </div>
</template>
