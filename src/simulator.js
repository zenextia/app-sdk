import { entityClient, fail, uuid } from "./internal.js";

const TYPES = new Set(["string", "text", "date", "number", "integer", "boolean", "enum"]);
// Device permissions (ADR 0093) are delegated by the portal; the simulator only accepts their declaration.
const EXTERNAL_ORIGIN = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9](?::[1-9][0-9]{0,4})?$/;
const PERMISSIONS = new Set(["identity.read", "data.read", "data.write", "device.microphone", "device.camera", "device.screen", "clipboard.write"]);
const MANIFEST_KEYS = new Set(["schemaVersion", "sdkMajor", "id", "version", "name", "description", "author", "entrypoint", "icon", "permissions", "entities", "externalOrigins"]);

export function createSimulatedApp({ manifest, member = { id: 0, name: "Local member" }, workspace = { id: 0, name: "Local simulation" }, installationId = crypto.randomUUID() }) {
  installationId = uuid(installationId);
  if (!manifest || manifest.schemaVersion !== 1 || manifest.sdkMajor !== 1) {
    fail("MANIFEST_INVALID", "Simulation requires manifest and SDK major 1.");
  }
  // Freeze the local data contract against subsequent edits of the caller's object.
  manifest = structuredClone(manifest);
  if (Object.keys(manifest).some((key) => !MANIFEST_KEYS.has(key)) ||
      (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) ||
      (manifest.entities !== undefined && !Array.isArray(manifest.entities)) ||
      (manifest.externalOrigins !== undefined && !Array.isArray(manifest.externalOrigins))) {
    fail("MANIFEST_INVALID", "Expected the closed static manifest profile.");
  }
  const permissions = new Set(manifest.permissions ?? []);
  if (permissions.size !== (manifest.permissions?.length ?? 0) ||
      [...permissions].some((permission) => !PERMISSIONS.has(permission))) {
    fail("MANIFEST_INVALID", "The static profile supports only identity and entity data.");
  }
  // ADR 0093: exact https origins an administrator approves. The simulator
  // checks their shape only; it never contacts them on the application's behalf.
  const origins = manifest.externalOrigins ?? [];
  if (origins.length > 10 || new Set(origins).size !== origins.length ||
      origins.some((origin) => typeof origin !== "string" || !EXTERNAL_ORIGIN.test(origin) || origin.endsWith(":443"))) {
    fail("MANIFEST_INVALID", "External origins are exact lowercase https://host[:port] values.");
  }
  const entities = new Map();
  if ((manifest.entities?.length ?? 0) > 32 || Boolean(manifest.entities?.length) !==
      (permissions.has("data.read") || permissions.has("data.write"))) {
    fail("MANIFEST_INVALID", "Entity declarations and data permissions require each other.");
  }
  for (const entity of manifest.entities ?? []) {
    if (entities.has(entity.entityType) || !Array.isArray(entity.fields) || !entity.fields.length || entity.fields.length > 100) {
      fail("MANIFEST_INVALID", "Entity names must be unique and fields declared.");
    }
    const fields = new Map();
    for (const field of entity.fields) {
      if (fields.has(field.name) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.name) || !TYPES.has(field.type) ||
          (field.required !== undefined && typeof field.required !== "boolean") ||
          (field.enumValues !== undefined && !Array.isArray(field.enumValues)) ||
          (field.type !== "enum" && field.enumValues?.length) ||
          (field.type === "enum" && (!field.enumValues?.length || field.enumValues.length > 100 ||
            new Set(field.enumValues).size !== field.enumValues.length || field.enumValues.some((value) => typeof value !== "string" || !value.trim() || value.length > 160)))) {
        fail("MANIFEST_INVALID", "Entity fields require unique names and supported types.");
      }
      fields.set(field.name, field);
    }
    entities.set(entity.entityType, { fields, records: new Map() });
  }
  let closed = false;
  function requirePermission(permission) {
    if (closed) fail("AI_FACTORY_SESSION_INVALID", "The simulated session was revoked.", 401);
    if (!permissions.has(permission)) fail("AI_FACTORY_PERMISSION_DENIED", "The manifest does not request this permission.", 403);
  }

  function validate(entity, data) {
    for (const name of Object.keys(data)) {
      const field = entity.fields.get(name);
      const value = data[name];
      if (!field) fail("AI_FACTORY_ENTITY_INVALID", "The record contains an undeclared field.");
      let valid;
      if (field.type === "number") valid = typeof value === "number" && Number.isFinite(value);
      else if (field.type === "integer") valid = Number.isInteger(value);
      else if (field.type === "boolean") valid = typeof value === "boolean";
      else valid = typeof value === "string";
      if (!valid || (field.type === "enum" && !field.enumValues.includes(value))) {
        fail("AI_FACTORY_ENTITY_INVALID", "Record data does not match its declared types.");
      }
    }
    for (const [name, field] of entity.fields) {
      if (field.required && (!Object.hasOwn(data, name) || data[name] === "")) {
        fail("AI_FACTORY_ENTITY_INVALID", "A required record field is missing.");
      }
    }
  }

  async function execute(operation, name, values) {
    requirePermission(["get", "list"].includes(operation) ? "data.read" : "data.write");
    const entity = entities.get(name);
    if (!entity) fail("AI_FACTORY_ENTITY_NOT_FOUND", "The manifest does not declare that entity.", 404);
    if (operation === "list") {
      const records = [...entity.records.values()].filter((record) => !values.after || record.id > values.after)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const page = records.slice(0, values.pageSize);
      return structuredClone({ items: page, nextCursor: records.length > values.pageSize ? page.at(-1).id : null });
    }
    if (operation === "create") {
      validate(entity, values.data);
      const now = new Date().toISOString();
      const record = { id: crypto.randomUUID(), data: values.data, revision: 1,
        schemaVersionId: "00000000-0000-0000-0000-000000000000", createdAt: now, updatedAt: now };
      entity.records.set(record.id, record);
      return structuredClone(record);
    }
    const record = entity.records.get(values.id);
    if (!record) fail("AI_FACTORY_RECORD_NOT_FOUND", "The record was not found.", 404);
    if (operation === "get") return structuredClone(record);
    if (record.revision !== values.expectedRevision) fail("AI_FACTORY_RECORD_CONFLICT", "Read the record again before changing it.", 409);
    if (operation === "delete") { entity.records.delete(values.id); return undefined; }
    validate(entity, values.data);
    const updated = { ...record, data: values.data, revision: record.revision + 1, updatedAt: new Date().toISOString() };
    entity.records.set(record.id, updated);
    return structuredClone(updated);
  }

  return Object.freeze({
    mode: "simulation",
    identity: Object.freeze({ get: async () => {
      requirePermission("identity.read");
      return structuredClone({ member, workspace, installation: { id: installationId, version: manifest.version } });
    } }),
    data: Object.freeze({ entity: (name) => entityClient(name, execute) }),
    session: Object.freeze({ revoke: async () => { closed = true; } }),
  });
}
