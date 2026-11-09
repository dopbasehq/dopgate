<script setup lang="ts">
import { AuthLayout } from "~/layouts";
import { DgAlert, DgButton, DgInput } from "~/components/ui";
import { useSetupController } from "./Setup.controller";

const {
  setupToken,
  email,
  password,
  confirm,
  fieldErrors,
  formError,
  alreadySetUp,
  submitting,
  submit,
} = useSetupController();
</script>

<template>
  <AuthLayout>
    <h1 class="text-[28px] font-semibold leading-tight text-ink-strong">
      Set up dopgate
    </h1>
    <p class="mt-2 text-sm text-ink-muted">
      Create the root account. It can do everything, including adding admins.
    </p>

    <DgAlert
      v-if="alreadySetUp"
      tone="info"
      title="This server is already set up"
      class="mt-6">
      Someone created the root account while this page was open.
      <RouterLink
        :to="{ name: 'sign-in' }"
        class="text-accent-strong underline underline-offset-4">
        Sign in
      </RouterLink>
    </DgAlert>

    <form
      v-else
      class="mt-8 flex flex-col gap-3"
      novalidate
      data-testid="setup-form"
      @submit.prevent="submit">
      <DgInput
        v-model="setupToken"
        label="Setup token"
        name="setupToken"
        autocomplete="off"
        mono
        hint="Printed in the server log the first time dopgate starts."
        :error="fieldErrors.setupToken" />
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
        autocomplete="new-password"
        :error="fieldErrors.password" />
      <DgInput
        v-model="confirm"
        label="Confirm password"
        name="confirm"
        type="password"
        autocomplete="new-password"
        :error="fieldErrors.confirm" />

      <DgAlert v-if="formError">{{ formError }}</DgAlert>

      <DgButton
        type="submit"
        variant="primary"
        size="lg"
        class="mt-2"
        :loading="submitting">
        Create root account
      </DgButton>
    </form>
  </AuthLayout>
</template>
