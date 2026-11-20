<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import { DgAlert, DgBadge, DgButton, DgSkeleton } from "~/components/ui";
import { ChevronRightIcon } from "~/assets/icons";
import { formatRelativeTime } from "~/utils/format";
import { templateTitle, useTemplatesController } from "./Templates.controller";

const { templates, loadError, reload } = useTemplatesController();

/*
 * One grid for the header and every row. Below 640px a row is a card: the
 * title and badge on top, then the description, then the subject. From
 * 640px it's a table without the subject column, which comes back at 1024px.
 */
const columns =
  "grid-cols-[minmax(0,1fr)_auto_16px] sm:grid-cols-[minmax(0,1fr)_150px_16px] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_220px_16px]";
const areas =
  "[grid-template-areas:'title_status_chevron'_'about_about_chevron'_'subject_subject_chevron'] sm:[grid-template-areas:'title_status_chevron'_'about_status_chevron'] lg:[grid-template-areas:'title_subject_status_chevron'_'about_subject_status_chevron']";
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Email templates"
        subtitle="The emails Dopgate sends. Change the wording and look, or keep the built-in ones." />

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

      <div
        v-else
        class="overflow-hidden rounded-card border border-line bg-panel">
        <div
          class="hidden h-11 items-center gap-x-6 border-b border-line-soft px-4 text-sm font-medium text-ink-muted sm:grid"
          :class="columns"
          aria-hidden="true">
          <span>Email</span>
          <span class="hidden lg:block">Subject</span>
          <span>Status</span>
          <span />
        </div>
        <ul class="divide-y divide-line-soft" data-testid="templates-list">
          <li v-for="template in templates" :key="template.name">
            <RouterLink
              :to="{ name: 'template', params: { name: template.name } }"
              class="grid items-center gap-x-6 gap-y-1 px-4 py-3.5 text-sm transition-colors hover:bg-raised/50"
              :class="[columns, areas]">
              <span
                class="flex min-w-0 flex-wrap items-baseline gap-x-2 [grid-area:title]">
                <span class="font-medium text-ink-strong">
                  {{ templateTitle(template.name) }}
                </span>
                <span class="hidden font-mono text-xs text-ink-faint sm:inline">
                  {{ template.name }}
                </span>
              </span>
              <span class="text-ink-muted [grid-area:about]">
                {{ template.description }}
              </span>
              <span
                class="min-w-0 text-ink [grid-area:subject] [overflow-wrap:anywhere] sm:hidden lg:block lg:truncate">
                <span class="sr-only">Subject: </span>{{ template.subject }}
              </span>
              <span
                class="flex items-center gap-2 justify-self-end [grid-area:status] sm:justify-self-start">
                <DgBadge v-if="template.customized" tone="accent"
                  >Customized</DgBadge
                >
                <DgBadge v-else>Built-in</DgBadge>
                <span
                  v-if="template.customized && template.updatedAt"
                  class="hidden whitespace-nowrap text-ink-muted lg:inline">
                  Edited {{ formatRelativeTime(template.updatedAt) }}
                </span>
              </span>
              <ChevronRightIcon
                class="h-4 w-4 text-ink-faint [grid-area:chevron]"
                aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </div>
  </DashboardLayout>
</template>
