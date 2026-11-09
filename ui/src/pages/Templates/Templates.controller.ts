import { computed } from "vue";
import { useQuery } from "@pinia/colada";
import { errorMessage } from "~/services/api";
import type { TemplateSummary } from "~/services/types";
import { templatesQuery } from "~/queries/admin";

/** Readable names for the built-in templates. */
export const TEMPLATE_TITLES: Record<string, string> = {
  verify_email: "Verify email",
  login_code: "Sign-in code",
  password_reset: "Password reset",
  email_change: "Email change",
  email_changed: "Email changed",
  password_changed: "Password changed",
};

export function templateTitle(name: string): string {
  return TEMPLATE_TITLES[name] ?? name;
}

/** Templates page controller: the emails Dopgate sends. */
export function useTemplatesController() {
  const read = useQuery(templatesQuery);
  const templates = computed<TemplateSummary[] | null>(
    () => read.data.value ?? null,
  );
  const loadError = computed(() =>
    read.error.value && !read.isLoading.value && !read.data.value
      ? errorMessage(read.error.value, "Couldn't load the email templates.")
      : null,
  );

  return {
    templates,
    loadError,
    reload: () => read.refetch(),
  };
}
