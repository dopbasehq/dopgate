<script setup lang="ts">
import { AuthLayout } from "~/layouts";
import { DgAlert, DgButton, DgCodeInput, DgInput } from "~/components/ui";
import { useSignInController } from "./SignIn.controller";

const {
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
  sendVerifyCode,
  resend,
  submitCode,
  usePassword,
} = useSignInController();
</script>

<template>
  <AuthLayout>
    <template v-if="step === 'password'">
      <h1 class="text-[28px] font-semibold leading-tight text-ink-strong">
        Sign in
      </h1>
      <p class="mt-2 font-mono text-sm text-ink">Admin Console</p>

      <form
        class="mt-8 flex flex-col gap-3"
        novalidate
        data-testid="sign-in-form"
        @submit.prevent="submitPassword">
        <DgInput
          v-model="email"
          label="Email"
          name="email"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          :error="fieldErrors.email" />
        <DgInput
          v-model="password"
          label="Password"
          name="password"
          type="password"
          autocomplete="current-password"
          :error="fieldErrors.password" />

        <DgAlert
          v-if="problem"
          :title="problem.title"
          data-testid="sign-in-problem">
          {{ problem.message }}
          <DgButton
            v-if="problem.offerVerify"
            size="sm"
            class="mt-2"
            :loading="sending"
            @click="sendVerifyCode">
            Send a verification code
          </DgButton>
        </DgAlert>

        <DgButton
          type="submit"
          variant="primary"
          size="lg"
          class="mt-2"
          :loading="submitting">
          Sign in
        </DgButton>
        <DgButton
          v-if="emailCodeEnabled"
          size="lg"
          :loading="sending && !problem"
          @click="emailMeACode">
          Email me a code
        </DgButton>
      </form>
    </template>

    <template v-else>
      <h1 class="text-[28px] font-semibold leading-tight text-ink-strong">
        {{ step === "verify" ? "Verify your email" : "Check your email" }}
      </h1>
      <p class="mt-2 text-sm text-ink-muted">
        Enter the 6-digit code we sent to
        <span class="font-mono text-ink">{{ email }}</span
        >.
      </p>

      <form
        class="mt-8 flex flex-col gap-4"
        novalidate
        data-testid="code-form"
        @submit.prevent="submitCode">
        <DgAlert v-if="notice && !codeError" tone="info">{{ notice }}</DgAlert>
        <DgCodeInput
          v-model="code"
          label="Code"
          autofocus
          :error="codeError"
          :disabled="submitting"
          @complete="submitCode" />
        <DgButton
          type="submit"
          variant="primary"
          size="lg"
          :loading="submitting">
          {{ step === "verify" ? "Verify and sign in" : "Sign in" }}
        </DgButton>
        <div class="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            class="cursor-pointer text-ink-muted underline underline-offset-4 hover:text-ink"
            @click="usePassword">
            Use a password instead
          </button>
          <button
            type="button"
            class="cursor-pointer text-ink-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
            :disabled="sending"
            @click="resend">
            Send a new code
          </button>
        </div>
      </form>
    </template>
  </AuthLayout>
</template>
