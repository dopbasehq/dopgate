<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgButton,
  DgInput,
  DgSelect,
  DgSkeleton,
  DgSwitch,
} from "~/components/ui";
import type { SmtpSecurity } from "~/services/types";
import {
  DEFAULT_FROM_EMAIL,
  LIMIT_FIELDS,
  SECURITY_OPTIONS,
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

// The server's DOPGATE_SMTP_* variables win when they set a host.
const smtpEditable = computed(
  () => settings.value?.smtp.source !== "server_config",
);

const smtpDescription = computed(() => {
  switch (settings.value?.smtp.source) {
    case "server_config":
      return "Set on the server with DOPGATE_SMTP_* environment variables, which take priority. Change them there, or unset DOPGATE_SMTP_HOST to manage email delivery here.";
    case "database":
      return "Dopgate sends email through this server. DOPGATE_SMTP_* environment variables on the server would take priority over it.";
    default:
      return "No SMTP server is set, so Dopgate writes emails to the server log. Add one here, or with the DOPGATE_SMTP_* environment variables.";
  }
});

const passwordHint = computed(() => {
  const smtp = settings.value?.smtp;
  if (drafts.value?.smtp.clearPassword)
    return "The saved password is removed when you save.";
  if (!smtp?.canStorePassword)
    return "Set DOPGATE_SERVICE_KEY on the server to save a password. Dopgate encrypts it with that key.";
  if (smtp.passwordSet) return "Saved and encrypted. Leave empty to keep it.";
  return "Stored encrypted.";
});

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
    name: "selfService",
    title: "Tokens and agents",
    description:
      "What your app's users can make for themselves. Admins can always make agents.",
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

              <template v-else-if="section.name === 'selfService'">
                <DgSwitch
                  v-model="drafts.selfService.personalTokens"
                  label="Users can create personal tokens that sign in as themselves" />
                <DgSwitch
                  v-model="drafts.selfService.agents"
                  label="Users can create agents of their own" />
                <div class="grid gap-4 sm:grid-cols-2">
                  <DgInput
                    v-model="drafts.selfService.maxPersonalTokensPerUser"
                    label="Personal tokens per user"
                    type="number"
                    :min="1"
                    :error="
                      state.selfService.fieldErrors.maxPersonalTokensPerUser
                    " />
                  <DgInput
                    v-model="drafts.selfService.maxAgentsPerUser"
                    label="Agents per user"
                    type="number"
                    :min="1"
                    :error="state.selfService.fieldErrors.maxAgentsPerUser" />
                </div>
                <p class="text-sm text-ink-muted">
                  Turning a switch off stops new ones. Tokens and agents that
                  already exist keep working.
                </p>
              </template>

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
                {{ smtpDescription }}
              </p>
            </header>

            <form
              v-if="smtpEditable"
              novalidate
              data-testid="settings-smtp-form"
              @submit.prevent="save('smtp')">
              <div class="flex flex-col gap-4 px-5 py-4">
                <div class="grid gap-4 sm:grid-cols-2">
                  <DgInput
                    v-model="drafts.smtp.host"
                    label="Host"
                    placeholder="smtp.example.com"
                    hint="Leave empty to write emails to the server log."
                    mono
                    :error="state.smtp.fieldErrors.host" />
                  <DgInput
                    v-model="drafts.smtp.port"
                    label="Port"
                    type="number"
                    :min="1"
                    :max="65535"
                    :error="state.smtp.fieldErrors.port" />
                  <DgSelect
                    :model-value="drafts.smtp.security"
                    label="Security"
                    :options="SECURITY_OPTIONS"
                    @update:model-value="
                      drafts.smtp.security = $event as SmtpSecurity
                    " />
                  <DgInput
                    v-model="drafts.smtp.username"
                    label="Username"
                    autocomplete="off"
                    hint="Leave empty if the server doesn't ask for one." />
                  <div class="flex flex-col gap-1.5">
                    <DgInput
                      v-model="drafts.smtp.password"
                      label="Password"
                      type="password"
                      autocomplete="new-password"
                      :placeholder="
                        settings.smtp.passwordSet ? 'Saved' : 'Not set'
                      "
                      :disabled="
                        !settings.smtp.canStorePassword ||
                        drafts.smtp.clearPassword
                      "
                      :hint="passwordHint" />
                    <button
                      v-if="settings.smtp.passwordSet"
                      type="button"
                      class="self-start text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                      @click="
                        drafts.smtp.clearPassword = !drafts.smtp.clearPassword;
                        drafts.smtp.password = '';
                      ">
                      {{
                        drafts.smtp.clearPassword
                          ? "Keep the saved password"
                          : "Remove the saved password"
                      }}
                    </button>
                  </div>
                  <DgInput
                    v-model="drafts.smtp.fromEmail"
                    label="From address"
                    type="email"
                    :placeholder="DEFAULT_FROM_EMAIL"
                    :hint="`Leave empty to use ${DEFAULT_FROM_EMAIL}.`"
                    :error="state.smtp.fieldErrors.fromEmail" />
                  <DgInput
                    v-model="drafts.smtp.fromName"
                    label="From name"
                    hint="Optional. Shown next to the address." />
                </div>

                <DgAlert v-if="state.smtp.error">
                  {{ state.smtp.error }}
                </DgAlert>
              </div>

              <footer
                class="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">
                <span
                  v-if="state.smtp.saved && !dirty.smtp"
                  class="mr-auto text-sm text-ok">
                  Saved
                </span>
                <DgButton
                  v-if="dirty.smtp"
                  variant="ghost"
                  :disabled="state.smtp.saving"
                  @click="discard('smtp')">
                  Discard
                </DgButton>
                <DgButton
                  type="submit"
                  variant="primary"
                  :disabled="!dirty.smtp"
                  :loading="state.smtp.saving">
                  Save
                </DgButton>
              </footer>
            </form>

            <div v-else class="px-5 py-4">
              <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
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
                  <span class="font-mono">{{ settings.smtp.fromEmail }}</span>
                </dd>
              </dl>
            </div>

            <div
              class="flex flex-col gap-4 border-t border-line-soft px-5 py-4">
              <form
                class="flex flex-col gap-3 sm:flex-row sm:items-end"
                novalidate
                @submit.prevent="sendTest">
                <DgInput
                  v-model="testTo"
                  class="flex-1"
                  label="Send a test email to"
                  type="email"
                  placeholder="Your own address"
                  :hint="
                    smtpEditable && dirty.smtp
                      ? 'Save your changes first. The test uses the saved settings.'
                      : null
                  " />
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
