import { apiBase, externalOrigin, fail, uuid, ZenextiaAppError } from "./internal.js";

const IDENTITY_TOKEN = /^zaf_i_[A-Za-z0-9_-]{16,1400}\.[A-Za-z0-9_-]{43}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,47}$/;

/**
 * ADR 0094, on the author's own back-end: has Zenextia check an identity token
 * the application sent. Resolves to the member, Workspace and version when it
 * is valid for this installation and this back-end's origin, otherwise null.
 *
 * ADR 0100: when Zenextia calls a tool's endpoint for a member, the token is
 * minted for that tool and that call, and the answer carries `tool`. Pass
 * `tool` on a route that serves a tool: any other token then resolves to null.
 * Such a token is accepted once, so check it once per request.
 */
export async function verifyIdentityToken({ apiOrigin, installationId, audience, token, tool, fetch: fetcher = globalThis.fetch }) {
  const base = apiBase(apiOrigin);
  installationId = uuid(installationId);
  audience = externalOrigin(audience);
  if (tool !== undefined && (typeof tool !== "string" || !TOOL_NAME.test(tool))) {
    fail("AI_FACTORY_INPUT_INVALID", "A tool name is the name declared in the manifest.");
  }
  if (typeof fetcher !== "function") fail("AI_FACTORY_INPUT_INVALID", "A fetch implementation is required.");
  // Simulated and malformed tokens never reach Zenextia.
  if (typeof token !== "string" || !IDENTITY_TOKEN.test(token)) return null;
  let response;
  try {
    response = await fetcher(`${base}/ai-factory/runtime/${installationId}/identity/introspect`, {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token, audience }),
    });
  } catch {
    fail("AI_FACTORY_NETWORK_ERROR", "Zenextia could not be reached to check the identity token.", 0);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("AI_FACTORY_RESPONSE_INVALID", "The platform returned an invalid response.", response.status);
  }
  if (!response.ok) {
    throw new ZenextiaAppError(
      payload?.error?.code ?? "AI_FACTORY_REQUEST_FAILED",
      payload?.error?.message ?? "The identity check failed.",
      response.status, payload?.error?.requestId ?? null,
    );
  }
  const verified = payload?.data;
  if (verified?.active !== true) return null;
  if (tool !== undefined && verified.tool?.name !== tool) return null;
  return verified;
}
