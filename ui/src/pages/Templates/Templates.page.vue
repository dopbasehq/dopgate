<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import { DgAlert, DgBadge, DgButton, DgSkeleton } from "~/components/ui";
import { ChevronRightIcon } from "~/assets/icons";
import { formatRelativeTime } from "~/utils/format";
import { templateTitle, useTemplatesController } from "./Templates.controller";

const { templates, loadError, reload } = useTemplatesController();
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Email templates"
        subtitle="The emails dopgate sends. Change the wording and look, or keep the built-in ones." />

      <div v-if="loadError" class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div v-else-if="!templates" class="flex flex-col gap-2">
        <DgSkeleton
          v-for="line in 6"
          :key="line"
          class="h-16 w-full rounded-control" />
      </div>

      <ul
        v-else
        class="divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-panel"
        data-testid="templates-list">
        <li v-for="template in templates" :key="template.name">
          <RouterLink
            :to="{ name: 'template', params: { name: template.name } }"
            class="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-raised/50">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-ink-strong">
                  {{ templateTitle(template.name) }}
                </span>
                <span class="font-mono text-xs text-ink-faint">{{
                  template.name
                }}</span>
                <DgBadge v-if="template.customized" tone="accent"
                  >Customized</DgBadge
                >
              </div>
              <p class="mt-0.5 text-sm text-ink-muted">
                {{ template.description }}
              </p>
              <p class="mt-0.5 truncate text-sm text-ink">
                <span class="text-ink-faint">Subject:</span>
                {{ template.subject }}
              </p>
            </div>
            <span
              v-if="template.customized && template.updatedAt"
              class="hidden shrink-0 text-sm text-ink-muted sm:block">
              Edited {{ formatRelativeTime(template.updatedAt) }}
            </span>
            <ChevronRightIcon class="h-4 w-4 shrink-0 text-ink-faint" />
          </RouterLink>
        </li>
      </ul>
    </div>
  </DashboardLayout>
</template>
