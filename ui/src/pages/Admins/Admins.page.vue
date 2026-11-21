<script setup lang="ts">
import { computed } from "vue";
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import PersonCell from "~/components/app/PersonCell.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgConfirmDialog,
  DgInput,
  DgModal,
  DgSkeleton,
  DgStatus,
} from "~/components/ui";
import { PlusIcon } from "~/assets/icons";
import AdminActions from "./AdminActions.vue";
import { useAdminsController, type AdminRow } from "./Admins.controller";

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

const off = (row: AdminRow) => row.admin.status !== "active";

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
        <!-- Table from 640px; Last sign-in shows from 1024px. -->
        <table
          class="hidden min-w-full text-left text-sm sm:table"
          data-testid="admins-table">
          <thead>
            <tr class="border-b border-line-soft bg-raised/50">
              <th class="h-11 w-1/2 px-4 font-medium text-ink-muted">Person</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Role</th>
              <th class="h-11 px-4 font-medium text-ink-muted">Status</th>
              <th
                class="hidden h-11 whitespace-nowrap px-4 font-medium text-ink-muted lg:table-cell">
                Last sign-in
              </th>
              <th class="h-11 w-12 px-2">
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
              <td class="h-[60px] max-w-0 px-4">
                <PersonCell
                  :email="row.admin.email"
                  :name="row.name"
                  :muted="off(row)">
                  <span v-if="row.isYou" class="shrink-0 text-xs text-ink-faint"
                    >you</span
                  >
                </PersonCell>
              </td>
              <td class="px-4">
                <DgBadge
                  :tone="row.admin.role === 'root' ? 'accent' : 'neutral'">
                  {{ row.roleLabel }}
                </DgBadge>
              </td>
              <td class="whitespace-nowrap px-4">
                <DgBadge v-if="off(row)" tone="crit">Turned off</DgBadge>
                <DgStatus v-else>Active</DgStatus>
              </td>
              <td
                class="hidden whitespace-nowrap px-4 text-ink-muted lg:table-cell">
                {{ row.lastSignIn }}
              </td>
              <td class="px-2 text-right">
                <AdminActions
                  v-if="row.canManage"
                  :admin="row.admin"
                  :busy="busy"
                  @enable="enable(row.admin)"
                  @disable="ask('disable', row.admin)"
                  @remove="ask('delete', row.admin)" />
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Cards below 640px -->
        <ul class="divide-y divide-line-soft sm:hidden">
          <li
            v-for="row in rows"
            :key="row.admin.id"
            class="flex items-start gap-2 px-4 py-3"
            data-testid="admin-card">
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <PersonCell
                :email="row.admin.email"
                :name="row.name"
                :muted="off(row)">
                <span v-if="row.isYou" class="shrink-0 text-xs text-ink-faint"
                  >you</span
                >
              </PersonCell>
              <div
                class="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[38px] text-sm">
                <DgBadge
                  :tone="row.admin.role === 'root' ? 'accent' : 'neutral'">
                  {{ row.roleLabel }}
                </DgBadge>
                <DgBadge v-if="off(row)" tone="crit">Turned off</DgBadge>
                <DgStatus v-else>Active</DgStatus>
                <span class="text-ink-muted">{{ row.lastSignIn }}</span>
              </div>
            </div>
            <AdminActions
              v-if="row.canManage"
              :admin="row.admin"
              :busy="busy"
              @enable="enable(row.admin)"
              @disable="ask('disable', row.admin)"
              @remove="ask('delete', row.admin)" />
          </li>
        </ul>
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
