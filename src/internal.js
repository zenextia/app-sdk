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
