import { ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, errorMessage } from "~/services/api";
import { useAuthStore } from "~/stores/auth.store";
import { isValidEmail } from "~/utils/validation";

export interface SetupErrors {
  setupToken?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

/**
 * Setup page controller: claims a fresh server with the one-time setup
 * token printed in the server log, creates the root account and signs in.
 */
export function useSetupController() {
  const router = useRouter();
  const auth = useAuthStore();

  const setupToken = ref("");
  const email = ref("");
  const password = ref("");
  const confirm = ref("");
  const fieldErrors = ref<SetupErrors>({});
  const formError = ref<string | null>(null);
  /** The server was set up from somewhere else meanwhile. */
  const alreadySetUp = ref(false);
  const submitting = ref(false);

  function validate(): boolean {
    const errors: SetupErrors = {};
    if (setupToken.value.trim() === "")
      errors.setupToken = "Enter the setup token from the server log.";
    if (email.value.trim() === "") errors.email = "Enter your email address.";
    else if (!isValidEmail(email.value))
      errors.email = "Enter a valid email address.";
    if (password.value === "") errors.password = "Choose a password.";
    if (confirm.value !== password.value)
      errors.confirm = "The passwords don't match.";
    fieldErrors.value = errors;
    return Object.keys(errors).length === 0;
  }

  async function submit(): Promise<void> {
    if (submitting.value) return;
    formError.value = null;
    if (!validate()) return;
    submitting.value = true;
    try {
      await auth.setup({
        setupToken: setupToken.value.trim(),
        email: email.value.trim(),
        password: password.value,
      });
      await router.replace({ name: "users" });
    } catch (cause) {
      handleError(cause);
    } finally {
      submitting.value = false;
    }
  }

  function handleError(cause: unknown): void {
    if (!(cause instanceof ApiError)) {
      formError.value = errorMessage(cause, "Setup failed. Try again.");
      return;
    }
    switch (cause.code) {
      case "SETUP_TOKEN_INVALID":
        fieldErrors.value = {
          setupToken:
            "This setup token is wrong or has expired. Check the server log for the current one.",
        };
        return;
      case "ALREADY_INITIALIZED":
        alreadySetUp.value = true;
        auth.initialized = true;
        return;
      case "EMAIL_INVALID":
        fieldErrors.value = { email: cause.message };
        return;
      case "PASSWORD_INVALID":
        fieldErrors.value = { password: cause.message };
        return;
      default:
        // The root account exists but signing in failed: sign in by hand.
        if (auth.initialized === true) {
          void router.replace({ name: "sign-in" });
          return;
        }
        formError.value = errorMessage(cause, "Setup failed. Try again.");
    }
  }

  return {
    setupToken,
    email,
    password,
    confirm,
    fieldErrors,
    formError,
    alreadySetUp,
    submitting,
    submit,
  };
}
