export type AppPermission = "identity.read" | "data.read" | "data.write";
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
  externalOrigins?: readonly never[];
}
export interface AppIdentity {
  member: { id: number; name: string | null };
  workspace: { id: number; name: string | null };
  installation: { id: string; version: string };
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
  readonly identity: { get(): Promise<AppIdentity> };
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
export function createSimulatedApp(options: {
  manifest: AppManifest; installationId?: string;
  member?: AppIdentity["member"]; workspace?: AppIdentity["workspace"];
}): AppClient;
