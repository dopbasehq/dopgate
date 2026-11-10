import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import { useQuery, useQueryCache } from "@pinia/colada";
import { errorMessage, isAbortError } from "~/services/api";
import {
  previewTemplate,
  resetTemplate,
  saveTemplate,
  sendTemplateTest,
} from "~/services/admin.api";
import type { Template, TemplateContent, TemplateName } from "~/services/types";
import { templateQuery } from "~/queries/admin";
import { keys } from "~/queries/keys";
import { useInvalidate } from "~/queries/invalidate";
import { useAuthStore } from "~/stores/auth.store";
import { copyText } from "~/utils/clipboard";

export const LEAVE_PROMPT =
  "Leave without saving? Your changes to this template will be lost.";

const contentOf = (template: TemplateContent): TemplateContent => ({
  subject: template.subject,
  html: template.html,
  text: template.text,
});

const same = (a: TemplateContent | null, b: TemplateContent | null) =>
  a !== null &&
  b !== null &&
  a.subject === b.subject &&
  a.html === b.html &&
  a.text === b.text;

/**
 * Template editor controller: edit one email's subject, HTML and text,
 * with a live preview rendered by the server from sample values. Leaving
 * with unsaved changes asks first.
 */
export function useTemplateController({ previewDelay = 400 } = {}) {
  const route = useRoute();
  const auth = useAuthStore();
  const cache = useQueryCache();
  const invalidate = useInvalidate();

  const name = computed(() => String(route.params.name ?? "") as TemplateName);
  const read = useQuery(() => templateQuery(name.value));
  const template = computed<Template | null>(() => read.data.value ?? null);
  const loadError = computed(() =>
    read.error.value && !read.isLoading.value && !read.data.value
      ? errorMessage(read.error.value, "Couldn't load this template.")
      : null,
  );

  /** What's saved on the server, and what's in the editor. */
  const saved = ref<TemplateContent | null>(null);
  const draft = ref<TemplateContent | null>(null);
  const dirty = computed(
    () => draft.value !== null && !same(draft.value, saved.value),
  );

  function adopt(next: Template): void {
    saved.value = contentOf(next);
    draft.value = contentOf(next);
    cache.setQueryData(keys.templates.one(next.name), next);
  }

  // A fresh copy from the server replaces the editor only while it holds
  // no unsaved changes.
  watch(
    template,
    (next) => {
      if (!next) return;
      if (draft.value === null || !dirty.value) {
        saved.value = contentOf(next);
        draft.value = contentOf(next);
      }
    },
    { immediate: true },
  );

  // Preview
  const preview = ref<TemplateContent | null>(null);
  const previewError = ref<string | null>(null);
  const previewing = ref(false);
  const previewTab = ref<"html" | "text">("html");
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let previewAbort: AbortController | null = null;

  async function runPreview(): Promise<void> {
    if (!draft.value) return;
    previewAbort?.abort();
    const abort = new AbortController();
    previewAbort = abort;
    previewing.value = true;
    try {
      preview.value = await previewTemplate(
        name.value,
        contentOf(draft.value),
        abort.signal,
      );
      previewError.value = null;
    } catch (cause) {
      if (abort.signal.aborted || isAbortError(cause)) return;
      previewError.value = errorMessage(cause, "Couldn't render the preview.");
    } finally {
      if (previewAbort === abort) previewing.value = false;
    }
  }

  watch(
    draft,
    () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => void runPreview(), previewDelay);
    },
    { deep: true },
  );

  // Save, test and reset
  const busy = ref<"save" | "test" | "reset" | null>(null);
  const error = ref<string | null>(null);
  const notice = ref<string | null>(null);
  const resetOpen = ref(false);

  async function act(
    kind: "save" | "test" | "reset",
    action: () => Promise<void>,
    fallback: string,
  ): Promise<void> {
    if (busy.value || !draft.value) return;
    busy.value = kind;
    error.value = null;
    notice.value = null;
    try {
      await action();
    } catch (cause) {
      error.value = errorMessage(cause, fallback);
    } finally {
      busy.value = null;
    }
  }

  const save = () =>
    act(
      "save",
      async () => {
        adopt(await saveTemplate(name.value, contentOf(draft.value!)));
        void invalidate.templatesChanged();
        notice.value = "Template saved.";
      },
      "Couldn't save the template.",
    );

  const sendTest = () =>
    act(
      "test",
      async () => {
        await sendTemplateTest(name.value, contentOf(draft.value!));
        notice.value = `Sent a test email to ${auth.admin?.email ?? "your address"}.`;
      },
      "Couldn't send the test email.",
    );

  const confirmReset = async () => {
    await act(
      "reset",
      async () => {
        adopt(await resetTemplate(name.value));
        void invalidate.templatesChanged();
        notice.value = "Back to the built-in template.";
      },
      "Couldn't reset the template.",
    );
    resetOpen.value = false;
  };

  // Variables
  const copied = ref<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyVariable(variable: string): Promise<void> {
    if (!(await copyText(`{{${variable}}}`))) return;
    copied.value = variable;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = null), 1500);
  }

  // Unsaved changes
  onBeforeRouteLeave(() => !dirty.value || window.confirm(LEAVE_PROMPT));

  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!dirty.value) return;
    event.preventDefault();
    event.returnValue = "";
  }
  onMounted(() => window.addEventListener("beforeunload", onBeforeUnload));
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (previewTimer) clearTimeout(previewTimer);
    if (copiedTimer) clearTimeout(copiedTimer);
    previewAbort?.abort();
  });

  return {
    name,
    template,
    loadError,
    reload: () => read.refetch(),
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
  };
}
