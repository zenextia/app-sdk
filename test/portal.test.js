import assert from "node:assert/strict";
import test from "node:test";
import { connectToPortal, createSimulatedApp, openUrl } from "@zenextia/app-sdk";

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

test("openUrl goes through the portal inside Zenextia and opens the tab outside (ADR 0102)", () => {
  const sent = [];
  globalThis.__ZENEXTIA_HOST__ = { openUrl: (url) => { sent.push(url); return true; } };
  try {
    assert.equal(openUrl(new URL("https://www.linkedin.com/in/test")), true);
    assert.deepEqual(sent, ["https://www.linkedin.com/in/test"]);
  } finally { delete globalThis.__ZENEXTIA_HOST__; }
  const opened = [];
  const previous = globalThis.open;
  globalThis.open = (...args) => { opened.push(args); return null; };
  try {
    assert.equal(openUrl("https://app.hubspot.com/x"), true);
    assert.equal(openUrl("javascript:alert(1)"), false);
    assert.deepEqual(opened, [["https://app.hubspot.com/x", "_blank", "noopener,noreferrer"]]);
  } finally { globalThis.open = previous; }
});

test("the simulator accepts link origins and refuses loose ones", () => {
  const manifest = { schemaVersion: 1, sdkMajor: 1, id: "test-links", version: "1.0.0", name: "TEST", description: "TEST", author: "TEST" };
  assert.ok(createSimulatedApp({ manifest: { ...manifest, linkOrigins: ["https://www.linkedin.com"] } }));
  assert.throws(() => createSimulatedApp({ manifest: { ...manifest, linkOrigins: ["https://*.hubspot.com"] } }));
});
