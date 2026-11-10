/** Shapes from the Dopgate v1 API. Timestamps are RFC 3339 strings. */

/** An admin's role. Your app's users have none. */
export type Role = "root" | "admin";
export type UserStatus = "active" | "disabled";
export type Metadata = Record<string, unknown>;

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  publicMetadata: Metadata;
  userMetadata: Metadata;
  hasPassword: boolean;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser extends User {
  privateMetadata: Metadata;
  lockedUntil: string | null;
}

/** Root or an admin: the people who sign in to this console. */
export interface Admin {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
  status: UserStatus;
  hasPassword: boolean;
  lockedUntil: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a console sign-in or refresh returns. */
export interface ConsoleTokens {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string | null;
  admin: Admin;
}

/** A user's personal token as lists show it. The token itself is never shown again. */
export interface PersonalToken {
  id: string;
  name: string;
  lastFour: string;
  expiresAt: string | null;
  expired: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** A flat capability value: what an agent's access token carries. */
export type CapabilityValue = string | number | boolean | string[];

export interface AgentOwner {
  id: string;
  kind: "admin" | "user";
  email: string;
}

/** An account for a bot, owned by an admin or a user. */
export interface Agent {
  id: string;
  name: string;
  description: string | null;
  owner: AgentOwner;
  capabilities: Record<string, CapabilityValue>;
  status: UserStatus;
  lastFour: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An agent with its new token, which is shown this once. */
export interface AgentWithToken {
  token: string;
  agent: Agent;
}

export interface Session {
  id: string;
  method: "password" | "otp" | "sso";
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export type CodePurpose = "login" | "email_change";

export interface Branding {
  appName: string;
  logoUrl: string | null;
}

export interface AuthMethods {
  signupEnabled: boolean;
  password: boolean;
  emailOtp: boolean;
  branding: Branding;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SigningKey {
  id: string;
  algorithm: string;
  status: "active" | "retiring" | "retired";
  createdAt: string;
  rotatedAt: string | null;
  retiredAt: string | null;
}

export interface SignupSettings {
  enabled: boolean;
  requireEmailVerification: boolean;
  passwordlessSignup: boolean;
}

export interface PasswordSettings {
  minLength: number;
}

export interface TokenSettings {
  accessTokenMinutes: number;
  refreshTokenIdleDays: number;
  sessionAbsoluteDays: number;
}

export interface LimitSettings {
  codeMinutes: number;
  codeMaxAttempts: number;
  codeResendSeconds: number;
  codesPerHour: number;
  lockoutAttempts: number;
  lockoutMinutes: number;
  ipRequestsPerMinute: number;
}

/** What your app's users may make for themselves. Off by default. */
export interface SelfServiceSettings {
  agents: boolean;
  maxAgentsPerUser: number;
  personalTokens: boolean;
  maxPersonalTokensPerUser: number;
}

export type SmtpSecurity = "starttls" | "tls" | "none";

export interface SmtpSettings {
  host: string | null;
  port: number;
  username: string | null;
  passwordSet: boolean;
  security: SmtpSecurity;
  /** Defaults to no-reply@dopgate.com when nothing sets one. */
  fromEmail: string;
  fromName: string | null;
  /**
   * `server_config`: DOPGATE_SMTP_* sets a host and wins, so it's read-only.
   * `database`: saved here. `log`: no host anywhere, mail goes to the log.
   */
  source: "server_config" | "database" | "log";
  /** False until DOPGATE_SERVICE_KEY is set, which encrypts the password. */
  canStorePassword: boolean;
}

/** SMTP as the API takes it. A left-out password keeps the saved one. */
export interface SmtpSettingsInput {
  host: string | null;
  port: number | null;
  security: SmtpSecurity;
  username: string | null;
  /** Empty string removes the saved password. */
  password?: string;
  fromEmail: string | null;
  fromName: string | null;
}

export interface Settings {
  signup: SignupSettings;
  password: PasswordSettings;
  tokens: TokenSettings;
  limits: LimitSettings;
  selfService: SelfServiceSettings;
  smtp: SmtpSettings;
  branding: Branding;
}

/** The parts of the settings an admin can change, as the API takes them. */
export type EditableSettings = Omit<Settings, "smtp"> & {
  smtp: SmtpSettingsInput;
};

export type TemplateName =
  | "verify_email"
  | "login_code"
  | "password_reset"
  | "email_change"
  | "email_changed"
  | "password_changed";

export interface TemplateSummary {
  name: TemplateName;
  description: string;
  customized: boolean;
  subject: string;
  updatedAt: string | null;
}

export interface TemplateContent {
  subject: string;
  html: string;
  text: string;
}

export interface Template extends TemplateContent {
  name: TemplateName;
  description: string;
  customized: boolean;
  variables: string[];
  updatedAt: string | null;
  defaults: TemplateContent;
}

export interface AuditEvent {
  id: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  metadata: Metadata;
  createdAt: string;
  seq: number | null;
  prevHash: string | null;
  recordHash: string | null;
}

export interface AuditVerification {
  ok: boolean;
  records: number;
  headSeq: number | null;
  headHash: string | null;
  legacy: number;
  unsequenced: number;
  prunedSeq: number | null;
  broken: { seq: number; id: string; reason: string } | null;
  anchor: {
    seq: number;
    status: "matched" | "mismatch" | "missing" | "pruned";
  } | null;
}
