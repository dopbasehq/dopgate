import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@pinia/colada";
import { ApiError, errorMessage, rateLimitMessage } from "~/services/api";
import { sendCode } from "~/services/auth.api";
import { authMethodsQuery } from "~/queries/auth";
import { useAuthStore } from "~/stores/auth.store";
import { isSafeRedirect, isValidEmail } from "~/utils/validation";

/** Which form shows: the password form, or the code step. */
export type SignInStep = "password" | "code";

/** A form error. */
export interface SignInProblem {
  title: string;
  message: string;
}

/**
 * Sign-in page controller for admins: email and password, or a 6-digit
 * code by email. Your app's users can't sign in here.
 */
export function useSignInController() {
  const router = useRouter();
  const route = useRoute();
  const auth = useAuthStore();

  const methods = useQuery(authMethodsQuery);
  /** The email code option, while the server's answer is pending too. */
  const emailCodeEnabled = computed(() => methods.data.value?.emailOtp ?? true);

  const step = ref<SignInStep>("password");
  const email = ref("");
  const password = ref("");
  const code = ref("");
  const fieldErrors = ref<{ email?: string; password?: string }>({});
  const problem = ref<SignInProblem | null>(null);
  const codeError = ref<string | null>(null);
  const notice = ref<string | null>(null);
  const submitting = ref(false);
  const sending = ref(false);

  function validateEmail(): boolean {
    if (email.value.trim() === "") {
      fieldErrors.value = { email: "Enter your email address." };
      return false;
    }
    if (!isValidEmail(email.value)) {
      fieldErrors.value = { email: "Enter a valid email address." };
      return false;
    }
    return true;
  }

  function reset(): void {
    fieldErrors.value = {};
    problem.value = null;
    codeError.value = null;
    notice.value = null;
  }

  async function finish(): Promise<void> {
    const redirect = route.query.redirect;
    await router.replace(
      isSafeRedirect(redirect) ? redirect : { name: "users" },
    );
  }

  /** What to say when a sign-in attempt is refused. */
  function describe(cause: unknown): SignInProblem {
    if (cause instanceof ApiError) {
      switch (cause.code) {
        case "AUTHENTICATION_INVALID":
          return {
            title: "Couldn't sign you in",
            message:
              "The email or password is wrong. After too many tries the account locks for a while.",
          };
        case "ACCOUNT_DISABLED":
          return {
            title: "This account is turned off",
            message: "Ask another admin to turn it back on.",
          };
        case "RATE_LIMITED":
          return { title: "Slow down", message: rateLimitMessage(cause) };
      }
    }
    return {
      title: "Couldn't sign you in",
      message: errorMessage(cause, "Something went wrong. Try again."),
    };
  }

  async function submitPassword(): Promise<void> {
    if (submitting.value) return;
    reset();
    if (!validateEmail()) return;
    if (password.value === "") {
      fieldErrors.value = { password: "Enter your password." };
      return;
    }
    submitting.value = true;
    try {
      await auth.login(email.value.trim(), password.value);
      await finish();
    } catch (cause) {
      problem.value = describe(cause);
    } finally {
      submitting.value = false;
    }
  }

  /** Sends a sign-in code and moves to the code step. */
  async function send(): Promise<void> {
    if (sending.value) return;
    reset();
    if (!validateEmail()) return;
    sending.value = true;
    try {
      await sendCode(email.value.trim());
      code.value = "";
      step.value = "code";
      notice.value = `If ${email.value.trim()} belongs to an admin, a code is on its way.`;
    } catch (cause) {
      if (step.value === "password") problem.value = describe(cause);
      else codeError.value = describeCodeError(cause);
    } finally {
      sending.value = false;
    }
  }

  const emailMeACode = () => send();
  const resend = () => send();

  function describeCodeError(cause: unknown): string {
    if (cause instanceof ApiError) {
      if (cause.hasCode("CODE_EXPIRED"))
        return "This code has expired. Send a new one.";
      if (cause.hasCode("CODE_INVALID")) return cause.message;
      if (cause.hasCode("RATE_LIMITED")) return rateLimitMessage(cause);
      if (cause.hasCode("ACCOUNT_DISABLED"))
        return "This account is turned off. Ask another admin to turn it back on.";
    }
    return errorMessage(cause, "Couldn't check the code. Try again.");
  }

  async function submitCode(): Promise<void> {
    if (submitting.value) return;
    codeError.value = null;
    if (code.value.length !== 6) {
      codeError.value = "Enter the 6-digit code.";
      return;
    }
    submitting.value = true;
    try {
      await auth.confirmCode(email.value.trim(), code.value);
      await finish();
    } catch (cause) {
      codeError.value = describeCodeError(cause);
      code.value = "";
    } finally {
      submitting.value = false;
    }
  }

  function usePassword(): void {
    reset();
    code.value = "";
    step.value = "password";
  }

  return {
    methods,
    emailCodeEnabled,
    step,
    email,
    password,
    code,
    fieldErrors,
    problem,
    codeError,
    notice,
    submitting,
    sending,
    submitPassword,
    emailMeACode,
    resend,
    submitCode,
    usePassword,
  };
}
