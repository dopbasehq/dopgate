<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgCopyButton,
  DgInput,
  DgJsonEditor,
  DgMenu,
  DgMenuItem,
  DgSkeleton,
} from "~/components/ui";
import {
  CheckIcon,
  KeyIcon,
  LockIcon,
  LogOutIcon,
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
  saveProfile,
  saveMetadata,
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

const card = "rounded-card border border-line bg-panel";
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
          <template #meta>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <DgBadge :tone="user.status === 'active' ? 'ok' : 'crit'">
                {{ user.status === "active" ? "Active" : "Disabled" }}
              </DgBadge>
              <DgBadge :tone="user.emailVerified ? 'ok' : 'warn'">
                {{
                  user.emailVerified ? "Email verified" : "Email not verified"
                }}
              </DgBadge>
              <DgBadge v-if="!user.hasPassword">No password</DgBadge>
              <DgBadge v-if="locked" tone="warn">
                Locked until {{ formatDateTime(user.lockedUntil) }}
              </DgBadge>
            </div>
          </template>
          <template v-if="canManage" #actions>
            <DgMenu label="User actions">
              <template #trigger="{ toggle, attrs }">
                <DgButton
                  v-bind="attrs"
                  data-testid="user-actions"
                  @click="toggle">
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

        <div class="grid gap-5 lg:grid-cols-2">
          <section :class="card" aria-labelledby="profile-heading">
            <header class="border-b border-line-soft px-5 py-3.5">
              <h2 id="profile-heading" class="text-[15px]">Profile</h2>
            </header>
            <div class="flex flex-col gap-4 px-5 py-4">
              <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt class="text-ink-muted">User ID</dt>
                <dd class="flex min-w-0 items-center gap-1">
                  <span class="truncate font-mono text-ink">{{ user.id }}</span>
                  <DgCopyButton
                    :value="user.id"
                    label="Copy user ID"
                    icon-only />
                </dd>
                <dt class="text-ink-muted">Created</dt>
                <dd class="text-ink">{{ formatDateTime(user.createdAt) }}</dd>
                <dt class="text-ink-muted">Last sign-in</dt>
                <dd class="text-ink">
                  {{ formatDateTime(user.lastSignInAt) }}
                </dd>
              </dl>
              <form
                v-if="canManage"
                class="flex flex-col gap-3"
                novalidate
                @submit.prevent="saveProfile">
                <DgInput v-model="displayName" label="Display name" />
                <div class="flex justify-end">
                  <DgButton
                    type="submit"
                    variant="primary"
                    :disabled="!profileDirty"
                    :loading="busy === 'profile'">
                    Save
                  </DgButton>
                </div>
              </form>
            </div>
          </section>

          <section :class="card" aria-labelledby="sessions-heading">
            <header
              class="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
              <h2 id="sessions-heading" class="text-[15px]">Sessions</h2>
              <DgButton
                v-if="canManage && sessions && sessions.length > 0"
                size="sm"
                data-testid="sign-out-everywhere"
                @click="ask('sign-out-all')">
                <LogOutIcon class="h-3.5 w-3.5" />
                Sign out everywhere
              </DgButton>
            </header>
            <div class="px-5 py-2">
              <DgAlert v-if="sessionsError" class="my-2">{{
                sessionsError
              }}</DgAlert>
              <DgSkeleton
                v-else-if="!sessions"
                class="my-2 h-10 rounded-control" />
              <p
                v-else-if="sessions.length === 0"
                class="py-3 text-sm text-ink-muted">
                No active sessions.
              </p>
              <ul v-else class="divide-y divide-line-soft">
                <li
                  v-for="session in sessions"
                  :key="session.id"
                  class="flex flex-col gap-0.5 py-2.5 text-sm">
                  <span
                    class="text-ink-strong"
                    :title="session.userAgent ?? undefined">
                    {{ describeUserAgent(session.userAgent) }}
                  </span>
                  <span class="text-ink-muted">
                    {{ formatSignInMethod(session.method) }}
                    <template v-if="session.ipAddress">
                      · <span class="font-mono">{{ session.ipAddress }}</span>
                    </template>
                    · active {{ formatRelativeTime(session.lastUsedAt) }}
                  </span>
                </li>
              </ul>
            </div>
          </section>
        </div>

        <div class="grid gap-5 lg:grid-cols-2">
          <section :class="card" aria-labelledby="tokens-heading">
            <header class="border-b border-line-soft px-5 py-3.5">
              <h2 id="tokens-heading" class="text-[15px]">Personal tokens</h2>
              <p class="mt-0.5 text-sm text-ink-muted">
                Tokens this user made to sign in as themselves. You never see
                the tokens, but you can revoke them.
              </p>
            </header>
            <div class="px-5 py-4">
              <DgAlert v-if="tokensError">{{ tokensError }}</DgAlert>
              <DgSkeleton v-else-if="!tokens" class="h-10 w-full" />
              <p v-else-if="tokens.length === 0" class="text-sm text-ink-muted">
                No personal tokens.
              </p>
              <ul
                v-else
                class="divide-y divide-line-soft"
                data-testid="user-tokens">
                <li
                  v-for="token in tokens"
                  :key="token.id"
                  class="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <span class="truncate text-ink-strong">
                      {{ token.name }}
                      <span class="font-mono text-ink-muted"
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
                  <DgButton size="sm" variant="ghost" @click="askRevoke(token)">
                    Revoke
                  </DgButton>
                </li>
              </ul>
            </div>
          </section>

          <section :class="card" aria-labelledby="agents-heading">
            <header class="border-b border-line-soft px-5 py-3.5">
              <h2 id="agents-heading" class="text-[15px]">Agents</h2>
              <p class="mt-0.5 text-sm text-ink-muted">
                Agents this user owns. They stop when the user is turned off.
              </p>
            </header>
            <div class="px-5 py-4">
              <DgAlert v-if="agentsError">{{ agentsError }}</DgAlert>
              <DgSkeleton v-else-if="!agents" class="h-10 w-full" />
              <p v-else-if="agents.length === 0" class="text-sm text-ink-muted">
                No agents.
              </p>
              <ul
                v-else
                class="divide-y divide-line-soft"
                data-testid="user-agents">
                <li
                  v-for="owned in agents"
                  :key="owned.id"
                  class="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <RouterLink
                    :to="{ name: 'agent', params: { id: owned.id } }"
                    class="truncate font-mono text-ink-strong hover:underline">
                    {{ owned.name }}
                  </RouterLink>
                  <DgBadge :tone="owned.status === 'active' ? 'ok' : 'crit'">
                    {{ owned.status === "active" ? "On" : "Turned off" }}
                  </DgBadge>
                </li>
              </ul>
            </div>
          </section>
        </div>

        <section :class="card" aria-labelledby="metadata-heading">
          <header class="border-b border-line-soft px-5 py-3.5">
            <h2 id="metadata-heading" class="text-[15px]">Metadata</h2>
            <p class="mt-0.5 text-sm text-ink-muted">
              The user can read public metadata but not change it. Only admins
              see private metadata.
            </p>
          </header>
          <form
            class="flex flex-col gap-4 px-5 py-4"
            novalidate
            @submit.prevent="saveMetadata">
            <div class="grid gap-4 lg:grid-cols-2">
              <DgJsonEditor
                v-model="publicMetadata"
                label="Public metadata"
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
            <div v-if="canManage" class="flex items-center justify-end gap-3">
              <span
                v-if="metadataError && metadataDirty"
                class="text-sm text-ink-muted">
                {{ metadataError }}
              </span>
              <DgButton
                type="submit"
                variant="primary"
                :disabled="!metadataDirty || metadataError !== null"
                :loading="busy === 'metadata'">
                Save metadata
              </DgButton>
            </div>
          </form>
        </section>
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
