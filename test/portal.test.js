import assert from "node:assert/strict";
import test from "node:test";
import { connectToPortal } from "@zenextia/app-sdk";

const installation = "00000000-0000-0000-0000-000000000001";
const token = "zaf_s_" + "s".repeat(43);

test("connectToPortal requires the platform context of a hosted application", async () => {
  await assert.rejects(connectToPortal(), { code: "AI_FACTORY_BRIDGE_REQUIRED" });
  globalThis.__ZENEXTIA_HOST__ = { schemaVersion: 2, getAccessToken: async () => token, disconnect() {} };
  try { await assert.rejects(connectToPortal(), { code: "AI_FACTORY_BRIDGE_REQUIRED" }); }
  finally { delete globalThis.__ZENEXTIA_HOST__; }
});

test("the connected client sends the application token only, and revoking closes the context", async () => {
  let disconnected = false;
  const calls = [];
  const fetcher = globalThis.fetch;
  globalThis.__ZENEXTIA_HOST__ = { schemaVersion: 1, apiOrigin: "https://api.example.com", installationId: installation,
    getAccessToken: async () => token, disconnect() { disconnected = true; } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/identity")) {
      return new Response(JSON.stringify({ data: { member: { id: 1, name: "TEST" }, workspace: { id: 2, name: "TEST" },
        installation: { id: installation, version: "1.0.0" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(null, { status: 204 });
  };
  try {
    const client = await connectToPortal();
    assert.equal(client.mode, "live");
    assert.equal((await client.identity.get()).member.name, "TEST");
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
    assert.equal(calls[0].options.credentials, "omit");
    await client.session.revoke();
    assert.equal(disconnected, true);
  } finally { delete globalThis.__ZENEXTIA_HOST__; globalThis.fetch = fetcher; }
});
