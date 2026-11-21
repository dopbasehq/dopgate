<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import SaveFooter from "~/components/app/SaveFooter.vue";
import SectionCard from "~/components/app/SectionCard.vue";
import SettingRow from "~/components/app/SettingRow.vue";
import SwitchRow from "~/components/app/SwitchRow.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgInput,
  DgSelect,
  DgSkeleton,
  DgSwitch,
} from "~/components/ui";
import { MailIcon } from "~/assets/icons";
import type { SmtpSecurity } from "~/services/types";
import {
  DEFAULT_FROM_EMAIL,
  LIMIT_GROUPS,
  SECURITY_OPTIONS,
  TOKEN_GROUPS,
  ZERO_ALLOWED,
  useSettingsController,
  type SectionName,
} from "./Settings.controller";

/**
 * Settings: how sign-up and sign-in work on this server. Each card saves
 * on its own. From 1024px a list beside the cards jumps to a card and
 * marks the ones with unsaved edits; below that the list is a row of
 * chips that scrolls sideways.
 */
const {
  settings,
  loadError,
  reload,
  drafts,
  state,
  dirty,
  save,
  discard,
  testing,
  testResult,
  sendTest,
} = useSettingsController();

// Kept out of the template: a static "https://" attribute trips vue-tsc.
const LOGO_PLACEHOLDER = "https://example.com/logo.png";

const SECURITY_LABELS = { starttls: "STARTTLS", tls: "TLS", none: "None" };

// The server's DOPGATE_SMTP_* variables win when DOPGATE_SMTP_URL is set.
const smtpEditable = computed(
  () => settings.value?.smtp.source !== "server_config",
);

const smtpDescription = computed(() => {
  switch (settings.value?.smtp.source) {
    case "server_config":
      return "Set on the server with DOPGATE_SMTP_* environment variables, which take priority. Change them there, or unset DOPGATE_SMTP_URL to manage email delivery here.";
    case "database":
      return "Dopgate sends email through this server. DOPGATE_SMTP_* environment variables on the server would take priority over it.";
    default:
      return "No SMTP server is set, so Dopgate writes emails to the server log. Add one here, or with the DOPGATE_SMTP_* environment variables.";
  }
});

