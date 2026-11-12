import { defineInfiniteQueryOptions, defineQueryOptions } from "@pinia/colada";
import {
  fetchSettings,
  fetchSigningKeys,
  fetchTemplate,
  fetchTemplates,
  fetchUser,
  fetchAgent,
  fetchUserSessions,
  listAdmins,
  listAgents,
  listUserTokens,
  type AgentFilters,
  listAuditEvents,
  listUsers,
  type AuditFilters,
  type UserFilters,
} from "~/services/admin.api";
import type {
  AdminUser,
  Agent,
  AuditEvent,
  Page,
  TemplateName,
} from "~/services/types";
import { keys } from "./keys";

/** Users matching the filters, a page at a time. */
export const usersQuery = defineInfiniteQueryOptions(
  (filters: UserFilters) => ({
    key: keys.users.list({ ...filters }),
    initialPageParam: null as string | null,
    getNextPageParam: (page: Page<AdminUser> | undefined) =>
      page?.nextCursor ?? null,
    query: ({ signal, pageParam }) => listUsers(filters, pageParam, signal),
    // Refetching on focus would refetch every page already loaded.
    refetchOnWindowFocus: false,
  }),
);

export const userQuery = defineQueryOptions((id: string) => ({
  key: keys.users.one(id),
  query: ({ signal }) => fetchUser(id, signal),
}));

export const userSessionsQuery = defineQueryOptions((id: string) => ({
  key: keys.users.sessions(id),
  query: ({ signal }) => fetchUserSessions(id, signal),
}));

/** A user's personal tokens. */
export const userTokensQuery = defineQueryOptions((id: string) => ({
  key: keys.users.tokens(id),
  query: async ({ signal }) => (await listUserTokens(id, signal)).items,
}));

/** The first page of agents a user owns. */
export const userAgentsQuery = defineQueryOptions((id: string) => ({
  key: keys.agents.list({ owner: id }),
  query: async ({ signal }) =>
    (await listAgents({ search: "", status: null, owner: id }, null, signal))
      .items,
}));

/** Agents matching the filters, a page at a time. */
export const agentsQuery = defineInfiniteQueryOptions(
  (filters: AgentFilters) => ({
    key: keys.agents.list({ ...filters }),
    initialPageParam: null as string | null,
    getNextPageParam: (page: Page<Agent> | undefined) =>
      page?.nextCursor ?? null,
    query: ({ signal, pageParam }) => listAgents(filters, pageParam, signal),
    refetchOnWindowFocus: false,
  }),
);

export const agentQuery = defineQueryOptions((id: string) => ({
  key: keys.agents.one(id),
  query: ({ signal }) => fetchAgent(id, signal),
}));

/** Root and every admin, root first. */
export const adminsQuery = defineQueryOptions({
  key: keys.admins,
  query: async ({ signal }) => (await listAdmins(signal)).items,
});

export const templatesQuery = defineQueryOptions({
  key: keys.templates.list,
  query: ({ signal }) => fetchTemplates(signal),
});

export const templateQuery = defineQueryOptions((name: TemplateName) => ({
  key: keys.templates.one(name),
  query: ({ signal }) => fetchTemplate(name, signal),
  // A refetch on focus would not touch the draft, but there's no need.
  refetchOnWindowFocus: false,
}));

export const settingsQuery = defineQueryOptions({
  key: keys.settings,
  query: ({ signal }) => fetchSettings(signal),
});

export const signingKeysQuery = defineQueryOptions({
  key: keys.signingKeys,
  query: ({ signal }) => fetchSigningKeys(signal),
});

/** The audit log, newest first, a page at a time. */
export const auditEventsQuery = defineInfiniteQueryOptions(
  (filters: AuditFilters) => ({
    key: keys.audit.events({ ...filters }),
    initialPageParam: null as string | null,
    getNextPageParam: (page: Page<AuditEvent> | undefined) =>
      page?.nextCursor ?? null,
    query: ({ signal, pageParam }) =>
      listAuditEvents(filters, pageParam, signal),
    refetchOnWindowFocus: false,
  }),
);
