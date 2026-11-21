<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import SaveFooter from "~/components/app/SaveFooter.vue";
import SectionCard from "~/components/app/SectionCard.vue";
import SettingRow from "~/components/app/SettingRow.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgCodeInput,
  DgInput,
  DgSkeleton,
  DgStatus,
} from "~/components/ui";
import {
  describeUserAgent,
  formatRelativeTime,
  formatRole,
  formatSignInMethod,
} from "~/utils/format";
import { useAccountController } from "./Account.controller";

const {
  user,
  displayName,
  profileDirty,
  savingProfile,
  profileError,
  profileSaved,
  saveProfile,
  discardProfile,
  hasPassword,
  currentPassword,
  passwordCode,
  passwordCodeSent,
  sendingPasswordCode,
  requestPasswordCode,
  newPassword,
  confirmPassword,
  passwordErrors,
  passwordError,
  passwordChanged,
  changingPassword,
  passwordFilled,
  passwordMinLength,
  clearPassword,
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
  emailFilled,
  clearEmail,
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
} = useAccountController();

const newPasswordPlaceholder = computed(() =>
  passwordMinLength.value
    ? `At least ${passwordMinLength.value} characters`
    : undefined,
);

/** One form for both steps: send the code, then confirm it. */
function submitEmail(): void {
  if (emailStep.value === "idle") void requestEmailChange();
  else void confirmEmail();
}
</script>

