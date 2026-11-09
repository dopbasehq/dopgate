<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgButton,
  DgInput,
  DgSkeleton,
  DgSwitch,
} from "~/components/ui";
import {
  LIMIT_FIELDS,
  TOKEN_FIELDS,
  useSettingsController,
  type SectionName,
} from "./Settings.controller";

const {
  settings,
  loadError,
  reload,
  drafts,
  state,
  dirty,
  save,
  discard,
  testTo,
  testing,
  testResult,
  sendTest,
} = useSettingsController();

// Kept out of the template: a static "https://" attribute trips vue-tsc.
const LOGO_PLACEHOLDER = "https://example.com/logo.png";

const SECURITY_LABELS = { starttls: "STARTTLS", tls: "TLS", none: "None" };

const sections: { name: SectionName; title: string; description: string }[] = [
  {
    name: "signup",
    title: "Signup",
    description: "Who can create an account, and how.",
  },
  {
    name: "password",
    title: "Password",
    description: "Rules for new passwords.",
  },
  {
    name: "limits",
    title: "Codes and lockout",
    description: "Email codes, failed sign-ins and rate limits.",
  },
  {
    name: "tokens",
    title: "Tokens",
    description: "How long tokens and sessions last.",
  },
  {
    name: "branding",
    title: "Branding",
    description: "The name and logo in emails and on sign-in pages.",
  },
];

const card = "rounded-card border border-line bg-panel";
</script>

