import { computed, reactive, ref, watch } from "vue";
import { useQuery, useQueryCache } from "@pinia/colada";
import { errorMessage } from "~/services/api";
import { sendSmtpTest, updateSettings } from "~/services/admin.api";
import type {
  EditableSettings,
  LimitSettings,
  Settings,
  TokenSettings,
} from "~/services/types";
import { settingsQuery } from "~/queries/admin";
import { keys } from "~/queries/keys";
import { useInvalidate } from "~/queries/invalidate";
import { isValidEmail } from "~/utils/validation";

export type SectionName = keyof EditableSettings;

export interface NumberField<K extends string> {
  key: K;
  label: string;
  hint: string;
}

export const LIMIT_FIELDS: NumberField<keyof LimitSettings>[] = [
  {
    key: "codeMinutes",
    label: "Code lifetime (minutes)",
    hint: "How long an emailed code works.",
  },
  {
    key: "codeMaxAttempts",
    label: "Tries per code",
    hint: "Wrong guesses before a code stops working.",
  },
  {
    key: "codeResendSeconds",
    label: "Resend wait (seconds)",
    hint: "Time before another code can be sent.",
  },
  { key: "codesPerHour", label: "Codes per hour", hint: "Per email address." },
  {
    key: "lockoutAttempts",
    label: "Failed sign-ins before lockout",
    hint: "Wrong passwords in a row.",
  },
  {
    key: "lockoutMinutes",
    label: "Lockout length (minutes)",
    hint: "How long a locked account waits.",
  },
  {
    key: "ipRequestsPerMinute",
    label: "Requests per minute per IP",
    hint: "For the sign-in endpoints.",
  },
];

export const TOKEN_FIELDS: NumberField<keyof TokenSettings>[] = [
  {
    key: "accessTokenMinutes",
    label: "Access token lifetime (minutes)",
    hint: "Short, since access tokens can't be revoked.",
  },
  {
    key: "refreshTokenIdleDays",
    label: "Idle sign-out (days)",
    hint: "A session unused this long ends.",
  },
  {
    key: "sessionAbsoluteDays",
    label: "Session length (days)",
    hint: "Every session ends after this, used or not.",
  },
];

type Strings<T> = { [K in keyof T]: string };

interface Drafts {
  signup: Settings["signup"];
  password: Strings<Settings["password"]>;
  limits: Strings<LimitSettings>;
  tokens: Strings<TokenSettings>;
  branding: { appName: string; logoUrl: string };
}

interface SectionState {
  saving: boolean;
  error: string | null;
  saved: boolean;
  fieldErrors: Record<string, string>;
}

const SECTIONS: SectionName[] = [
  "signup",
  "password",
  "limits",
  "tokens",
  "branding",
];

function strings<T extends object>(value: T): Strings<T> {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, String(field)]),
  ) as Strings<T>;
}

function draftOf<S extends SectionName>(
  settings: Settings,
  section: S,
): Drafts[S] {
  switch (section) {
    case "signup":
      return { ...settings.signup } as Drafts[S];
    case "branding":
      return {
        appName: settings.branding.appName,
        logoUrl: settings.branding.logoUrl ?? "",
      } as Drafts[S];
    default:
      return strings(settings[section]) as Drafts[S];
  }
}

/** Reads whole numbers of at least 1; collects an error per bad field. */
function numbers<T extends Record<string, string>>(
  draft: T,
  errors: Record<string, string>,
): { [K in keyof T]: number } {
  const out: Record<string, number> = {};
  for (const [key, text] of Object.entries(draft)) {
    const value = Number(text.trim());
    if (text.trim() === "" || !Number.isInteger(value) || value < 1) {
      errors[key] = "Enter a whole number of at least 1.";
    }
    out[key] = value;
  }
  return out as { [K in keyof T]: number };
}

/**
 * Settings page controller. Each section saves on its own with the whole
 * sub-object, as the API wants. SMTP is read-only: it comes from the
 * server's environment, and here it can only be tested.
 */
