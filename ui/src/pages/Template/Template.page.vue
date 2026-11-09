<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgInput,
  DgSkeleton,
  DgSpinner,
  DgTextarea,
} from "~/components/ui";
import { CheckIcon, CopyIcon, MailIcon } from "~/assets/icons";
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
  previewTab,
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

/** How a variable is written in a template, e.g. `{{code}}`. */
const placeholder = (variable: string) => `{{${variable}}}`;

const tabClass = (active: boolean) =>
  active
    ? "bg-raised text-ink-strong"
    : "text-ink-muted hover:bg-raised/60 hover:text-ink-strong";
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
        <PageHeader
          :title="templateTitle(name)"
          :subtitle="template.description"
          :trail="[{ label: 'Email templates', to: { name: 'templates' } }]">
          <template #meta>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <DgBadge v-if="template.customized" tone="accent"
                >Customized</DgBadge
              >
              <DgBadge v-else>Built-in</DgBadge>
              <DgBadge v-if="dirty" tone="warn">Unsaved changes</DgBadge>
            </div>
          </template>
          <template #actions>
            <DgButton
              v-if="template.customized"
              variant="ghost"
              :disabled="busy !== null"
              @click="resetOpen = true">
              Reset to built-in
            </DgButton>
            <DgButton
              :loading="busy === 'test'"
              :disabled="busy !== null"
              @click="sendTest">
              <MailIcon class="h-4 w-4" />
              Send test
            </DgButton>
            <DgButton
              variant="primary"
              :disabled="!dirty || busy !== null"
              :loading="busy === 'save'"
              data-testid="save-template"
              @click="save">
              Save
            </DgButton>
          </template>
        </PageHeader>

        <DgAlert v-if="notice" tone="success">{{ notice }}</DgAlert>
        <DgAlert v-if="error">{{ error }}</DgAlert>

        <div class="grid gap-5 xl:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-4">
            <DgInput v-model="draft.subject" label="Subject" />
            <DgTextarea v-model="draft.html" label="HTML" :rows="16" />
            <DgTextarea
              v-model="draft.text"
              label="Plain text"
              :rows="8"
              hint="Sent alongside the HTML for mail apps that don't show HTML." />

            <div class="rounded-card border border-line bg-panel px-4 py-3">
              <p class="text-sm font-medium text-ink-strong">Variables</p>
              <p class="mt-0.5 text-sm text-ink-muted">
                Click one to copy it, then paste it into the subject or body.
              </p>
              <div class="mt-2.5 flex flex-wrap gap-1.5">
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

          <section
            class="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-panel"
            aria-label="Preview">
            <header
              class="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
              <h2 class="text-[15px]">Preview</h2>
              <DgSpinner v-if="previewing" class="h-3.5 w-3.5 text-ink-muted" />
              <div class="ml-auto flex gap-1" role="tablist">
                <button
                  type="button"
                  role="tab"
                  :aria-selected="previewTab === 'html'"
                  class="cursor-pointer rounded-control px-2.5 py-1 text-sm transition-colors"
                  :class="tabClass(previewTab === 'html')"
                  @click="previewTab = 'html'">
                  HTML
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="previewTab === 'text'"
                  class="cursor-pointer rounded-control px-2.5 py-1 text-sm transition-colors"
                  :class="tabClass(previewTab === 'text')"
                  @click="previewTab = 'text'">
                  Text
                </button>
              </div>
            </header>
            <DgAlert v-if="previewError" class="m-4">{{
              previewError
            }}</DgAlert>
            <template v-if="preview">
              <p class="border-b border-line-soft px-4 py-2.5 text-sm">
                <span class="text-ink-faint">Subject:</span>
                <span class="text-ink-strong"> {{ preview.subject }}</span>
              </p>
              <iframe
                v-if="previewTab === 'html'"
                title="HTML preview"
                sandbox=""
                referrerpolicy="no-referrer"
                class="min-h-[480px] w-full flex-1 bg-white"
                :srcdoc="preview.html" />
              <pre
                v-else
                class="min-h-[480px] flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs text-ink"
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
      description="Your changes to this email are deleted and dopgate goes back to sending the built-in version."
      confirm-label="Reset"
      :loading="busy === 'reset'"
      @confirm="confirmReset"
      @close="resetOpen = false" />
  </DashboardLayout>
</template>
