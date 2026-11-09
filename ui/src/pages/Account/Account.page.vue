<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgCodeInput,
  DgInput,
  DgSkeleton,
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
} = useAccountController();

const card = "rounded-card border border-line bg-panel";
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

        <form :class="card" novalidate @submit.prevent="saveProfile">
          <header class="border-b border-line-soft px-5 py-3.5">
            <h2 class="text-[15px]">Profile</h2>
          </header>
          <div class="flex flex-col gap-3 px-5 py-4">
            <div class="max-w-md">
              <DgInput
                v-model="displayName"
                label="Display name"
                autocomplete="name" />
            </div>
            <DgAlert v-if="profileError">{{ profileError }}</DgAlert>
          </div>
          <footer
            class="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">
            <span
              v-if="profileSaved && !profileDirty"
              class="mr-auto text-sm text-ok">
              Saved
            </span>
            <DgButton
              type="submit"
              variant="primary"
              :disabled="!profileDirty"
              :loading="savingProfile">
              Save
            </DgButton>
          </footer>
        </form>

        <form
          :class="card"
          novalidate
          data-testid="password-form"
          @submit.prevent="submitPassword">
          <header class="border-b border-line-soft px-5 py-3.5">
            <h2 class="text-[15px]">Password</h2>
          </header>
          <div class="grid gap-3 px-5 py-4 sm:grid-cols-3">
            <DgInput
              v-model="currentPassword"
              label="Current password"
              type="password"
              autocomplete="current-password"
              :error="passwordErrors.current" />
            <DgInput
              v-model="newPassword"
              label="New password"
              type="password"
              autocomplete="new-password"
              :error="passwordErrors.next" />
            <DgInput
              v-model="confirmPassword"
              label="Confirm new password"
              type="password"
              autocomplete="new-password"
              :error="passwordErrors.confirm" />
            <DgAlert v-if="passwordError" class="sm:col-span-3">{{
              passwordError
            }}</DgAlert>
            <DgAlert
              v-if="passwordChanged"
              tone="success"
              class="sm:col-span-3">
              Password changed.
            </DgAlert>
          </div>
          <footer class="flex justify-end border-t border-line-soft px-5 py-3">
            <DgButton
              type="submit"
              variant="primary"
              :loading="changingPassword">
              Change password
            </DgButton>
          </footer>
        </form>

        <section :class="card" aria-labelledby="email-heading">
          <header class="border-b border-line-soft px-5 py-3.5">
            <h2 id="email-heading" class="text-[15px]">Email</h2>
            <p class="mt-0.5 text-sm text-ink-muted">
              We send a code to the new address. Your email changes once you
              enter it.
            </p>
          </header>
          <form
            v-if="emailStep === 'idle'"
            class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start"
            novalidate
            @submit.prevent="requestEmailChange">
            <DgInput
              v-model="newEmail"
              class="flex-1"
              label="New email"
              type="email"
              autocomplete="email"
              :error="emailFieldError" />
            <DgInput
              v-if="needsEmailPassword"
              v-model="emailPassword"
              class="flex-1"
              label="Current password"
              type="password"
              autocomplete="current-password"
              :error="emailPasswordError" />
            <DgButton type="submit" class="sm:mt-1.5" :loading="changingEmail">
              Send code
            </DgButton>
          </form>
          <form
            v-else
            class="flex flex-col items-center gap-4 px-5 py-5"
            novalidate
            data-testid="email-code-form"
            @submit.prevent="confirmEmail">
            <p class="text-sm text-ink-muted">
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
          </form>
          <div v-if="emailError || emailChanged" class="px-5 pb-4">
            <DgAlert v-if="emailError">{{ emailError }}</DgAlert>
            <DgAlert v-else tone="success">Email changed.</DgAlert>
          </div>
        </section>

        <section :class="card" aria-labelledby="sessions-heading">
          <header
            class="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
            <h2 id="sessions-heading" class="text-[15px]">Sessions</h2>
            <DgButton
              v-if="hasOtherSessions"
              size="sm"
              :loading="revoking === 'others'"
              :disabled="revoking !== null"
              data-testid="sign-out-others"
              @click="revokeOthers">
              Sign out other sessions
            </DgButton>
          </header>
          <div class="px-5 py-2">
            <DgAlert v-if="sessionsError" class="my-2">{{
              sessionsError
            }}</DgAlert>
            <DgSkeleton
              v-else-if="!sessions"
              class="my-2 h-10 rounded-control" />
            <ul v-else class="divide-y divide-line-soft">
              <li
                v-for="session in sessions"
                :key="session.id"
                class="flex items-center gap-3 py-2.5 text-sm">
                <div class="min-w-0 flex-1">
                  <p class="flex items-center gap-2 text-ink-strong">
                    <span
                      class="truncate"
                      :title="session.userAgent ?? undefined">
                      {{ describeUserAgent(session.userAgent) }}
                    </span>
                    <DgBadge v-if="session.current" tone="ok"
                      >This browser</DgBadge
                    >
                  </p>
                  <p class="text-ink-muted">
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
            <DgAlert v-if="sessionError" class="my-2">{{
              sessionError
            }}</DgAlert>
          </div>
        </section>
      </div>
    </div>
  </DashboardLayout>
</template>