<template>
  <DashboardLayout>
    <div class="page-width py-6 lg:py-8">
      <div class="flex max-w-[960px] flex-col gap-5">
        <PageHeader title="Account" subtitle="Your own sign-in details.">
          <template v-if="user" #meta>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <span class="font-mono text-sm text-ink">{{ user.email }}</span>
              <DgBadge :tone="user.role === 'root' ? 'accent' : 'neutral'">
                {{ formatRole(user.role) }}
              </DgBadge>
            </div>
          </template>
        </PageHeader>

        <SectionCard as="form" title="Profile" @submit.prevent="saveProfile">
          <SettingRow
            title="Display name"
            description="The name other admins see next to your email.">
            <DgInput
              v-model="displayName"
              label="Display name"
              autocomplete="name" />
            <DgAlert v-if="profileError">{{ profileError }}</DgAlert>
          </SettingRow>
          <template #footer>
            <SaveFooter
              :dirty="profileDirty"
              :saving="savingProfile"
              :saved="profileSaved && !profileDirty"
              @discard="discardProfile" />
          </template>
        </SectionCard>

        <SectionCard
          as="form"
          title="Password"
          data-testid="password-form"
          @submit.prevent="submitPassword">
          <SettingRow
            :title="hasPassword ? 'Change password' : 'Set a password'"
            description="Changing it signs out your other sessions. This one stays signed in.">
            <DgInput
              v-if="hasPassword"
              v-model="currentPassword"
              label="Current password"
              type="password"
              autocomplete="current-password"
              :error="passwordErrors.current" />
            <div v-else class="flex flex-col gap-2" data-testid="password-code">
              <p class="text-sm text-ink-muted">
                Your account has no password yet. To set one, we email a code to
                <span class="font-mono text-ink">{{ user?.email }}</span
                >.
              </p>
              <div class="flex flex-wrap items-end gap-3">
                <DgCodeInput
                  v-model="passwordCode"
                  label="Code"
                  :error="passwordErrors.code"
                  :disabled="changingPassword" />
                <DgButton
                  variant="ghost"
                  :loading="sendingPasswordCode"
                  @click="requestPasswordCode">
                  {{ passwordCodeSent ? "Send a new code" : "Email me a code" }}
                </DgButton>
              </div>
            </div>
            <div class="grid gap-3 @md:grid-cols-2">
              <DgInput
                v-model="newPassword"
                label="New password"
                type="password"
                autocomplete="new-password"
                :placeholder="newPasswordPlaceholder"
                :error="passwordErrors.next" />
              <DgInput
                v-model="confirmPassword"
                label="Confirm new password"
                type="password"
                autocomplete="new-password"
                placeholder="Type it again"
                :error="passwordErrors.confirm" />
            </div>
            <DgAlert v-if="passwordError">{{ passwordError }}</DgAlert>
            <DgAlert v-if="passwordChanged" tone="success">
              Password changed.
            </DgAlert>
          </SettingRow>
          <template #footer>
            <SaveFooter
              :dirty="passwordFilled"
              :saving="changingPassword"
              :label="hasPassword ? 'Change password' : 'Set password'"
              @discard="clearPassword" />
          </template>
        </SectionCard>

        <SectionCard as="form" title="Email" @submit.prevent="submitEmail">
          <SettingRow
            v-if="emailStep === 'idle'"
            title="Change email"
            description="We send a code to the new address. Your email changes once you enter it.">
            <DgInput
              v-model="newEmail"
              label="New email"
              type="email"
              autocomplete="email"
              placeholder="you@dopgate.com"
              :error="emailFieldError" />
            <DgInput
              v-if="needsEmailPassword"
              v-model="emailPassword"
              label="Current password"
              type="password"
              autocomplete="current-password"
              placeholder="Needed to change your email"
              :error="emailPasswordError" />
            <DgAlert v-if="emailError">{{ emailError }}</DgAlert>
            <DgAlert v-else-if="emailChanged" tone="success">
              Email changed.
            </DgAlert>
          </SettingRow>
          <div
            v-else
            class="flex flex-col items-center gap-4 border-t border-line-soft py-5"
            data-testid="email-code-form">
            <p class="text-center text-sm text-ink-muted">
              Enter the 6-digit code we sent to
              <span class="font-mono text-ink">{{ newEmail }}</span
              >.
            </p>
            <DgCodeInput
              v-model="emailCode"
              label="Code"
              autofocus
              :error="emailCodeError"
              :disabled="changingEmail"
              @complete="confirmEmail" />
            <div class="flex gap-2">
              <DgButton
                variant="ghost"
                :disabled="changingEmail"
                @click="cancelEmailChange">
                Cancel
              </DgButton>
              <DgButton
                type="submit"
                variant="primary"
                :loading="changingEmail">
                Change email
              </DgButton>
            </div>
          </div>
          <template v-if="emailStep === 'idle'" #footer>
            <SaveFooter
              :dirty="emailFilled"
              :saving="changingEmail"
              label="Send code"
              @discard="clearEmail" />
          </template>
        </SectionCard>

        <SectionCard title="Sessions" description="Where you are signed in.">
          <template v-if="hasOtherSessions" #action>
            <DgButton
              size="sm"
              :loading="revoking === 'others'"
              :disabled="revoking !== null"
              data-testid="sign-out-others"
              @click="revokeOthers">
              <span class="hidden sm:inline">Sign out other sessions</span>
              <span class="sm:hidden">Sign out others</span>
            </DgButton>
          </template>
          <DgAlert v-if="sessionsError">{{ sessionsError }}</DgAlert>
          <DgSkeleton v-else-if="!sessions" class="h-10 rounded-control" />
          <ul v-else class="flex flex-col">
            <li
              v-for="session in sessions"
              :key="session.id"
              class="flex items-center gap-3 border-t border-line-soft py-3 text-sm">
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span
                    class="truncate text-ink-strong"
                    :title="session.userAgent ?? undefined">
                    {{ describeUserAgent(session.userAgent) }}
                  </span>
                  <DgStatus v-if="session.current">This browser</DgStatus>
                </p>
                <p class="mt-0.5 text-ink-muted">
                  {{ formatSignInMethod(session.method) }}
                  <template v-if="session.ipAddress">
                    · <span class="font-mono">{{ session.ipAddress }}</span>
                  </template>
                  · active {{ formatRelativeTime(session.lastUsedAt) }}
                </p>
              </div>
              <DgButton
                v-if="!session.current"
                size="sm"
                variant="ghost"
                :loading="revoking === session.id"
                :disabled="revoking !== null"
                @click="revoke(session.id)">
                Sign out
              </DgButton>
            </li>
          </ul>
          <DgAlert v-if="sessionError" class="mt-2">{{ sessionError }}</DgAlert>
        </SectionCard>
      </div>
    </div>
  </DashboardLayout>
</template>
