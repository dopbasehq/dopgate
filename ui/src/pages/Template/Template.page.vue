<script setup lang="ts">
import { computed, ref } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgCodeEditor,
  DgConfirmDialog,
  DgInput,
  DgMenu,
  DgMenuItem,
  DgSegment,
  DgSkeleton,
  DgSpinner,
} from "~/components/ui";
import {
  CheckIcon,
  CopyIcon,
  MailIcon,
  MoreHorizontalIcon,
  RefreshIcon,
} from "~/assets/icons";
import { formatRelativeTime } from "~/utils/format";
import { templateTitle } from "~/pages/Templates/Templates.controller";
import { useTemplateController } from "./Template.controller";

const {
  name,
  template,
  loadError,
  reload,
  draft,
  dirty,
  preview,
  previewError,
  previewing,
  body,
  sender,
  busy,
  error,
  notice,
  resetOpen,
  save,
  sendTest,
  confirmReset,
  copied,
  copyVariable,
} = useTemplateController();

const BODIES = [
  { value: "html", label: "HTML" },
  { value: "text", label: "Plain text" },
] as const;

const PANES = [
  { value: "edit", label: "Edit" },
  { value: "preview", label: "Preview" },
] as const;

/** Below 1280px the editor and the preview take turns. */
const pane = ref<"edit" | "preview">("edit");

const bodyLabel = computed(() =>
  body.value === "html" ? "HTML" : "Plain text",
);

