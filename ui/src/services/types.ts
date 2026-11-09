/** Shapes from the dopgate v1 API. Timestamps are RFC 3339 strings. */

export type Role = "root" | "admin" | "member";
export type UserStatus = "active" | "disabled";
export type Metadata = Record<string, unknown>;

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
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

export interface AuthTokens {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string | null;
  user: User;
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

export type CodePurpose = "login" | "email_verify" | "email_change";

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

export interface SmtpSettings {
  host: string | null;
  port: number;
  username: string | null;
  passwordSet: boolean;
  security: "starttls" | "tls" | "none";
  fromEmail: string | null;
  fromName: string | null;
  source: "server_config" | "log";
}

export interface Settings {
  signup: SignupSettings;
  password: PasswordSettings;
  tokens: TokenSettings;
  limits: LimitSettings;
  smtp: SmtpSettings;
  branding: Branding;
}

/** The parts of the settings an admin can change. */
export type EditableSettings = Omit<Settings, "smtp">;

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
