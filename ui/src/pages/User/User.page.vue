<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import FactList from "~/components/app/FactList.vue";
import SaveFooter from "~/components/app/SaveFooter.vue";
import SectionCard from "~/components/app/SectionCard.vue";
import SettingRow from "~/components/app/SettingRow.vue";
import {
  DgAlert,
  DgAvatar,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgInput,
  DgJsonEditor,
  DgMenu,
  DgMenuItem,
  DgSkeleton,
  DgStatus,
} from "~/components/ui";
import {
  CheckIcon,
  ChevronRightIcon,
  HistoryIcon,
  KeyIcon,
  LockIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  TrashIcon,
} from "~/assets/icons";
import {
  describeUserAgent,
  formatDateTime,
  formatRelativeTime,
  formatSignInMethod,
} from "~/utils/format";
import { useUserController } from "./User.controller";

const {
  user,
  loadError,
  sessions,
  sessionsError,
  endingSession,
  sessionError,
  signOutSession,
  facts,
  tokens,
  tokensError,
  agents,
  agentsError,
  tokenToRevoke,
  revoking,
  revokeError,
  askRevoke,
  cancelRevoke,
  revokeToken,
  canManage,
  canDisableOrDelete,
  displayName,
  publicMetadata,
  privateMetadata,
  userMetadata,
  profileDirty,
  metadataDirty,
  metadataError,
  busy,
  error,
  notice,
  saved,
  saveProfile,
  saveMetadata,
  discardProfile,
  discardMetadata,
  enable,
  markVerified,
  sendReset,
  confirming,
  confirmError,
  ask,
  cancelConfirm,
  confirm,
  reload,
} = useUserController();

const locked = computed(
  () =>
    user.value?.lockedUntil != null &&
    new Date(user.value.lockedUntil).getTime() > Date.now(),
);

const confirmCopy = computed(() => {
  const email = user.value?.email ?? "";
  switch (confirming.value) {
    case "disable":
      return {
        title: "Turn off this account?",
        description: `${email} is signed out everywhere and can't sign in until an admin turns the account back on.`,
        confirmLabel: "Turn off",
        tone: "danger" as const,
        confirmWord: undefined,
      };
    case "sign-out-all":
      return {
        title: "Sign out everywhere?",
        description: `Ends every session ${email} has. Apps ask them to sign in again.`,
        confirmLabel: "Sign out everywhere",
        tone: "danger" as const,
        confirmWord: undefined,
      };
    default:
      return {
        title: "Delete this user?",
        description: `Deletes ${email} and ends their sessions. This can't be undone.`,
        confirmLabel: "Delete user",
        tone: "danger" as const,
        confirmWord: email,
      };
  }
});

