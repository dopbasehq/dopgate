import { api } from "./api";
import type {
  Admin,
  AdminUser,
  Agent,
  AgentWithToken,
  CapabilityValue,
  PersonalToken,
  AuditEvent,
  AuditVerification,
  EditableSettings,
  Metadata,
  Page,
  Session,
  Settings,
  SigningKey,
  Template,
  TemplateContent,
  TemplateName,
  TemplateSummary,
} from "./types";

/** Admin endpoints. Root-only calls say so. */

const userPath = (id: string) => `/admin/users/${encodeURIComponent(id)}`;
const templatePath = (name: TemplateName) =>
  `/admin/email-templates/${encodeURIComponent(name)}`;

// Users

export interface UserFilters {
  search: string;
  status: "active" | "disabled" | null;
}

export const PAGE_SIZE = 50;

export function listUsers(
  filters: UserFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<Page<AdminUser>> {
  return api("/admin/users", {
    query: {
      search: filters.search.trim(),
      status: filters.status,
      cursor,
      limit: PAGE_SIZE,
    },
    signal,
  });
}

export interface NewUser {
  email: string;
  password?: string;
  displayName?: string;
  emailVerified?: boolean;
}

export function createUser(body: NewUser): Promise<AdminUser> {
  return api("/admin/users", { method: "POST", body });
}

export function fetchUser(
  id: string,
  signal?: AbortSignal,
): Promise<AdminUser> {
  return api(userPath(id), { signal });
}

export interface UserChanges {
  displayName?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  publicMetadata?: Metadata;
  privateMetadata?: Metadata;
}

export function updateUser(id: string, body: UserChanges): Promise<AdminUser> {
  return api(userPath(id), { method: "PATCH", body });
}

export function deleteUser(id: string): Promise<null> {
  return api(userPath(id), { method: "DELETE" });
}

export function disableUser(id: string): Promise<AdminUser> {
  return api(`${userPath(id)}/disable`, { method: "POST" });
}

export function enableUser(id: string): Promise<AdminUser> {
  return api(`${userPath(id)}/enable`, { method: "POST" });
}

/** Emails the user a password reset code. */
export function sendPasswordReset(id: string): Promise<null> {
  return api(`${userPath(id)}/password-reset`, { method: "POST" });
}

export function fetchUserSessions(
  id: string,
  signal?: AbortSignal,
): Promise<Session[]> {
  return api(`${userPath(id)}/sessions`, { signal });
}

export function revokeUserSessions(id: string): Promise<null> {
  return api(`${userPath(id)}/sessions`, { method: "DELETE" });
}

// Admins. Everyone on the admin side can read the list; changes are
// root-only, and root itself can't be changed here.

const adminPath = (id: string) => `/admin/admins/${encodeURIComponent(id)}`;

export function listAdmins(signal?: AbortSignal): Promise<{ items: Admin[] }> {
  return api("/admin/admins", { signal });
}

export interface NewAdmin {
  email: string;
  password?: string;
  displayName?: string;
}

/** Root only. */
export function createAdmin(body: NewAdmin): Promise<Admin> {
  return api("/admin/admins", { method: "POST", body });
}

/** Root only. */
export function disableAdmin(id: string): Promise<Admin> {
  return api(`${adminPath(id)}/disable`, { method: "POST" });
}

/** Root only. */
export function enableAdmin(id: string): Promise<Admin> {
  return api(`${adminPath(id)}/enable`, { method: "POST" });
}

/** Root only. */
export function deleteAdmin(id: string): Promise<null> {
  return api(adminPath(id), { method: "DELETE" });
}

// Personal tokens. Admins list and revoke a user's tokens but never see one.

export function listUserTokens(
  userId: string,
  signal?: AbortSignal,
): Promise<{ items: PersonalToken[] }> {
  return api(`${userPath(userId)}/personal-tokens`, { signal });
}

export function revokeUserToken(
  userId: string,
  tokenId: string,
): Promise<null> {
  return api(
    `${userPath(userId)}/personal-tokens/${encodeURIComponent(tokenId)}`,
    { method: "DELETE" },
  );
}

// Agents. Any admin turns an agent off, on, or deletes it; only the owner
// edits it or regenerates its token.

const agentPath = (id: string) => `/admin/agents/${encodeURIComponent(id)}`;

export interface AgentFilters {
  search: string;
  status: "active" | "disabled" | null;
  /** An admin or user ID. */
  owner: string | null;
}

export function listAgents(
  filters: AgentFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<Page<Agent>> {
  return api("/admin/agents", {
    query: {
      search: filters.search.trim(),
      status: filters.status,
      owner: filters.owner,
      cursor,
      limit: PAGE_SIZE,
    },
    signal,
  });
}

export interface AgentInput {
  name?: string;
  /** Empty string clears it. */
  description?: string;
  capabilities?: Record<string, CapabilityValue>;
}

/** The signed-in admin owns the new agent. */
export function createAgent(body: AgentInput): Promise<AgentWithToken> {
  return api("/admin/agents", { method: "POST", body });
}

export function fetchAgent(id: string, signal?: AbortSignal): Promise<Agent> {
  return api(agentPath(id), { signal });
}

/** Owner only. */
export function updateAgent(id: string, body: AgentInput): Promise<Agent> {
  return api(agentPath(id), { method: "PATCH", body });
}

/** Owner only. */
export function regenerateAgent(id: string): Promise<AgentWithToken> {
  return api(`${agentPath(id)}/regenerate`, { method: "POST" });
}

export function disableAgent(id: string): Promise<Agent> {
  return api(`${agentPath(id)}/disable`, { method: "POST" });
}

export function enableAgent(id: string): Promise<Agent> {
  return api(`${agentPath(id)}/enable`, { method: "POST" });
}

export function deleteAgent(id: string): Promise<null> {
  return api(agentPath(id), { method: "DELETE" });
}

// Signing keys

export function fetchSigningKeys(signal?: AbortSignal): Promise<SigningKey[]> {
  return api("/admin/keys", { signal });
}

/** Root only. */
export function rotateSigningKey(): Promise<SigningKey> {
  return api("/admin/keys/rotate", { method: "POST" });
}

// Settings

export function fetchSettings(signal?: AbortSignal): Promise<Settings> {
  return api("/admin/settings", { signal });
}

export function updateSettings(
  body: Partial<EditableSettings>,
): Promise<Settings> {
  return api("/admin/settings", { method: "PATCH", body });
}

/** Sends a test email; `to` defaults to the caller's own address. */
export function sendSmtpTest(to?: string): Promise<null> {
  return api("/admin/settings/smtp/test", {
    method: "POST",
    body: to ? { to } : {},
  });
}

// Email templates

export function fetchTemplates(
  signal?: AbortSignal,
): Promise<TemplateSummary[]> {
  return api("/admin/email-templates", { signal });
}

export function fetchTemplate(
  name: TemplateName,
  signal?: AbortSignal,
): Promise<Template> {
  return api(templatePath(name), { signal });
}

export function saveTemplate(
  name: TemplateName,
  body: TemplateContent,
): Promise<Template> {
  return api(templatePath(name), { method: "PUT", body });
}

/** Drops the customization; the answer is the built-in template. */
export function resetTemplate(name: TemplateName): Promise<Template> {
  return api(templatePath(name), { method: "DELETE" });
}

export function previewTemplate(
  name: TemplateName,
  body: TemplateContent,
  signal?: AbortSignal,
): Promise<TemplateContent> {
  return api(`${templatePath(name)}/preview`, {
    method: "POST",
    body,
    signal,
  });
}

/** Sends the draft to the caller's own address. */
export function sendTemplateTest(
  name: TemplateName,
  body: TemplateContent,
): Promise<null> {
  return api(`${templatePath(name)}/test`, { method: "POST", body });
}

// Audit log

export interface AuditFilters {
  action: string;
  /** Matches the actor's id or label. */
  actor: string;
}

export function listAuditEvents(
  filters: AuditFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<Page<AuditEvent>> {
  return api("/admin/audit-events", {
    query: {
      action: filters.action.trim(),
      actor: filters.actor.trim(),
      cursor,
      limit: PAGE_SIZE,
    },
    signal,
  });
}

export function verifyAuditChain(): Promise<AuditVerification> {
  return api("/admin/audit-events/verify");
}
