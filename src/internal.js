export class ZenextiaAppError extends Error {
  constructor(code, message, status = 0, requestId = null) {
    super(message);
    this.name = "ZenextiaAppError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export function fail(code, message, status = 422) {
  throw new ZenextiaAppError(code, message, status);
}

export function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    fail("AI_FACTORY_INPUT_INVALID", "Expected a UUID.");
  }
  return value.toLowerCase();
}

export function apiBase(apiOrigin) {
  try {
    const base = new URL(apiOrigin);
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new TypeError();
    return base.origin;
  } catch {
    fail("AI_FACTORY_INPUT_INVALID", "Expected the HTTPS platform API origin.");
  }
}

// ADR 0093: an exact lowercase https origin, with no path, wildcard or default port.
const EXTERNAL_ORIGIN = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9](?::[1-9][0-9]{0,4})?$/;

export function isExternalOrigin(value) {
  if (typeof value !== "string" || value.length > 253 || !EXTERNAL_ORIGIN.test(value)) return false;
  const port = /:(\d+)$/.exec(value)?.[1];
  return port === undefined || (port !== "443" && Number(port) <= 65535);
}

export function externalOrigin(value) {
  if (!isExternalOrigin(value)) fail("AI_FACTORY_INPUT_INVALID", "Expected an exact https origin from externalOrigins.");
  return value;
}

export function entityName(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) {
    fail("AI_FACTORY_INPUT_INVALID", "Expected a declared entity name.");
  }
  return value;
}

export function revision(value) {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
    fail("AI_FACTORY_REVISION_REQUIRED", "Expected a positive record revision.");
  }
  return value;
}

export function pageOptions({ after, pageSize = 25 } = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    fail("AI_FACTORY_PAGE_INVALID", "Page size must be between 1 and 100.");
  }
  return { after: after == null ? null : uuid(after), pageSize };
}

// ADR 0101: one file kept by Zenextia, at most 8 MiB.
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function fileUpload(blob, { name } = {}) {
  if (!(blob instanceof Blob)) fail("AI_FACTORY_FILE_INVALID", "Expected a Blob or a File.");
  if (blob.size < 1) fail("AI_FACTORY_FILE_EMPTY", "A file must not be empty.");
  if (blob.size > MAX_FILE_BYTES) fail("AI_FACTORY_FILE_TOO_LARGE", "A file is at most 8 MB.", 413);
  name = name ?? blob.name ?? "file";
  if (typeof name !== "string" || !name.trim() || name.length > 255) {
    fail("AI_FACTORY_FILE_INVALID", "A file name has 1 to 255 characters.");
  }
  return { blob, name };
}

export function encodeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("AI_FACTORY_ENTITY_INVALID", "Record data must be an object.");
  }
  let text;
  try {
    text = JSON.stringify(data, (_key, value) => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError();
      if (typeof value === "string" && (/\u0000/.test(value) || /[\uD800-\uDFFF]/u.test(value))) throw new TypeError();
      if (["function", "symbol", "bigint"].includes(typeof value)) throw new TypeError();
      return value;
    });
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new TypeError();
  } catch {
    fail("AI_FACTORY_ENTITY_INVALID", "Record data must contain valid JSON values.");
  }
  if (new TextEncoder().encode(text).byteLength > 32768) {
    fail("AI_FACTORY_RECORD_TOO_LARGE", "Record data exceeds 32 KiB.", 413);
  }
  return text;
}

export function entityClient(name, execute) {
  entityName(name);
  return Object.freeze({
    list: async (options) => execute("list", name, pageOptions(options)),
    get: async (id) => execute("get", name, { id: uuid(id) }),
    create: async (data) => execute("create", name, { data: JSON.parse(encodeData(data)) }),
    replace: async (id, data, expectedRevision) => execute("replace", name, {
      id: uuid(id), data: JSON.parse(encodeData(data)), expectedRevision: revision(expectedRevision),
    }),
    delete: async (id, expectedRevision) => execute("delete", name, {
      id: uuid(id), expectedRevision: revision(expectedRevision),
    }),
  });
}