const active = computed(() => user.value?.status === "active");
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <div v-if="loadError" class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div v-else-if="!user" class="flex flex-col gap-3">
        <DgSkeleton class="h-8 w-72 rounded-control" />
        <DgSkeleton class="h-40 w-full rounded-card" />
      </div>

      <template v-else>
        <PageHeader
          :title="user.email"
          :subtitle="user.displayName ?? undefined"
          :trail="[{ label: 'Users', to: { name: 'users' } }]">
          <template #leading>
            <DgAvatar
              :name="user.displayName || user.email"
              size="lg"
              :muted="!active" />
          </template>
          <template #meta>
            <div
              class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <DgStatus v-if="active">Active</DgStatus>
              <DgBadge v-else tone="crit">Turned off</DgBadge>
              <span
                v-if="user.emailVerified"
                class="inline-flex items-center gap-1.5 text-ink">
                <CheckIcon class="h-3.5 w-3.5 text-ok" aria-hidden="true" />
                Email verified
              </span>
              <DgBadge v-else tone="warn">Email not verified</DgBadge>
              <DgBadge v-if="!user.hasPassword">No password</DgBadge>
              <DgBadge v-if="locked" tone="warn">
                Locked until {{ formatDateTime(user.lockedUntil) }}
              </DgBadge>
            </div>
          </template>
          <template #actions>
            <RouterLink
              :to="{ name: 'audit', query: { actor: user.id } }"
              class="inline-flex h-10 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-raised hover:text-ink-strong active:bg-line-strong"
              data-testid="user-audit-link">
              <HistoryIcon class="h-4 w-4" aria-hidden="true" />
              View in audit log
            </RouterLink>
            <DgMenu v-if="canManage" label="User actions">
              <template #trigger="{ toggle, attrs }">
                <DgButton
                  v-bind="attrs"
                  data-testid="user-actions"
                  @click="toggle">
                  <MoreHorizontalIcon class="h-4 w-4" aria-hidden="true" />
                  Actions
                </DgButton>
              </template>
              <DgMenuItem
                v-if="user.status === 'disabled'"
                :disabled="busy !== null"
                @select="enable">
                <template #icon><LockIcon class="h-4 w-4" /></template>
                Turn account back on
              </DgMenuItem>
              <DgMenuItem :disabled="busy !== null" @select="sendReset">
                <template #icon><KeyIcon class="h-4 w-4" /></template>
                Send password reset code
              </DgMenuItem>
              <DgMenuItem
                v-if="!user.emailVerified"
                :disabled="busy !== null"
                @select="markVerified">
                <template #icon><CheckIcon class="h-4 w-4" /></template>
                Mark email verified
              </DgMenuItem>
              <template v-if="canDisableOrDelete">
                <DgMenuItem
                  v-if="user.status === 'active'"
                  :disabled="busy !== null"
                  @select="ask('disable')">
                  <template #icon><LockIcon class="h-4 w-4" /></template>
                  Turn off account
                </DgMenuItem>
                <div class="my-0.5 h-px bg-line-soft" role="separator" />
                <DgMenuItem tone="danger" @select="ask('delete')">
                  <template #icon><TrashIcon class="h-4 w-4" /></template>
                  Delete user
                </DgMenuItem>
              </template>
            </DgMenu>
          </template>
        </PageHeader>

        <DgAlert v-if="notice" tone="success">{{ notice }}</DgAlert>
        <DgAlert v-if="error">{{ error }}</DgAlert>

        <div
          class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <!-- First in the page so it sits above the cards below 1024px. -->
          <FactList
            :facts="facts"
            class="lg:col-start-2 lg:row-start-1"
            data-testid="user-facts" />

          <div
            class="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
            <SectionCard
              title="Profile"
              as="form"
              @submit.prevent="saveProfile">
              <SettingRow
                title="Display name"
                description="The name this person goes by.">
                <DgInput
                  v-model="displayName"
                  label="Display name"
                  :readonly="!canManage" />
              </SettingRow>
              <template v-if="canManage" #footer>
                <SaveFooter
                  :dirty="profileDirty"
                  :saving="busy === 'profile'"
                  :saved="saved === 'profile'"
                  @discard="discardProfile" />
              </template>
            </SectionCard>

            <SectionCard
              title="Sessions"
              description="Where this user is signed in.">
              <template
                v-if="canManage && sessions && sessions.length > 0"
                #action>
                <DgButton
                  size="sm"
                  aria-label="Sign out everywhere"
                  data-testid="sign-out-everywhere"
                  @click="ask('sign-out-all')">
                  <LogOutIcon class="h-3.5 w-3.5" aria-hidden="true" />
                  <span class="hidden sm:inline">Sign out everywhere</span>
                  <span class="sm:hidden">Sign out all</span>
                </DgButton>
              </template>
              <div class="border-t border-line-soft">
                <DgAlert v-if="sessionsError" class="my-3">{{
                  sessionsError
                }}</DgAlert>
                <DgSkeleton
                  v-else-if="!sessions"
                  class="my-3 h-10 rounded-control" />
                <p
                  v-else-if="sessions.length === 0"
                  class="pt-4 text-sm text-ink-muted">
                  No active sessions.
                </p>
                <ul v-else class="divide-y divide-line-soft">
                  <li
                    v-for="session in sessions"
                    :key="session.id"
                    class="flex items-center gap-3 py-3 text-sm"
                    data-testid="user-session">
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        class="truncate font-medium text-ink-strong"
                        :title="session.userAgent ?? undefined">
                        {{ describeUserAgent(session.userAgent) }}
                      </span>
                      <span class="text-ink-muted">
                        {{ formatSignInMethod(session.method) }}
                        <template v-if="session.ipAddress">
                          ·
                          <span class="font-mono">{{ session.ipAddress }}</span>
                        </template>
                        · active {{ formatRelativeTime(session.lastUsedAt) }}
                      </span>
                    </div>
                    <DgButton
                      v-if="canManage"
                      size="sm"
                      variant="ghost"
                      :loading="endingSession === session.id"
                      :disabled="endingSession !== null"
                      @click="signOutSession(session.id)">
                      Sign out
                    </DgButton>
                  </li>
                </ul>
                <DgAlert v-if="sessionError" class="mt-3">{{
                  sessionError
                }}</DgAlert>
              </div>
            </SectionCard>

            <SectionCard
              title="Personal tokens"
              description="Tokens this user made to sign in as themselves. You never see the tokens, but you can revoke them.">
              <div class="border-t border-line-soft">
                <DgAlert v-if="tokensError" class="mt-3">{{
                  tokensError
                }}</DgAlert>
                <DgSkeleton v-else-if="!tokens" class="mt-3 h-10 w-full" />
                <p
                  v-else-if="tokens.length === 0"
                  class="pt-4 text-sm text-ink-muted">
                  No personal tokens.
                </p>
                <ul
                  v-else
                  class="divide-y divide-line-soft"
                  data-testid="user-tokens">
                  <li
                    v-for="token in tokens"
                    :key="token.id"
                    class="flex items-center justify-between gap-3 py-3 text-sm">
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <span class="truncate font-medium text-ink-strong">
                        {{ token.name }}
                        <span class="font-mono font-normal text-ink-faint"
                          >dgp_••••{{ token.lastFour }}</span
                        >
                      </span>
                      <span class="text-ink-muted">
                        <template v-if="token.expired">Expired</template>
                        <template v-else-if="token.expiresAt">
                          Expires {{ formatDateTime(token.expiresAt) }}
                        </template>
                        <template v-else>No expiry</template>
                        · used {{ formatRelativeTime(token.lastUsedAt) }}
                      </span>
                    </div>
                    <DgButton
                      size="sm"
                      variant="ghost"
                      @click="askRevoke(token)">
                      Revoke
                    </DgButton>
                  </li>
                </ul>
              </div>
            </SectionCard>

            <SectionCard
              title="Agents"
              description="Agents this user owns. They stop when the user is turned off.">
              <div class="border-t border-line-soft">
                <DgAlert v-if="agentsError" class="mt-3">{{
                  agentsError
                }}</DgAlert>
                <DgSkeleton v-else-if="!agents" class="mt-3 h-10 w-full" />
                <p
                  v-else-if="agents.length === 0"
                  class="pt-4 text-sm text-ink-muted">
                  No agents.
                </p>
                <ul
                  v-else
                  class="divide-y divide-line-soft"
                  data-testid="user-agents">
                  <li v-for="owned in agents" :key="owned.id">
                    <RouterLink
                      :to="{ name: 'agent', params: { id: owned.id } }"
                      class="group flex items-center gap-3 py-3 text-sm">
                      <span
                        class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                        <span
                          class="truncate font-mono text-ink-strong group-hover:underline">
                          {{ owned.name }}
                        </span>
                        <DgStatus v-if="owned.status === 'active'">On</DgStatus>
                        <DgBadge v-else tone="crit">Turned off</DgBadge>
                      </span>
                      <ChevronRightIcon
                        class="h-4 w-4 shrink-0 text-ink-muted"
                        aria-hidden="true" />
                    </RouterLink>
                  </li>
                </ul>
              </div>
            </SectionCard>

            <SectionCard
              title="Metadata"
              description="The user can read public metadata but not change it, and it goes in their access token. Only admins see private metadata."
              as="form"
              @submit.prevent="saveMetadata">
              <div class="flex flex-col gap-4 border-t border-line-soft py-4">
                <div class="grid gap-4 @xl:grid-cols-2">
                  <DgJsonEditor
                    v-model="publicMetadata"
                    label="Public metadata"
                    hint="1 KB at most. Don't put secrets here."
                    :readonly="!canManage" />
                  <DgJsonEditor
                    v-model="privateMetadata"
                    label="Private metadata"
                    :readonly="!canManage" />
                </div>
                <DgJsonEditor
                  :model-value="userMetadata"
                  label="User metadata"
                  hint="Set by the user through the API. Read-only here."
                  readonly
                  :rows="4" />
                <p
                  v-if="canManage && metadataError && metadataDirty"
                  class="text-sm text-ink-muted">
                  {{ metadataError }}
                </p>
              </div>
              <template v-if="canManage" #footer>
                <SaveFooter
                  label="Save metadata"
                  :dirty="metadataDirty"
                  :saving="busy === 'metadata'"
                  :saved="saved === 'metadata'"
                  :blocked="metadataError !== null"
                  @discard="discardMetadata" />
              </template>
            </SectionCard>
          </div>
        </div>
      </template>
    </div>

    <DgConfirmDialog
      :open="tokenToRevoke !== null"
      :title="`Revoke “${tokenToRevoke?.name ?? ''}”?`"
      description="The token stops signing in right away. Access tokens it already got keep working on backends that verify offline until they expire."
      confirm-label="Revoke"
      tone="danger"
      :loading="revoking"
      :error="revokeError"
      @confirm="revokeToken"
      @close="cancelRevoke" />

    <DgConfirmDialog
      :open="confirming !== null"
      :title="confirmCopy.title"
      :description="confirmCopy.description"
      :confirm-label="confirmCopy.confirmLabel"
      :tone="confirmCopy.tone"
      :confirm-word="confirmCopy.confirmWord"
      :loading="busy !== null"
      :error="confirmError"
      @confirm="confirm"
      @close="cancelConfirm" />
  </DashboardLayout>
</template>
