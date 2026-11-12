import { computed, ref, watch } from "vue";
import { useQuery } from "@pinia/colada";
import { ApiError, errorMessage, rateLimitMessage } from "~/services/api";
import {
  changeEmail,
  changePassword,
  confirmEmailChange,
  revokeMySession,
  revokeOtherSessions,
  updateMe,
} from "~/services/auth.api";
import type { Session } from "~/services/types";
import { mySessionsQuery } from "~/queries/auth";
import { useInvalidate } from "~/queries/invalidate";
import { useAuthStore } from "~/stores/auth.store";
import { isValidEmail } from "~/utils/validation";

/**
 * Account page controller: your own display name, password, email and
 * sessions. Changing the email sends a code to the new address; the
 * change happens once that code is confirmed.
 */
export function useAccountController() {
  const auth = useAuthStore();
  const invalidate = useInvalidate();
  const user = computed(() => auth.admin);

  // Display name
  const displayName = ref(auth.admin?.displayName ?? "");
  watch(
    () => auth.admin?.displayName,
    (next, previous) => {
      if (displayName.value === (previous ?? ""))
        displayName.value = next ?? "";
    },
  );
  const profileDirty = computed(
    () => (auth.admin?.displayName ?? "") !== displayName.value.trim(),
  );
  const savingProfile = ref(false);
  const profileError = ref<string | null>(null);
  const profileSaved = ref(false);

  async function saveProfile(): Promise<void> {
    if (savingProfile.value) return;
    savingProfile.value = true;
    profileError.value = null;
    profileSaved.value = false;
    try {
      const name = displayName.value.trim();
      const next = await updateMe({ displayName: name === "" ? null : name });
      displayName.value = next.displayName ?? "";
      auth.setAdmin(next);
      profileSaved.value = true;
    } catch (cause) {
      profileError.value = errorMessage(cause, "Couldn't save your name.");
    } finally {
      savingProfile.value = false;
    }
  }

  // Password
  const currentPassword = ref("");
  const newPassword = ref("");
  const confirmPassword = ref("");
  const passwordErrors = ref<{
    current?: string;
    next?: string;
    confirm?: string;
  }>({});
  const passwordError = ref<string | null>(null);
  const passwordChanged = ref(false);
  const changingPassword = ref(false);

  async function submitPassword(): Promise<void> {
    if (changingPassword.value) return;
    passwordError.value = null;
    passwordChanged.value = false;
    const errors: typeof passwordErrors.value = {};
    if (auth.admin?.hasPassword !== false && currentPassword.value === "")
      errors.current = "Enter your current password.";
    if (newPassword.value === "") errors.next = "Choose a new password.";
    if (confirmPassword.value !== newPassword.value)
      errors.confirm = "The passwords don't match.";
    passwordErrors.value = errors;
    if (Object.keys(errors).length > 0) return;

    changingPassword.value = true;
    try {
      await changePassword(currentPassword.value, newPassword.value);
      currentPassword.value = "";
      newPassword.value = "";
      confirmPassword.value = "";
      passwordChanged.value = true;
      void invalidate.accountChanged();
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.hasCode("AUTHENTICATION_INVALID")) {
          passwordErrors.value = {
            current: "This isn't your current password.",
          };
          return;
        }
        if (cause.hasCode("PASSWORD_INVALID")) {
          passwordErrors.value = { next: cause.message };
          return;
        }
      }
      passwordError.value = errorMessage(
        cause,
        "Couldn't change your password.",
      );
    } finally {
      changingPassword.value = false;
    }
  }

  // Email
  const emailStep = ref<"idle" | "code">("idle");
  const newEmail = ref("");
  /** The current password; asked for only when the account has one. */
  const emailPassword = ref("");
  const needsEmailPassword = computed(() => auth.admin?.hasPassword !== false);
  const emailCode = ref("");
  const emailFieldError = ref<string | null>(null);
  const emailPasswordError = ref<string | null>(null);
  const emailCodeError = ref<string | null>(null);
  const emailError = ref<string | null>(null);
  const emailChanged = ref(false);
  const changingEmail = ref(false);

  async function requestEmailChange(): Promise<void> {
    if (changingEmail.value) return;
    emailFieldError.value = null;
    emailPasswordError.value = null;
    emailError.value = null;
    emailChanged.value = false;
    const address = newEmail.value.trim();
    if (!isValidEmail(address)) {
      emailFieldError.value = "Enter a valid email address.";
      return;
    }
    if (address.toLowerCase() === auth.admin?.email.toLowerCase()) {
      emailFieldError.value = "This is already your email address.";
      return;
    }
    if (needsEmailPassword.value && emailPassword.value === "") {
      emailPasswordError.value = "Enter your current password.";
      return;
    }
    changingEmail.value = true;
    try {
      await changeEmail(
        address,
        needsEmailPassword.value ? emailPassword.value : undefined,
      );
      emailPassword.value = "";
      emailCode.value = "";
      emailCodeError.value = null;
      emailStep.value = "code";
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.hasCode("AUTHENTICATION_INVALID")) {
          emailPasswordError.value = cause.message;
          return;
        }
        if (cause.hasCode("EMAIL_TAKEN")) {
          emailFieldError.value = "Another account already uses this email.";
          return;
        }
        if (cause.hasCode("EMAIL_INVALID")) {
          emailFieldError.value = cause.message;
          return;
        }
      }
      emailError.value = errorMessage(cause, "Couldn't send the code.");
    } finally {
      changingEmail.value = false;
    }
  }

  async function confirmEmail(): Promise<void> {
    if (changingEmail.value) return;
    emailCodeError.value = null;
    if (emailCode.value.length !== 6) {
      emailCodeError.value = "Enter the 6-digit code.";
      return;
    }
    changingEmail.value = true;
    try {
      const next = await confirmEmailChange(
        newEmail.value.trim(),
        emailCode.value,
      );
      auth.setAdmin(next);
      emailStep.value = "idle";
      newEmail.value = "";
      emailCode.value = "";
      emailChanged.value = true;
    } catch (cause) {
      emailCode.value = "";
      if (cause instanceof ApiError) {
        if (cause.hasCode("CODE_EXPIRED")) {
          emailCodeError.value = "This code has expired. Send a new one.";
          return;
        }
        if (cause.hasCode("RATE_LIMITED")) {
          emailCodeError.value = rateLimitMessage(cause);
          return;
        }
      }
      emailCodeError.value = errorMessage(cause, "Couldn't check the code.");
    } finally {
      changingEmail.value = false;
    }
  }

  function cancelEmailChange(): void {
    emailStep.value = "idle";
    emailCode.value = "";
    emailCodeError.value = null;
  }

  // Sessions
  const sessionsRead = useQuery(mySessionsQuery);
  const sessions = computed<Session[] | null>(() => {
    const list = sessionsRead.data.value;
    if (!list) return null;
    return [...list].sort((a, b) =>
      a.current === b.current
        ? b.lastUsedAt.localeCompare(a.lastUsedAt)
        : a.current
          ? -1
          : 1,
    );
  });
  const sessionsError = computed(() =>
    sessionsRead.error.value && !sessionsRead.data.value
      ? errorMessage(sessionsRead.error.value, "Couldn't load your sessions.")
      : null,
  );
  const hasOtherSessions = computed(
    () => sessions.value?.some((session) => !session.current) ?? false,
  );
  const revoking = ref<string | null>(null);
  const sessionError = ref<string | null>(null);

  async function revoke(id: string): Promise<void> {
    if (revoking.value) return;
    revoking.value = id;
    sessionError.value = null;
    try {
      await revokeMySession(id);
      await sessionsRead.refetch();
    } catch (cause) {
      sessionError.value = errorMessage(
        cause,
        "Couldn't sign out that session.",
      );
    } finally {
      revoking.value = null;
    }
  }

  async function revokeOthers(): Promise<void> {
    if (revoking.value) return;
    revoking.value = "others";
    sessionError.value = null;
    try {
      await revokeOtherSessions();
      await sessionsRead.refetch();
    } catch (cause) {
      sessionError.value = errorMessage(
        cause,
        "Couldn't sign out the other sessions.",
      );
    } finally {
      revoking.value = null;
    }
  }

  return {
    user,
    displayName,
    profileDirty,
    savingProfile,
    profileError,
    profileSaved,
    saveProfile,
    currentPassword,
    newPassword,
    confirmPassword,
    passwordErrors,
    passwordError,
    passwordChanged,
    changingPassword,
    submitPassword,
    emailStep,
    newEmail,
    emailPassword,
    needsEmailPassword,
    emailCode,
    emailFieldError,
    emailPasswordError,
    emailCodeError,
    emailError,
    emailChanged,
    changingEmail,
    requestEmailChange,
    confirmEmail,
    cancelEmailChange,
    sessions,
    sessionsError,
    hasOtherSessions,
    revoking,
    sessionError,
    revoke,
    revokeOthers,
  };
}
