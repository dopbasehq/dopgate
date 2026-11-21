import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@pinia/colada";
import { useCountdown } from "~/composable/countdown";
import { ApiError, errorMessage, waitMessage } from "~/services/api";
import { sendCode } from "~/services/auth.api";
import { authMethodsQuery } from "~/queries/auth";
import { useAuthStore } from "~/stores/auth.store";
import { isSafeRedirect, isValidEmail } from "~/utils/validation";

/** Which form shows: the password form, or the code step. */
export type SignInStep = "password" | "code";

/**
 * What the form says when a request is refused. A rate limit is a wait, not
 * a mistake, so it shows as a warning.
 */
export interface SignInProblem {
  title: string;
  message: string;
  tone: "error" | "warn";
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
  const failure = ref<SignInProblem | null>(null);
  const codeError = ref<string | null>(null);
  const notice = ref<string | null>(null);
  const submitting = ref(false);
  const sending = ref(false);

  /** The server's wait before `sentTo` can be sent another code. */
  const resendWait = useCountdown();
  const sentTo = ref<string | null>(null);
  /** Seconds until a new code can be sent to the address on the code step. */
  const resendIn = computed(() => resendWait.seconds.value);

  /** The wait after a rate limit on the password form. */
  const limited = useCountdown();
  /** The problem on the password form. A rate limit counts down, then goes. */
  const problem = computed<SignInProblem | null>(() =>
    limited.seconds.value > 0
      ? {
          title: "Slow down",
          message: waitMessage(limited.seconds.value),
          tone: "warn",
        }
      : failure.value,
  );

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
    failure.value = null;
    limited.stop();
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
            tone: "error",
          };
        case "ACCOUNT_DISABLED":
          return {
            title: "This account is turned off",
            message: "Ask another admin to turn it back on.",
            tone: "error",
          };
        case "RATE_LIMITED":
          return {
            title: "Slow down",
            message: waitMessage(cause.retryAfter),
            tone: "warn",
          };
      }
    }
    return {
      title: "Couldn't sign you in",
      message: errorMessage(cause, "Something went wrong. Try again."),
      tone: "error",
    };
  }

  /** Shows why the password form's request was refused. */
  function refuse(cause: unknown): void {
    // With a wait from the server, the message counts down and then goes.
    if (
      cause instanceof ApiError &&
      cause.hasCode("RATE_LIMITED") &&
      cause.retryAfter !== null &&
      cause.retryAfter > 0
    ) {
      limited.start(cause.retryAfter);
      return;
    }
    failure.value = describe(cause);
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
      refuse(cause);
    } finally {
      submitting.value = false;
    }
  }

  function showCodeStep(address: string): void {
    code.value = "";
    step.value = "code";
    notice.value = `If ${address} belongs to an admin, a code is on its way.`;
  }

  /**
   * Sends a sign-in code and moves to the code step. The server says how
   * long until it sends this address another one, and the wait counts down
   * from that.
   */
  async function send(): Promise<void> {
    if (sending.value) return;
    reset();
    if (!validateEmail()) return;
    const address = email.value.trim();
    // A code went to this address moments ago and the server won't send
    // another yet, so go back to entering that one.
    if (resendWait.seconds.value > 0 && sentTo.value === address) {
      showCodeStep(address);
      return;
    }
    sending.value = true;
    try {
      const sent = await sendCode(address);
      sentTo.value = address;
      resendWait.start(sent.retryAfter);
      showCodeStep(address);
    } catch (cause) {
      if (step.value === "password") {
        refuse(cause);
      } else if (
        cause instanceof ApiError &&
        cause.hasCode("RATE_LIMITED") &&
        cause.retryAfter !== null
      ) {
        // Not a mistake: the wait shows where the resend link was.
        sentTo.value = address;
        resendWait.start(cause.retryAfter);
      } else {
        codeError.value = describeCodeError(cause);
      }
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
      if (cause.hasCode("RATE_LIMITED")) return waitMessage(cause.retryAfter);
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
    resendIn,
    submitting,
    sending,
    submitPassword,
    emailMeACode,
    resend,
    submitCode,
    usePassword,
  };
}
