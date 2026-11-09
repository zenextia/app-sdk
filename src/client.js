import { apiBase, entityClient, externalOrigin, fail, uuid, ZenextiaAppError } from "./internal.js";

export function createAppClient({ apiOrigin, installationId, accessToken, fetch: fetcher = globalThis.fetch }) {
  installationId = uuid(installationId);
  const base = apiBase(apiOrigin);
  if (typeof fetcher !== "function" || !["string", "function"].includes(typeof accessToken)) {
    fail("AI_FACTORY_INPUT_INVALID", "A fetch implementation and application access token are required.");
  }
  const root = `${base}/ai-factory/runtime/${installationId}`;
  let closed = false;

  async function request(path, method = "GET", body) {
    if (closed) fail("AI_FACTORY_SESSION_INVALID", "The application session was revoked.", 401);
    const token = typeof accessToken === "function" ? await accessToken() : accessToken;
    if (typeof token !== "string" || !/^zaf_s_[A-Za-z0-9_-]{43}$/.test(token)) {
      fail("AI_FACTORY_SESSION_INVALID", "An application session token is required.", 401);
    }
    let response;
    try {
      response = await fetcher(root + path, {
        method, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      // A network failure can happen after a write committed. Never retry it.
      fail("AI_FACTORY_NETWORK_ERROR", "The application request did not complete.", 0);
    }
    if (response.status === 204) return undefined;
    let payload;
    try {
      payload = await response.json();
    } catch {
      fail("AI_FACTORY_RESPONSE_INVALID", "The platform returned an invalid response.", response.status);
    }
    if (!response.ok) {
      throw new ZenextiaAppError(
        payload?.error?.code ?? "AI_FACTORY_REQUEST_FAILED",
        payload?.error?.message ?? "The application request failed.",
        response.status, payload?.error?.requestId ?? null,
      );
    }
    if (!payload || !Object.hasOwn(payload, "data")) {
      fail("AI_FACTORY_RESPONSE_INVALID", "The platform response has no data envelope.", response.status);
    }
    return payload.data;
  }

  function execute(operation, entity, values) {
    const path = `/entities/${entity}`;
    if (operation === "list") {
      const query = new URLSearchParams({ pageSize: String(values.pageSize) });
      if (values.after) query.set("after", values.after);
      return request(`${path}?${query}`);
    }
    if (operation === "get") return request(`${path}/${values.id}`);
    if (operation === "create") return request(path, "POST", { data: values.data });
    if (operation === "replace") return request(`${path}/${values.id}`, "PUT", {
      data: values.data, expectedRevision: values.expectedRevision,
    });
    return request(`${path}/${values.id}?expectedRevision=${values.expectedRevision}`, "DELETE");
  }

  return Object.freeze({
    mode: "live",
    identity: Object.freeze({
      get: () => request("/identity"),
      // ADR 0094: a five-minute proof of the member for one approved back-end.
      token: async (audience) => request("/identity/token", "POST", { audience: externalOrigin(audience) }),
    }),
    data: Object.freeze({ entity: (name) => entityClient(name, execute) }),
    session: Object.freeze({ revoke: async () => { await request("/session", "DELETE"); closed = true; } }),
  });
}
