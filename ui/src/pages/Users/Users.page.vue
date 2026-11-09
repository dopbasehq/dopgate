<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgFilterMenu,
  DgInput,
  DgModal,
  DgSearchField,
  DgSelect,
  DgSkeleton,
  DgSwitch,
} from "~/components/ui";
import { PlusIcon } from "~/assets/icons";
import {
  ROLE_FILTERS,
  STATUS_FILTERS,
  useUsersController,
} from "./Users.controller";

const {
  search,
  roleFilter,
  statusFilter,
  filtered,
  rows,
  loading,
  loadError,
  hasMore,
  loadingMore,
  reload,
  loadMore,
  canChooseRole,
  createOpen,
  draft,
  createErrors,
  createError,
  creating,
  openCreate,
  closeCreate,
  submitCreate,
} = useUsersController();

const roleOptions = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];
</script>

<template>
  <DashboardLayout>
    <div class="page-width flex flex-col gap-5 py-6 lg:py-8">
      <PageHeader
        title="Users"
        subtitle="Everyone who can sign in to your app.">
        <template #actions>
          <DgButton
            variant="primary"
            data-testid="new-user"
            @click="openCreate">
            <PlusIcon class="h-4 w-4" />
            New user
          </DgButton>
        </template>
      </PageHeader>

      <div class="flex flex-wrap items-center gap-2">
        <DgSearchField
          v-model="search"
          class="w-full sm:w-72"
          placeholder="Search by email or name" />
        <DgFilterMenu
          v-model="roleFilter"
          label="Role"
          :options="ROLE_FILTERS" />
        <DgFilterMenu
          v-model="statusFilter"
          label="Status"
          :options="STATUS_FILTERS" />
      </div>

      <div
        v-if="loadError && rows.length === 0"
        class="flex flex-col items-start gap-3">
        <DgAlert>{{ loadError }}</DgAlert>
        <DgButton size="sm" @click="reload">Try again</DgButton>
      </div>

      <div v-else-if="loading" class="flex flex-col gap-2">
        <DgSkeleton
          v-for="line in 5"
          :key="line"
          class="h-12 w-full rounded-control" />
      </div>

      <template v-else>
        <div class="overflow-x-auto rounded-card border border-line bg-panel">
          <table class="min-w-full text-left text-sm" data-testid="users-table">
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
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.user.id"
                class="border-b border-line-soft last:border-b-0 hover:bg-raised/40"
                data-testid="user-row">
                <td class="h-[52px] px-4">
                  <div class="flex min-w-0 items-center gap-2">
                    <RouterLink
                      :to="{ name: 'user', params: { id: row.user.id } }"
                      class="truncate font-mono text-ink-strong hover:underline">
                      {{ row.user.email }}
                    </RouterLink>
                    <span v-if="row.isYou" class="text-xs text-ink-faint"
                      >you</span
                    >
                    <DgBadge
                      v-if="!row.user.emailVerified"
                      tone="warn"
                      title="Email not verified">
                      unverified
                    </DgBadge>
                  </div>
                </td>
                <td class="px-4 text-ink">
                  <span v-if="row.name">{{ row.name }}</span>
                  <span v-else class="text-ink-faint">None</span>
                </td>
                <td class="px-4">
                  <DgBadge
                    :tone="row.user.role === 'root' ? 'accent' : 'neutral'">
                    {{ row.roleLabel }}
                  </DgBadge>
                </td>
                <td class="px-4">
                  <DgBadge :tone="row.user.status === 'active' ? 'ok' : 'crit'">
                    {{ row.user.status === "active" ? "Active" : "Disabled" }}
                  </DgBadge>
                </td>
                <td class="whitespace-nowrap px-4 text-ink-muted">
                  {{ row.lastSignIn }}
                </td>
              </tr>
            </tbody>
          </table>
          <p
            v-if="rows.length === 0"
            class="px-4 py-8 text-center text-sm text-ink-muted"
            data-testid="users-empty">
            {{ filtered ? "No users match these filters." : "No users yet." }}
          </p>
        </div>

        <DgAlert v-if="loadError">{{ loadError }}</DgAlert>
        <div v-if="hasMore" class="flex justify-center">
          <DgButton
            :loading="loadingMore"
            data-testid="load-more"
            @click="loadMore">
            Load more
          </DgButton>
        </div>
      </template>
    </div>

    <DgModal :open="createOpen" title="New user" @close="closeCreate">
      <form
        id="new-user-form"
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
          hint="Leave empty to have them sign in with an email code or reset it later."
          :error="createErrors.password" />
        <DgSelect
          v-if="canChooseRole"
          v-model="draft.role"
          label="Role"
          :options="roleOptions" />
        <DgSwitch
          v-model="draft.emailVerified"
          label="Mark email as verified" />
        <DgAlert v-if="createError">{{ createError }}</DgAlert>
      </form>
      <template #footer>
        <DgButton variant="ghost" :disabled="creating" @click="closeCreate">
          Cancel
        </DgButton>
        <DgButton
          type="submit"
          form="new-user-form"
          variant="primary"
          :loading="creating">
          Create user
        </DgButton>
      </template>
    </DgModal>
  </DashboardLayout>
</template>