/** Where mail goes, at a glance, next to the card's title. */
const smtpBadge = computed(() => {
  switch (settings.value?.smtp.source) {
    case "server_config":
      return { tone: "neutral" as const, label: "Set on the server" };
    case "database":
      return { tone: "ok" as const, label: "Sending" };
    default:
      return { tone: "warn" as const, label: "Server log" };
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

const testEmailHint = computed(() => {
  if (smtpEditable.value && dirty.value.smtp)
    return "Save your SMTP changes first. The test uses the saved settings.";
  if (drafts.value?.testEmail.recipient.trim())
    return "Template tests go here too. Clear it to send them to root.";
  return "Leave empty to send them to root. Template tests use this address too.";
});

/** The cards, in page order, for the section list. */
const NAV: { id: string; label: string; sections: SectionName[] }[] = [
  { id: "signup", label: "Sign-up", sections: ["signup"] },
  { id: "password", label: "Passwords", sections: ["password"] },
  { id: "limits", label: "Codes and lockout", sections: ["limits"] },
  { id: "tokens", label: "Sessions", sections: ["tokens"] },
  {
    id: "selfService",
    label: "Personal tokens and agents",
    sections: ["selfService"],
  },
  { id: "branding", label: "Branding", sections: ["branding"] },
  { id: "smtp", label: "Email delivery", sections: ["smtp", "testEmail"] },
];

const unsaved = (sections: SectionName[]) =>
  sections.some((name) => dirty.value[name]);

// Section list: follows the card nearest the top of the screen.
const active = ref(NAV[0]!.id);
let observer: IntersectionObserver | null = null;

function cardElement(id: string): HTMLElement | null {
  return document.getElementById(`settings-card-${id}`);
}

function observe(): void {
  observer?.disconnect();
  if (typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const first = visible[0]?.target.id.replace("settings-card-", "");
      if (first) active.value = first;
    },
    // A band near the top of the screen decides which card is current.
    { rootMargin: "-15% 0px -70% 0px" },
  );
  for (const item of NAV) {
    const element = cardElement(item.id);
    if (element) observer.observe(element);
  }
}

watch(
  () => drafts.value !== null && settings.value !== null,
  async (ready) => {
    if (!ready) return;
    await nextTick();
    observe();
  },
  { immediate: true },
);

onBeforeUnmount(() => observer?.disconnect());

function jump(id: string): void {
  active.value = id;
  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  cardElement(id)?.scrollIntoView({
    behavior: reduced ? "auto" : "smooth",
    block: "start",
  });
}
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Settings"
        subtitle="How sign-up and sign-in work on this server." />

      <div v-if="loadError" class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div
        v-else-if="!settings || !drafts"
        class="flex flex-col gap-3 lg:pl-[240px]">
        <DgSkeleton
          v-for="line in 4"
          :key="line"
          class="h-40 w-full max-w-[880px] rounded-card" />
      </div>

      <div
        v-else
        class="flex flex-col gap-5 lg:grid lg:grid-cols-[208px_minmax(0,880px)] lg:items-start lg:gap-8">
        <!-- Section list: a column from 1024px, a row of chips below. -->
        <nav
          aria-label="Settings sections"
          class="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:sticky lg:top-8 lg:mx-0 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden"
          data-testid="settings-nav">
          <ul class="flex gap-2 lg:flex-col lg:gap-0.5">
            <li v-for="item in NAV" :key="item.id" class="shrink-0">
              <a
                :href="`#settings-card-${item.id}`"
                class="flex h-8 items-center gap-2 whitespace-nowrap rounded-control px-3 text-sm font-medium transition-colors lg:px-2.5"
                :class="
                  active === item.id
                    ? 'bg-raised text-ink-strong'
                    : 'text-ink-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-raised/60 hover:text-ink-strong lg:shadow-none'
                "
                :aria-current="active === item.id ? 'true' : undefined"
                @click.prevent="jump(item.id)">
                <span class="lg:flex-1">{{ item.label }}</span>
                <span
                  v-if="unsaved(item.sections)"
                  class="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                  aria-hidden="true" />
                <span v-if="unsaved(item.sections)" class="sr-only">
                  (unsaved changes)
                </span>
              </a>
            </li>
          </ul>
        </nav>

        <div class="flex min-w-0 flex-col gap-5">
          <!-- Sign-up -->
          <SectionCard
            id="settings-card-signup"
            as="form"
            class="scroll-mt-16 lg:scroll-mt-8"
            title="Sign-up"
            description="Who can create an account, and how."
            data-testid="settings-signup"
            @submit.prevent="save('signup')">
            <SwitchRow
              v-model="drafts.signup.enabled"
              title="Open sign-up"
              description="Anyone can sign up from your app." />
            <SwitchRow
              v-model="drafts.signup.requireEmailVerification"
              title="Verified email"
              description="People need a verified email before they can sign in." />
            <SwitchRow
              v-model="drafts.signup.passwordlessSignup"
              title="Email code sign-up"
              description="People can sign up with an email code, without a password." />
            <DgAlert v-if="state.signup.error" class="mb-4">
              {{ state.signup.error }}
            </DgAlert>
            <template #footer>
              <SaveFooter
                :dirty="dirty.signup"
                :saving="state.signup.saving"
                :saved="state.signup.saved"
                @discard="discard('signup')" />
            </template>
          </SectionCard>

          <!-- Passwords -->
          <SectionCard
            id="settings-card-password"
            as="form"
            class="scroll-mt-16 lg:scroll-mt-8"
            title="Passwords"
            description="Rules for new passwords."
            data-testid="settings-password"
            @submit.prevent="save('password')">
            <SettingRow
              title="Length"
              description="The fewest characters a new password can have.">
              <DgInput
                v-model="drafts.password.minLength"
                class="md:max-w-[260px]"
                label="Minimum length"
                unit="characters"
                type="number"
                :min="1"
                :error="state.password.fieldErrors.minLength" />
            </SettingRow>
            <SwitchRow
              v-model="drafts.password.rejectLeaked"
              title="Refuse leaked passwords"
              :description="[
                'Attackers try passwords from past breaches first, because people reuse them. With this on, someone who picks one of those is asked to choose another.',
                'To check, Dopgate sends the first five characters of the password’s hash to Pwned Passwords. The password never leaves this server. If the list can’t be reached, the password is accepted.',
              ]" />
            <DgAlert v-if="state.password.error" class="mb-4">
              {{ state.password.error }}
            </DgAlert>
            <template #footer>
              <SaveFooter
                :dirty="dirty.password"
                :saving="state.password.saving"
                :saved="state.password.saved"
                @discard="discard('password')" />
            </template>
          </SectionCard>

          <!-- Codes and lockout -->
          <SectionCard
            id="settings-card-limits"
            as="form"
            class="scroll-mt-16 lg:scroll-mt-8"
            title="Codes and lockout"
            description="Email codes, failed sign-ins and rate limits."
            data-testid="settings-limits"
            @submit.prevent="save('limits')">
            <SettingRow
              v-for="group in LIMIT_GROUPS"
              :key="group.title"
              :title="group.title"
              :description="group.description">
              <div class="grid gap-3 @md:grid-cols-2">
                <DgInput
                  v-for="field in group.fields"
                  :key="field.key"
                  v-model="drafts.limits[field.key]"
                  :class="group.fields.length === 1 ? 'md:max-w-[260px]' : ''"
                  :label="field.label"
                  :unit="field.unit"
                  :hint="field.hint"
                  type="number"
                  :min="ZERO_ALLOWED.has(field.key) ? 0 : 1"
                  :error="state.limits.fieldErrors[field.key]" />
              </div>
            </SettingRow>
            <DgAlert v-if="state.limits.error" class="mb-4">
              {{ state.limits.error }}
            </DgAlert>
            <template #footer>
              <SaveFooter
                :dirty="dirty.limits"
                :saving="state.limits.saving"
                :saved="state.limits.saved"
                @discard="discard('limits')" />
            </template>
          </SectionCard>

          <!-- Sessions -->
          <SectionCard
            id="settings-card-tokens"
            as="form"
            class="scroll-mt-16 lg:scroll-mt-8"
            title="Sessions"
            description="How long tokens and sessions last."
            data-testid="settings-tokens"
            @submit.prevent="save('tokens')">
            <SettingRow
              v-for="group in TOKEN_GROUPS"
              :key="group.title"
              :title="group.title"
              :description="group.description">
              <div class="grid gap-3 @md:grid-cols-2">
                <DgInput
                  v-for="field in group.fields"
                  :key="field.key"
                  v-model="drafts.tokens[field.key]"
                  :class="group.fields.length === 1 ? 'md:max-w-[260px]' : ''"
                  :label="field.label"
                  :unit="field.unit"
                  :hint="field.hint"
                  type="number"
                  :min="ZERO_ALLOWED.has(field.key) ? 0 : 1"
                  :error="state.tokens.fieldErrors[field.key]" />
              </div>
            </SettingRow>
            <DgAlert v-if="state.tokens.error" class="mb-4">
              {{ state.tokens.error }}
            </DgAlert>
            <template #footer>
              <SaveFooter
                :dirty="dirty.tokens"
                :saving="state.tokens.saving"
                :saved="state.tokens.saved"
                @discard="discard('tokens')" />
            </template>
          </SectionCard>

          <!-- Personal tokens and agents -->
          <SectionCard
            id="settings-card-selfService"
            as="form"
            class="scroll-mt-16 lg:scroll-mt-8"
            title="Personal tokens and agents"
            description="What your app’s users can make for themselves. Admins can always make agents."
            data-testid="settings-selfService"
            @submit.prevent="save('selfService')">
            <SettingRow
              title="Personal tokens"
              description="Tokens that sign in as the user who made them.">
              <DgSwitch
                v-model="drafts.selfService.personalTokens"
                label="Users can create personal tokens" />
              <DgInput
                v-model="drafts.selfService.maxPersonalTokensPerUser"
                class="md:max-w-[260px]"
                label="Personal tokens per user"
                type="number"
                :min="1"
                :error="
                  state.selfService.fieldErrors.maxPersonalTokensPerUser
                " />
            </SettingRow>
            <SettingRow
              title="Agents"
              description="Agents that belong to the user who made them.">
              <DgSwitch
                v-model="drafts.selfService.agents"
                label="Users can create agents of their own" />
              <DgInput
                v-model="drafts.selfService.maxAgentsPerUser"
                class="md:max-w-[260px]"
                label="Agents per user"
                type="number"
                :min="1"
                :error="state.selfService.fieldErrors.maxAgentsPerUser" />
            </SettingRow>
            <DgAlert v-if="state.selfService.error" class="mb-4">
              {{ state.selfService.error }}
            </DgAlert>
            <template #footer>
              <SaveFooter
                :dirty="dirty.selfService"
                :saving="state.selfService.saving"
                :saved="state.selfService.saved"
                note="Turning a switch off stops new ones. Tokens and agents that already exist keep working."
                @discard="discard('selfService')" />
            </template>
          </SectionCard>

          <!-- Branding -->
          <SectionCard
            id="settings-card-branding"
            as="form"
            class="scroll-mt-16 lg:scroll-mt-8"
            title="Branding"
            description="The name and logo in emails and on sign-in pages."
            data-testid="settings-branding"
            @submit.prevent="save('branding')">
            <SettingRow
              title="App name"
              description="What people see your app called.">
              <DgInput
                v-model="drafts.branding.appName"
                label="App name"
                :error="state.branding.fieldErrors.appName" />
            </SettingRow>
            <SettingRow
              title="Logo"
              description="Optional. Shown at the top of emails.">
              <DgInput
                v-model="drafts.branding.logoUrl"
                label="Logo URL"
                type="url"
                :placeholder="LOGO_PLACEHOLDER"
                :error="state.branding.fieldErrors.logoUrl" />
            </SettingRow>
            <DgAlert v-if="state.branding.error" class="mb-4">
              {{ state.branding.error }}
            </DgAlert>
            <template #footer>
              <SaveFooter
                :dirty="dirty.branding"
                :saving="state.branding.saving"
                :saved="state.branding.saved"
                @discard="discard('branding')" />
            </template>
          </SectionCard>

          <!-- Email delivery -->
          <SectionCard
            id="settings-card-smtp"
            class="scroll-mt-16 lg:scroll-mt-8"
            title="Email delivery"
            :description="smtpDescription"
            data-testid="settings-smtp">
            <template #badge>
              <DgBadge :tone="smtpBadge.tone">{{ smtpBadge.label }}</DgBadge>
            </template>

            <form
              v-if="smtpEditable"
              novalidate
              data-testid="settings-smtp-form"
              @submit.prevent="save('smtp')">
              <SettingRow
                title="Server"
                description="Leave the host empty to write emails to the server log.">
                <div class="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
                  <DgInput
                    v-model="drafts.smtp.host"
                    label="Host"
                    placeholder="smtp.example.com"
                    mono
                    :error="state.smtp.fieldErrors.host" />
                  <DgInput
                    v-model="drafts.smtp.port"
                    label="Port"
                    type="number"
                    :min="1"
                    :max="65535"
                    :error="state.smtp.fieldErrors.port" />
                </div>
                <DgSelect
                  :model-value="drafts.smtp.security"
                  label="Security"
                  :options="SECURITY_OPTIONS"
                  @update:model-value="
                    drafts.smtp.security = $event as SmtpSecurity
                  " />
              </SettingRow>
              <SettingRow
                title="Sign-in"
                description="Leave the username empty if the server doesn’t ask for one.">
                <div class="grid gap-3 @md:grid-cols-2">
                  <DgInput
                    v-model="drafts.smtp.username"
                    label="Username"
                    autocomplete="off" />
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
                </div>
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
              </SettingRow>
              <SettingRow
                title="Sender"
                description="Who the emails come from.">
                <div class="grid gap-3 @md:grid-cols-2">
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
              </SettingRow>
              <DgAlert v-if="state.smtp.error" class="mb-4">
                {{ state.smtp.error }}
              </DgAlert>
              <SaveFooter
                :dirty="dirty.smtp"
                :saving="state.smtp.saving"
                :saved="state.smtp.saved"
                @discard="discard('smtp')" />
            </form>

            <dl
              v-else
              class="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 border-t border-line-soft py-[18px] text-sm">
              <dt class="text-ink-muted">Host</dt>
              <dd class="font-mono text-ink-strong">
                {{ settings.smtp.host ?? "Not set" }}:{{ settings.smtp.port }}
              </dd>
              <dt class="text-ink-muted">Security</dt>
              <dd class="text-ink-strong">
                {{ SECURITY_LABELS[settings.smtp.security] }}
              </dd>
              <dt class="text-ink-muted">Username</dt>
              <dd class="font-mono text-ink-strong">
                {{ settings.smtp.username ?? "None" }}
              </dd>
              <dt class="text-ink-muted">Password</dt>
              <dd class="text-ink-strong">
                {{ settings.smtp.passwordSet ? "Set" : "Not set" }}
              </dd>
              <dt class="text-ink-muted">From</dt>
              <dd class="text-ink-strong">
                <template v-if="settings.smtp.fromName"
                  >{{ settings.smtp.fromName }}
                </template>
                <span class="ml-2 font-mono">{{
                  settings.smtp.fromEmail
                }}</span>
              </dd>
            </dl>

            <!-- Test emails: saved on their own, used by template tests too. -->
            <form
              :class="smtpEditable ? 'mt-4' : ''"
              novalidate
              data-testid="settings-testEmail"
              @submit.prevent="sendTest">
              <SettingRow
                class="pb-0"
                title="Test emails"
                description="Where the SMTP test and template tests go. The test uses the saved settings.">
                <DgInput
                  v-model="drafts.testEmail.recipient"
                  label="Send test emails to"
                  type="email"
                  :placeholder="settings.testEmail.rootEmail ?? 'Root’s email'"
                  :hint="testEmailHint"
                  :error="state.testEmail.fieldErrors.recipient" />
                <!-- The field keeps the full width; its buttons get a row. -->
                <div class="flex flex-wrap items-center gap-2">
                  <DgButton
                    type="submit"
                    :loading="testing"
                    :disabled="state.testEmail.saving">
                    <MailIcon class="h-4 w-4" />
                    Send test email
                  </DgButton>
                  <div
                    v-if="dirty.testEmail"
                    class="ml-auto flex items-center gap-2">
                    <DgButton
                      variant="ghost"
                      :disabled="state.testEmail.saving"
                      @click="discard('testEmail')">
                      Discard
                    </DgButton>
                    <DgButton
                      variant="primary"
                      :loading="state.testEmail.saving"
                      @click="save('testEmail')">
                      Save
                    </DgButton>
                  </div>
                </div>
                <DgAlert v-if="state.testEmail.error">
                  {{ state.testEmail.error }}
                </DgAlert>
                <DgAlert
                  v-if="testResult"
                  :tone="testResult.ok ? 'success' : 'error'">
                  {{ testResult.message }}
                </DgAlert>
              </SettingRow>
            </form>
          </SectionCard>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>