/** How a variable is written in a template, e.g. `{{code}}`. */
const placeholder = (variable: string) => `{{${variable}}}`;
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <div v-if="loadError" class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div v-else-if="!template || !draft" class="flex flex-col gap-3">
        <DgSkeleton class="h-8 w-72 rounded-control" />
        <DgSkeleton class="h-96 w-full rounded-card" />
      </div>

      <template v-else>
        <div
          class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <PageHeader
            class="min-w-0 lg:flex-1"
            :title="templateTitle(name)"
            :subtitle="template.description"
            :trail="[{ label: 'Email templates', to: { name: 'templates' } }]">
            <template #meta>
              <div
                class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                <DgBadge v-if="template.customized" tone="accent"
                  >Customized</DgBadge
                >
                <DgBadge v-else>Built-in</DgBadge>
                <span
                  v-if="template.customized && template.updatedAt"
                  class="text-ink-muted">
                  Edited {{ formatRelativeTime(template.updatedAt) }}
                </span>
                <span
                  v-if="dirty"
                  class="inline-flex items-center gap-1.5 text-ink">
                  <span
                    class="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                    aria-hidden="true" />
                  Unsaved changes
                </span>
              </div>
            </template>
          </PageHeader>

          <div class="flex w-full items-center gap-2 sm:w-auto">
            <div v-if="template.customized" class="sm:hidden">
              <DgMenu label="More actions" align="start">
                <template #trigger="{ attrs, toggle }">
                  <DgButton
                    v-bind="attrs"
                    class="w-10 px-0"
                    aria-label="More actions"
                    :disabled="busy !== null"
                    @click="toggle">
                    <MoreHorizontalIcon class="h-4 w-4" />
                  </DgButton>
                </template>
                <DgMenuItem @select="resetOpen = true">
                  <template #icon><RefreshIcon class="h-4 w-4" /></template>
                  Reset to built-in
                </DgMenuItem>
              </DgMenu>
            </div>
            <div v-if="template.customized" class="hidden sm:block">
              <DgButton
                variant="ghost"
                :disabled="busy !== null"
                @click="resetOpen = true">
                Reset to built-in
              </DgButton>
            </div>
            <DgButton
              class="flex-1 sm:flex-none"
              :loading="busy === 'test'"
              :disabled="busy !== null"
              @click="sendTest">
              <MailIcon class="h-4 w-4" />
              Send test
            </DgButton>
            <DgButton
              class="flex-1 sm:flex-none"
              :variant="dirty ? 'primary' : 'secondary'"
              :disabled="!dirty || busy !== null"
              :loading="busy === 'save'"
              data-testid="save-template"
              @click="save">
              Save
            </DgButton>
          </div>
        </div>

        <DgAlert v-if="notice" tone="success">{{ notice }}</DgAlert>
        <DgAlert v-if="error">{{ error }}</DgAlert>

        <DgSegment
          v-model="pane"
          class="xl:hidden"
          :options="PANES"
          label="Show"
          block />

        <div class="grid gap-5 xl:grid-cols-2 xl:items-start">
          <section
            class="min-w-0 flex-col overflow-hidden rounded-card border border-line bg-panel"
            :class="pane === 'edit' ? 'flex' : 'hidden xl:flex'"
            aria-label="Editor">
            <div class="flex flex-col gap-4 p-4">
              <DgInput v-model="draft.subject" label="Subject" />
              <div>
                <p class="text-sm">
                  <span class="font-medium text-ink">Variables</span>
                  <span class="ml-2 text-ink-faint">Click one to copy it.</span>
                </p>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <button
                    v-for="variable in template.variables"
                    :key="variable"
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1.5 rounded-control bg-raised px-2.5 py-1 font-mono text-xs text-ink transition-colors hover:bg-line hover:text-ink-strong"
                    :aria-label="`Copy ${placeholder(variable)}`"
                    @click="copyVariable(variable)">
                    <CheckIcon
                      v-if="copied === variable"
                      class="h-3.5 w-3.5 text-ok" />
                    <CopyIcon v-else class="h-3.5 w-3.5" />
                    {{ placeholder(variable) }}
                  </button>
                </div>
              </div>
            </div>
            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft px-4 py-2.5">
              <DgSegment v-model="body" :options="BODIES" label="Body" />
              <p class="text-sm text-ink-faint">
                The preview follows the body you are editing.
              </p>
            </div>
            <DgCodeEditor
              :key="body"
              v-model="draft[body]"
              class="border-t border-line-soft"
              :label="bodyLabel"
              :rows="body === 'html' ? 20 : 12" />
            <p
              v-if="body === 'text'"
              class="border-t border-line-soft px-4 py-2 text-xs text-ink-faint">
              Sent alongside the HTML for mail apps that don't show HTML.
            </p>
          </section>

          <section
            class="min-w-0 flex-col overflow-hidden rounded-card border border-line bg-panel xl:sticky xl:top-6 xl:max-h-[calc(100svh-3rem)]"
            :class="pane === 'preview' ? 'flex' : 'hidden xl:flex'"
            aria-label="Preview">
            <header
              class="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
              <h2 class="text-[15px] text-ink-strong">Preview</h2>
              <DgBadge>{{ bodyLabel }}</DgBadge>
              <DgSpinner
                v-if="previewing"
                class="ml-auto h-3.5 w-3.5 text-ink-muted" />
            </header>
            <DgAlert v-if="previewError" class="m-4">{{
              previewError
            }}</DgAlert>
            <template v-if="preview">
              <dl
                class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 border-b border-line-soft px-4 py-3 text-sm">
                <template v-if="sender">
                  <dt class="text-ink-faint">From</dt>
                  <dd class="text-ink-strong [overflow-wrap:anywhere]">
                    {{ sender }}
                  </dd>
                </template>
                <dt class="text-ink-faint">Subject</dt>
                <dd class="text-ink-strong [overflow-wrap:anywhere]">
                  {{ preview.subject }}
                </dd>
              </dl>
              <iframe
                v-if="body === 'html'"
                title="HTML preview"
                sandbox=""
                referrerpolicy="no-referrer"
                class="min-h-[480px] w-full flex-1 bg-white xl:min-h-[320px]"
                :srcdoc="preview.html" />
              <pre
                v-else
                class="min-h-[480px] flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs text-ink xl:min-h-[320px]"
                >{{ preview.text }}</pre>
            </template>
            <DgSkeleton
              v-else-if="!previewError"
              class="m-4 h-[480px] rounded-control" />
            <p
              class="border-t border-line-soft px-4 py-2 text-xs text-ink-faint">
              Rendered by the server with sample values.
            </p>
          </section>
        </div>
      </template>
    </div>

    <DgConfirmDialog
      :open="resetOpen"
      title="Reset to the built-in template?"
      description="Your changes to this email are deleted and Dopgate goes back to sending the built-in version."
      confirm-label="Reset"
      :loading="busy === 'reset'"
      @confirm="confirmReset"
      @close="resetOpen = false" />
  </DashboardLayout>
</template>