export function useSettingsController() {
  const cache = useQueryCache();
  const invalidate = useInvalidate();
  const read = useQuery(settingsQuery);
  const settings = computed<Settings | null>(() => read.data.value ?? null);
  const loadError = computed(() =>
    read.error.value && !read.isLoading.value && !read.data.value
      ? errorMessage(read.error.value, "Couldn't load the settings.")
      : null,
  );

  const drafts = ref<Drafts | null>(null);
  const state = reactive(
    Object.fromEntries(
      SECTIONS.map((section) => [
        section,
        { saving: false, error: null, saved: false, fieldErrors: {} },
      ]),
    ) as Record<SectionName, SectionState>,
  );

  function isDirty(section: SectionName): boolean {
    if (!settings.value || !drafts.value) return false;
    return (
      JSON.stringify(drafts.value[section]) !==
      JSON.stringify(draftOf(settings.value, section))
    );
  }

  const dirty = computed(
    () =>
      Object.fromEntries(
        SECTIONS.map((section) => [section, isDirty(section)]),
      ) as Record<SectionName, boolean>,
  );

  // Fresh settings replace every section that has no unsaved edits.
  watch(
    settings,
    (next, previous) => {
      if (!next) return;
      if (!drafts.value) {
        drafts.value = {
          signup: draftOf(next, "signup"),
          password: draftOf(next, "password"),
          limits: draftOf(next, "limits"),
          tokens: draftOf(next, "tokens"),
          branding: draftOf(next, "branding"),
        };
        return;
      }
      for (const section of SECTIONS) {
        const was = previous
          ? JSON.stringify(draftOf(previous, section))
          : null;
        if (JSON.stringify(drafts.value[section]) === was) {
          (drafts.value as Record<SectionName, unknown>)[section] = draftOf(
            next,
            section,
          );
        }
      }
    },
    { immediate: true },
  );

  /** The section as the API wants it, or null with field errors set. */
  function build(section: SectionName): Partial<EditableSettings> | null {
    const draft = drafts.value;
    if (!draft) return null;
    const errors: Record<string, string> = {};
    let body: Partial<EditableSettings>;
    switch (section) {
      case "signup":
        body = { signup: { ...draft.signup } };
        break;
      case "password":
        body = { password: numbers(draft.password, errors) };
        break;
      case "limits":
        body = { limits: numbers(draft.limits, errors) };
        break;
      case "tokens":
        body = { tokens: numbers(draft.tokens, errors) };
        break;
      case "branding": {
        const appName = draft.branding.appName.trim();
        const logoUrl = draft.branding.logoUrl.trim();
        if (appName === "") errors.appName = "Enter a name.";
        if (logoUrl && !/^https?:\/\//i.test(logoUrl))
          errors.logoUrl = "Use a full http:// or https:// address.";
        body = { branding: { appName, logoUrl: logoUrl || null } };
        break;
      }
    }
    state[section].fieldErrors = errors;
    return Object.keys(errors).length === 0 ? body : null;
  }

  async function save(section: SectionName): Promise<boolean> {
    const current = state[section];
    if (current.saving) return false;
    current.error = null;
    current.saved = false;
    const body = build(section);
    if (!body) return false;
    current.saving = true;
    try {
      const next = await updateSettings(body);
      drafts.value![section] = draftOf(next, section) as never;
      cache.setQueryData(keys.settings, next);
      void invalidate.settingsChanged();
      current.saved = true;
      return true;
    } catch (cause) {
      current.error = errorMessage(cause, "Couldn't save these settings.");
      return false;
    } finally {
      current.saving = false;
    }
  }

  function discard(section: SectionName): void {
    if (!settings.value || !drafts.value) return;
    drafts.value[section] = draftOf(settings.value, section) as never;
    state[section].fieldErrors = {};
    state[section].error = null;
  }

  // SMTP test
  const testTo = ref("");
  const testing = ref(false);
  const testResult = ref<{ ok: boolean; message: string } | null>(null);

  async function sendTest(): Promise<void> {
    if (testing.value) return;
    const to = testTo.value.trim();
    if (to && !isValidEmail(to)) {
      testResult.value = { ok: false, message: "Enter a valid email address." };
      return;
    }
    testing.value = true;
    testResult.value = null;
    try {
      await sendSmtpTest(to || undefined);
      testResult.value = {
        ok: true,
        message: to
          ? `Test email sent to ${to}.`
          : "Test email sent to your address.",
      };
    } catch (cause) {
      testResult.value = {
        ok: false,
        message: errorMessage(cause, "Couldn't send the test email."),
      };
    } finally {
      testing.value = false;
    }
  }

  return {
    settings,
    loadError,
    reload: () => read.refetch(),
    drafts,
    state,
    dirty,
    save,
    discard,
    testTo,
    testing,
    testResult,
    sendTest,
  };
}
