export type AppPermission =
  | "identity.read" | "data.read" | "data.write"
  | "device.microphone" | "device.camera" | "device.screen" | "clipboard.write";
export type EntityFieldType = "string" | "text" | "number" | "integer" | "boolean" | "date" | "enum" | "file";
/** What a record holds for a `file` field (ADR 0101). To write one, `{ fileId }` is enough. */
export interface FileReference { fileId: string; name: string; contentType: string; size: number }
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
  /** Tools the assistant may call for a member, once an administrator approved them (ADR 0100). */
  tools?: readonly AppTool[];
}
export interface AppToolParameter {
  name: string; label: string;
  type: "string" | "text" | "number" | "integer" | "boolean" | "date" | "enum" | "file";
  description?: string; required?: boolean; multiple?: boolean; enumValues?: readonly string[];
}
export interface AppTool {
  name: string; description: string; mode: "read" | "write";
  input?: readonly AppToolParameter[];
  target:
    | { type: "records"; entityType: string; operation: "list" | "get" | "create" | "replace" }
    | { type: "endpoint"; url: string };
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
  /** Present when Zenextia calls a tool's endpoint for the member (ADR 0100). */
  tool?: { name: string; mode: "read" | "write"; callId: string };
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
  /** Files kept by Zenextia for a record's `file` field: 8 MB at most, held by one record. */
  readonly files: {
    /** Needs data.write. The reference goes in a record; an upload no record takes is removed after a day. */
    upload(blob: Blob, options?: { name?: string }): Promise<FileReference>;
    /** Needs data.read. */
    download(fileId: string): Promise<Blob>;
  };
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
  /** On a route that serves a tool: accept only a call Zenextia makes for that tool. */
  tool?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<VerifiedIdentity | null>;
export function createSimulatedApp(options: {
  manifest: AppManifest; installationId?: string;
  member?: AppIdentity["member"]; workspace?: AppIdentity["workspace"];
}): AppClient;