<template>
  <DashboardLayout>
    <div class="page-width py-6 lg:py-8">
      <div class="flex max-w-[960px] flex-col gap-5">
        <PageHeader
          title="Settings"
          subtitle="How sign-up and sign-in work on this server." />

        <div v-if="loadError" class="flex flex-col items-start gap-3">
          <DgAlert>{{ loadError }}</DgAlert>
          <DgButton size="sm" @click="reload">Try again</DgButton>
        </div>

        <div v-else-if="!settings || !drafts" class="flex flex-col gap-3">
          <DgSkeleton
            v-for="line in 4"
            :key="line"
            class="h-40 w-full rounded-card" />
        </div>

        <template v-else>
          <form
            v-for="section in sections"
            :key="section.name"
            :class="card"
            novalidate
            :aria-labelledby="`${section.name}-heading`"
            :data-testid="`settings-${section.name}`"
            @submit.prevent="save(section.name)">
            <header class="border-b border-line-soft px-5 py-3.5">
              <h2 :id="`${section.name}-heading`" class="text-[15px]">
                {{ section.title }}
              </h2>
              <p class="mt-0.5 text-sm text-ink-muted">
                {{ section.description }}
              </p>
            </header>

            <div class="flex flex-col gap-4 px-5 py-4">
              <template v-if="section.name === 'signup'">
                <DgSwitch
                  v-model="drafts.signup.enabled"
                  label="Anyone can sign up from your app" />
                <DgSwitch
                  v-model="drafts.signup.requireEmailVerification"
                  label="Require a verified email before signing in" />
                <DgSwitch
                  v-model="drafts.signup.passwordlessSignup"
                  label="Allow signing up with an email code, without a password" />
              </template>

              <div v-else-if="section.name === 'password'" class="max-w-xs">
                <DgInput
                  v-model="drafts.password.minLength"
                  label="Minimum length"
                  type="number"
                  :min="1"
                  :error="state.password.fieldErrors.minLength" />
              </div>

              <div
                v-else-if="section.name === 'limits'"
                class="grid gap-4 sm:grid-cols-2">
                <DgInput
                  v-for="field in LIMIT_FIELDS"
                  :key="field.key"
                  v-model="drafts.limits[field.key]"
                  :label="field.label"
                  :hint="field.hint"
                  type="number"
                  :min="1"
                  :error="state.limits.fieldErrors[field.key]" />
              </div>

              <div
                v-else-if="section.name === 'tokens'"
                class="grid gap-4 sm:grid-cols-2">
                <DgInput
                  v-for="field in TOKEN_FIELDS"
                  :key="field.key"
                  v-model="drafts.tokens[field.key]"
                  :label="field.label"
                  :hint="field.hint"
                  type="number"
                  :min="1"
                  :error="state.tokens.fieldErrors[field.key]" />
              </div>

              <div
                v-else-if="section.name === 'branding'"
                class="grid gap-4 sm:grid-cols-2">
                <DgInput
                  v-model="drafts.branding.appName"
                  label="App name"
                  :error="state.branding.fieldErrors.appName" />
                <DgInput
                  v-model="drafts.branding.logoUrl"
                  label="Logo URL"
                  type="url"
                  :placeholder="LOGO_PLACEHOLDER"
                  hint="Optional. Shown at the top of emails."
                  :error="state.branding.fieldErrors.logoUrl" />
              </div>

              <DgAlert v-if="state[section.name].error">
                {{ state[section.name].error }}
              </DgAlert>
            </div>

            <footer
              class="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">
              <span
                v-if="state[section.name].saved && !dirty[section.name]"
                class="mr-auto text-sm text-ok">
                Saved
              </span>
              <DgButton
                v-if="dirty[section.name]"
                variant="ghost"
                :disabled="state[section.name].saving"
                @click="discard(section.name)">
                Discard
              </DgButton>
              <DgButton
                type="submit"
                variant="primary"
                :disabled="!dirty[section.name]"
                :loading="state[section.name].saving">
                Save
              </DgButton>
            </footer>
          </form>

          <section
            :class="card"
            aria-labelledby="smtp-heading"
            data-testid="settings-smtp">
            <header class="border-b border-line-soft px-5 py-3.5">
              <h2 id="smtp-heading" class="text-[15px]">
                Email delivery (SMTP)
              </h2>
              <p class="mt-0.5 text-sm text-ink-muted">
                <template v-if="settings.smtp.source === 'server_config'">
                  Set with DOPGATE_SMTP_* environment variables. Change them on
                  the server and restart dopgate.
                </template>
                <template v-else>
                  No SMTP server is set, so Dopgate writes emails to the server
                  log. Set the DOPGATE_SMTP_* environment variables to send real
                  email.
                </template>
              </p>
            </header>
            <div class="flex flex-col gap-4 px-5 py-4">
              <dl
                v-if="settings.smtp.source === 'server_config'"
                class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt class="text-ink-muted">Host</dt>
                <dd class="font-mono text-ink">
                  {{ settings.smtp.host ?? "Not set" }}:{{ settings.smtp.port }}
                </dd>
                <dt class="text-ink-muted">Security</dt>
                <dd class="text-ink">
                  {{ SECURITY_LABELS[settings.smtp.security] }}
                </dd>
                <dt class="text-ink-muted">Username</dt>
                <dd class="font-mono text-ink">
                  {{ settings.smtp.username ?? "None" }}
                </dd>
                <dt class="text-ink-muted">Password</dt>
                <dd class="text-ink">
                  {{ settings.smtp.passwordSet ? "Set" : "Not set" }}
                </dd>
                <dt class="text-ink-muted">From</dt>
                <dd class="text-ink">
                  <template v-if="settings.smtp.fromName"
                    >{{ settings.smtp.fromName }}
                  </template>
                  <span class="font-mono">{{
                    settings.smtp.fromEmail ?? "Not set"
                  }}</span>
                </dd>
              </dl>

              <form
                class="flex flex-col gap-3 sm:flex-row sm:items-end"
                novalidate
                @submit.prevent="sendTest">
                <DgInput
                  v-model="testTo"
                  class="flex-1"
                  label="Send a test email to"
                  type="email"
                  placeholder="Your own address" />
                <DgButton type="submit" :loading="testing"
                  >Send test email</DgButton
                >
              </form>
              <DgAlert
                v-if="testResult"
                :tone="testResult.ok ? 'success' : 'error'">
                {{ testResult.message }}
              </DgAlert>
            </div>
          </section>
        </template>
      </div>
    </div>
  </DashboardLayout>
</template>
