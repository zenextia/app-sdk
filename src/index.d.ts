export type AppPermission =
  | "identity.read" | "data.read" | "data.write"
  | "device.microphone" | "device.camera" | "device.screen" | "clipboard.write";
export type EntityFieldType = "string" | "text" | "number" | "integer" | "boolean" | "date" | "enum";
export interface EntityField {
  name: string; label: string; type: EntityFieldType;
  required?: boolean; enumValues?: readonly string[];
}
export interface AppManifest {
  schemaVersion: 1; sdkMajor: 1; id: string; version: string;
  name: string; description: string; author: string;
  entrypoint?: string; icon?: string | null;
  permissions?: readonly AppPermission[];
  entities?: readonly { entityType: string; label: string; fields: readonly EntityField[] }[];
  /** Exact https origins the administrator approves (ADR 0093). */
  externalOrigins?: readonly string[];
}
export interface AppIdentity {
  member: { id: number; name: string | null };
  workspace: { id: number; name: string | null };
  installation: { id: string; version: string };
}
/** A five-minute proof of the member for one approved back-end (ADR 0094). */
export interface IdentityToken {
  token: string; tokenType: "ZenextiaIdentity"; audience: string; expiresIn: number;
}
/** What Zenextia vouches for when a back-end checks an identity token. */
export interface VerifiedIdentity {
  active: true; audience: string; expiresAt: string;
  installationId: string; versionId: string; preview: boolean; appOrigin: string;
  member: { id: number; name: string | null };
  workspace: { id: number; name: string | null };
}
export interface DataRecord<T extends object = Record<string, unknown>> {
  id: string; data: T; revision: number; schemaVersionId: string;
  createdAt: string; updatedAt: string;
}
export interface DataPage<T extends object = Record<string, unknown>> {
  items: DataRecord<T>[]; nextCursor: string | null;
}
export interface EntityClient<T extends object> {
  list(options?: { after?: string | null; pageSize?: number }): Promise<DataPage<T>>;
  get(id: string): Promise<DataRecord<T>>;
  create(data: T): Promise<DataRecord<T>>;
  replace(id: string, data: T, expectedRevision: number): Promise<DataRecord<T>>;
  delete(id: string, expectedRevision: number): Promise<void>;
}
export interface AppClient {
  readonly mode: "live" | "simulation";
  readonly identity: {
    get(): Promise<AppIdentity>;
    /** Needs identity.read; `audience` is one of the approved externalOrigins. */
    token(audience: string): Promise<IdentityToken>;
  };
  readonly data: { entity<T extends object = Record<string, unknown>>(name: string): EntityClient<T> };
  readonly session: { revoke(): Promise<void> };
}
export class ZenextiaAppError extends Error {
  readonly code: string; readonly status: number; readonly requestId: string | null;
  constructor(code: string, message: string, status?: number, requestId?: string | null);
}
export function createAppClient(options: {
  apiOrigin: string; installationId: string;
  accessToken: string | (() => string | Promise<string>); fetch?: typeof globalThis.fetch;
}): AppClient;
export function connectToPortal(): Promise<AppClient>;
/** On the author's back-end: has Zenextia check an identity token; null when it is not valid. */
export function verifyIdentityToken(options: {
  apiOrigin: string; installationId: string; audience: string; token: string;
  fetch?: typeof globalThis.fetch;
}): Promise<VerifiedIdentity | null>;
export function createSimulatedApp(options: {
  manifest: AppManifest; installationId?: string;
  member?: AppIdentity["member"]; workspace?: AppIdentity["workspace"];
}): AppClient;
