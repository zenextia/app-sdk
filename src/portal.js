import { createAppClient } from "./client.js";
import { fail } from "./internal.js";

/** Connect only through the platform context supplied on the application origin. */
export async function connectToPortal() {
  const bridge = globalThis.__ZENEXTIA_HOST__;
  if (!bridge || bridge.schemaVersion !== 1 || typeof bridge.getAccessToken !== "function" ||
      typeof bridge.disconnect !== "function") {
    fail("AI_FACTORY_BRIDGE_REQUIRED", "Open this application from its Workspace portal.", 401);
  }
  await bridge.getAccessToken();
  const client = createAppClient({ apiOrigin: bridge.apiOrigin, installationId: bridge.installationId,
    accessToken: () => bridge.getAccessToken() });
  return Object.freeze({ ...client, session: Object.freeze({ revoke: async () => {
    try { await client.session.revoke(); } finally { bridge.disconnect(); }
  } }) });
}
