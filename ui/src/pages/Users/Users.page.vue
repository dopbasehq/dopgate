<script setup lang="ts">
import { DashboardLayout } from "~/layouts";
import PageHeader from "~/components/app/PageHeader.vue";
import PersonCell from "~/components/app/PersonCell.vue";
import {
  DgAlert,
  DgBadge,
  DgButton,
  DgFilterMenu,
  DgInput,
  DgModal,
  DgSearchField,
  DgSkeleton,
  DgStatus,
  DgSwitch,
} from "~/components/ui";
import { ChevronRightIcon, PlusIcon } from "~/assets/icons";
import { STATUS_FILTERS, useUsersController } from "./Users.controller";

const {
  search,
  statusFilter,
  filtered,
  rows,
  openUser,
  loading,
  loadError,
  hasMore,
  loadingMore,
  reload,
  loadMore,
  createOpen,
  draft,
  createErrors,
  createError,
  creating,
  openCreate,
  closeCreate,
  submitCreate,
} = useUsersController();
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
        <!-- Table from 640px -->
        <div
          class="hidden overflow-x-auto rounded-card border border-line bg-panel sm:block">
          <table class="min-w-full text-left text-sm" data-testid="users-table">
            <thead>
              <tr class="border-b border-line-soft bg-raised/50">
                <th class="h-11 px-4 font-medium text-ink-muted">Person</th>
                <th class="h-11 px-4 font-medium text-ink-muted">Status</th>
                <th
                  class="hidden h-11 px-4 font-medium text-ink-muted lg:table-cell">
                  Created
                </th>
                <th
                  class="h-11 whitespace-nowrap px-4 font-medium text-ink-muted">
                  Last sign-in
                </th>
                <th class="h-11 w-10 px-2">
                  <span class="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.user.id"
                class="cursor-pointer border-b border-line-soft last:border-b-0 hover:bg-raised/40 focus-visible:bg-raised/40 focus-visible:outline-none"
                tabindex="0"
                data-testid="user-row"
                @click="openUser(row)"
                @keydown.enter.self="openUser(row)">
                <td class="h-[52px] w-full max-w-0 px-4 py-2">
                  <RouterLink
                    :to="{ name: 'user', params: { id: row.user.id } }"
                    class="block min-w-0 hover:underline"
                    @click.stop>
                    <PersonCell
                      :email="row.user.email"
                      :name="row.name"
                      :muted="!row.active">
                      <DgBadge
                        v-if="!row.user.emailVerified"
                        tone="warn"
                        title="Email not verified">
                        unverified
                      </DgBadge>
                    </PersonCell>
                  </RouterLink>
                </td>
                <td class="whitespace-nowrap px-4">
                  <DgStatus v-if="row.active">Active</DgStatus>
                  <DgBadge v-else tone="crit">Turned off</DgBadge>
                </td>
                <td
                  class="hidden whitespace-nowrap px-4 text-ink-muted lg:table-cell">
                  {{ row.created }}
                </td>
                <td class="whitespace-nowrap px-4 text-ink-muted">
                  {{ row.lastSignIn }}
                </td>
                <td class="px-2 text-right">
                  <ChevronRightIcon
                    class="inline h-4 w-4 text-ink-muted"
                    aria-hidden="true" />
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

        <!-- Cards below 640px -->
        <ul
          class="flex flex-col divide-y divide-line-soft rounded-card border border-line bg-panel sm:hidden"
          data-testid="users-cards">
          <li v-for="row in rows" :key="row.user.id">
            <RouterLink
              :to="{ name: 'user', params: { id: row.user.id } }"
              class="flex items-center gap-3 p-3 hover:bg-raised/40">
              <span class="flex min-w-0 flex-1 flex-col gap-2">
                <PersonCell
                  :email="row.user.email"
                  :name="row.name"
                  :muted="!row.active" />
                <span
                  class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[38px] text-sm">
                  <DgStatus v-if="row.active">Active</DgStatus>
                  <DgBadge v-else tone="crit">Turned off</DgBadge>
                  <DgBadge
                    v-if="!row.user.emailVerified"
                    tone="warn"
                    title="Email not verified">
                    unverified
                  </DgBadge>
                  <span class="text-ink-muted">{{ row.lastSignIn }}</span>
                </span>
              </span>
              <ChevronRightIcon
                class="h-4 w-4 shrink-0 text-ink-muted"
                aria-hidden="true" />
            </RouterLink>
          </li>
          <li
            v-if="rows.length === 0"
            class="px-4 py-8 text-center text-sm text-ink-muted">
            {{ filtered ? "No users match these filters." : "No users yet." }}
          </li>
        </ul>

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
