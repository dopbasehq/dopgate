<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgInput,
  DgMenu,
  DgMenuItem,
  DgModal,
  DgSkeleton,
} from "~/components/ui";
import { LockIcon, PlusIcon, TrashIcon } from "~/assets/icons";
import { useAdminsController } from "./Admins.controller";

const {
  rows,
  loadError,
  reload,
  canAdd,
  notice,
  actionError,
  busy,
  createOpen,
  draft,
  createErrors,
  createError,
  creating,
  openCreate,
  closeCreate,
  submitCreate,
  confirm,
  ask,
  closeConfirm,
  confirmAction,
  enable,
} = useAdminsController();

const confirmCopy = computed(() => {
  const pending = confirm.value;
  if (!pending) return { title: "", description: "", label: "" };
  return pending.kind === "disable"
    ? {
        title: `Turn off ${pending.admin.email}?`,
        description:
          "They're signed out of the console now and can't sign in until you turn the account back on.",
        label: "Turn off",
      }
    : {
        title: `Remove ${pending.admin.email}?`,
        description:
          "Their admin account and console sessions are deleted. The audit log keeps what they did.",
        label: "Remove",
      };
});
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Admins"
        subtitle="People who run this Dopgate instance. They sign in here, not to your app.">
        <template v-if="canAdd" #actions>
          <DgButton
            variant="primary"
            data-testid="new-admin"
            @click="openCreate">
            <PlusIcon class="h-4 w-4" />
            Add admin
          </DgButton>
        </template>
      </PageHeader>

      <DgAlert v-if="!canAdd" tone="info">
        Only root can add, turn off, or remove admins.
      </DgAlert>
      <DgAlert v-if="notice" tone="success">{{ notice }}</DgAlert>
      <DgAlert v-if="actionError && !confirm">{{ actionError }}</DgAlert>

      <div v-if="loadError" class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div v-else-if="!rows" class="flex flex-col gap-2">
        <DgSkeleton
          v-for="line in 3"
          :key="line"
          class="h-12 w-full rounded-control" />
      </div>

      <div
        v-else
        class="overflow-x-auto rounded-card border border-line bg-panel">
        <table class="min-w-full text-left text-sm" data-testid="admins-table">
          <thead>
            <tr class="border-b border-line-soft bg-raised/50">
              <th class="h-11 px-4 font-medium text-ink-muted">Email</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Name</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Role</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Status</th>
              <th
                class="h-11 whitespace-nowrap px-4 font-medium text-ink-muted">
                Last sign-in
              </th>
              <th class="h-11 w-12 px-4">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.admin.id"
              class="border-b border-line-soft last:border-b-0"
              data-testid="admin-row">
              <td class="h-[52px] px-4">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="truncate font-mono text-ink-strong">{{
                    row.admin.email
                  }}</span>
                  <span v-if="row.isYou" class="text-xs text-ink-faint"
                    >you</span
                  >
                </div>
              </td>
              <td class="px-4 text-ink">
                <span v-if="row.name">{{ row.name }}</span>
                <span v-else class="text-ink-faint">None</span>
              </td>
              <td class="px-4">
                <DgBadge
                  :tone="row.admin.role === 'root' ? 'accent' : 'neutral'">
                  {{ row.roleLabel }}
                </DgBadge>
              </td>
              <td class="px-4">
                <DgBadge :tone="row.admin.status === 'active' ? 'ok' : 'crit'">
                  {{ row.admin.status === "active" ? "Active" : "Turned off" }}
                </DgBadge>
              </td>
              <td class="whitespace-nowrap px-4 text-ink-muted">
                {{ row.lastSignIn }}
              </td>
              <td class="px-4 text-right">
                <DgMenu
                  v-if="row.canManage"
                  :label="`Actions for ${row.admin.email}`">
                  <template #trigger="{ toggle, attrs }">
                    <DgButton
                      v-bind="attrs"
                      size="sm"
                      variant="ghost"
                      data-testid="admin-actions"
                      @click="toggle">
                      Actions
                    </DgButton>
                  </template>
                  <DgMenuItem
                    v-if="row.admin.status === 'disabled'"
                    :disabled="busy"
                    @select="enable(row.admin)">
                    <template #icon><LockIcon class="h-4 w-4" /></template>
                    Turn back on
                  </DgMenuItem>
                  <DgMenuItem
                    v-else
                    :disabled="busy"
                    @select="ask('disable', row.admin)">
                    <template #icon><LockIcon class="h-4 w-4" /></template>
                    Turn off
                  </DgMenuItem>
                  <div class="my-0.5 h-px bg-line-soft" role="separator" />
                  <DgMenuItem tone="danger" @select="ask('delete', row.admin)">
                    <template #icon><TrashIcon class="h-4 w-4" /></template>
                    Remove admin
                  </DgMenuItem>
                </DgMenu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <DgModal :open="createOpen" title="Add admin" @close="closeCreate">
      <form
        id="new-admin-form"
        class="flex flex-col gap-3"
        novalidate
        @submit.prevent="submitCreate">
        <DgInput
          v-model="draft.email"
          label="Email"
          type="email"
          autocomplete="off"
          required
          autofocus
          :error="createErrors.email" />
        <DgInput
          v-model="draft.displayName"
          label="Display name"
          autocomplete="off" />
        <DgInput
          v-model="draft.password"
          label="Password"
          type="password"
          autocomplete="new-password"
          placeholder="Optional"
          hint="Leave empty to have them sign in with an email code."
          :error="createErrors.password" />
        <DgAlert v-if="createError">{{ createError }}</DgAlert>
      </form>
      <template #footer>
        <DgButton variant="ghost" :disabled="creating" @click="closeCreate">
          Cancel
        </DgButton>
        <DgButton
          type="submit"
          form="new-admin-form"
          variant="primary"
          :loading="creating">
          Add admin
        </DgButton>
      </template>
    </DgModal>

    <DgConfirmDialog
      :open="confirm !== null"
      :title="confirmCopy.title"
      :description="confirmCopy.description"
      :confirm-label="confirmCopy.label"
      tone="danger"
      :loading="busy"
      :error="actionError"
      @confirm="confirmAction"
      @close="closeConfirm" />
  </DashboardLayout>
</template>
