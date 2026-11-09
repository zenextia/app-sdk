import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAppClient, createSimulatedApp, verifyIdentityToken, ZenextiaAppError } from "@zenextia/app-sdk";

const manifest = JSON.parse(await readFile(new URL("./fixtures/zenextia.app.json", import.meta.url), "utf8"));
const installationId = "00000000-0000-0000-0000-000000000001";
const recordId = "00000000-0000-0000-0000-000000000002";
const token = "zaf_s_" + "a".repeat(43);
const options = { apiOrigin: "https://api.example.com", installationId, accessToken: token };
const errorCode = (code) => (error) => error instanceof ZenextiaAppError && error.code === code;
const ok = (data) => Response.json({ data });

test("live client binds the installation and never sends portal cookies", async () => {
  const calls = [];
  const app = createAppClient({ ...options, fetch: async (url, init) => { calls.push({ url, init }); return ok({ member: { id: 42 } }); } });
  assert.equal(app.mode, "live");
  assert.deepEqual(await app.identity.get(), { member: { id: 42 } });
  const { url, init } = calls[0];
  assert.equal(url, `https://api.example.com/ai-factory/runtime/${installationId}/identity`);
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.headers.Authorization, `Bearer ${token}`);
  assert.ok(!url.includes(token));
});

test("live CRUD preserves revisions, cursor pagination and payload boundaries", async () => {
  const calls = [];
  const app = createAppClient({ ...options, fetch: async (url, init) => {
    calls.push({ url: new URL(url), init });
    return init.method === "DELETE" ? new Response(null, { status: 204 }) : ok({ id: recordId, revision: 1 });
  } });
  const tickets = app.data.entity("ticket");
  await tickets.create({ title: "First" });
  await tickets.get(recordId);
  await tickets.list({ pageSize: 2, after: recordId });
  await tickets.replace(recordId, { title: "Edited" }, 1);
  await tickets.delete(recordId, 2);
  assert.deepEqual(JSON.parse(calls[0].init.body), { data: { title: "First" } });
  assert.equal(calls[1].url.pathname.endsWith(`/ticket/${recordId}`), true);
  assert.equal(calls[2].url.searchParams.get("after"), recordId);
  assert.equal(calls[2].url.searchParams.get("pageSize"), "2");
  assert.deepEqual(JSON.parse(calls[3].init.body), { data: { title: "Edited" }, expectedRevision: 1 });
  assert.equal(calls[4].url.searchParams.get("expectedRevision"), "2");
  assert.equal(calls[4].init.body, undefined);
});

test("server conflicts expose the stable code and request id", async () => {
  const app = createAppClient({ ...options, fetch: async () => Response.json({ error: {
    code: "AI_FACTORY_RECORD_CONFLICT", message: "Read the record again.", requestId: "request-1",
  } }, { status: 409 }) });
  await assert.rejects(app.data.entity("ticket").replace(recordId, { title: "T" }, 1), (error) => {
    assert.equal(error.code, "AI_FACTORY_RECORD_CONFLICT");
    assert.equal(error.status, 409);
    assert.equal(error.requestId, "request-1");
    return true;
  });
});

test("a failed network write is never retried", async () => {
  let calls = 0;
  const app = createAppClient({ ...options, fetch: async () => { calls++; throw new Error("Disconnected"); } });
  await assert.rejects(app.data.entity("ticket").create({ title: "T" }), errorCode("AI_FACTORY_NETWORK_ERROR"));
  assert.equal(calls, 1);
});

test("portal credentials and unsafe API configuration fail before a request", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return ok({}); };
  for (const accessToken of ["portal-token", "zaf_l_" + "a".repeat(43), ""]) {
    await assert.rejects(createAppClient({ ...options, accessToken, fetch }).identity.get(), errorCode("AI_FACTORY_SESSION_INVALID"));
  }
  for (const apiOrigin of ["http://api.example.com", "https://user:pass@api.example.com", "https://api.example.com/path", "https://api.example.com/?x=1"]) {
    assert.throws(() => createAppClient({ ...options, apiOrigin, fetch }), errorCode("AI_FACTORY_INPUT_INVALID"));
  }
  assert.throws(() => createAppClient({ ...options, installationId: "../other", fetch }), errorCode("AI_FACTORY_INPUT_INVALID"));
  assert.equal(calls, 0);
});

test("invalid entity paths and missing revisions cannot reach the server", async () => {
  const app = createAppClient({ ...options, fetch: async () => { assert.fail("Must not fetch"); } });
  assert.throws(() => app.data.entity("../other"), errorCode("AI_FACTORY_INPUT_INVALID"));
  const tickets = app.data.entity("ticket");
  await assert.rejects(tickets.get("../record"), errorCode("AI_FACTORY_INPUT_INVALID"));
  await assert.rejects(tickets.replace(recordId, { title: "T" }, undefined), errorCode("AI_FACTORY_REVISION_REQUIRED"));
  await assert.rejects(tickets.delete(recordId, 0), errorCode("AI_FACTORY_REVISION_REQUIRED"));
  await assert.rejects(tickets.list({ pageSize: 101 }), errorCode("AI_FACTORY_PAGE_INVALID"));
  await assert.rejects(tickets.create({ title: Infinity }), errorCode("AI_FACTORY_ENTITY_INVALID"));
  await assert.rejects(tickets.create({ title: "a".repeat(32769) }), errorCode("AI_FACTORY_RECORD_TOO_LARGE"));
});

test("revoking a live client closes its local session", async () => {
  let calls = 0;
  const app = createAppClient({ ...options, fetch: async () => { calls++; return new Response(null, { status: 204 }); } });
  await app.session.revoke();
  await assert.rejects(app.identity.get(), errorCode("AI_FACTORY_SESSION_INVALID"));
  assert.equal(calls, 1);
});

test("the token source is evaluated for every request without persistent storage", async () => {
  let current = token;
  const seen = [];
  const app = createAppClient({ ...options, accessToken: async () => current, fetch: async (_url, init) => { seen.push(init.headers.Authorization); return ok({}); } });
  await app.identity.get();
  current = "zaf_s_" + "b".repeat(43);
  await app.identity.get();
  assert.deepEqual(seen, [`Bearer ${token}`, `Bearer ${current}`]);
});

test("invalid platform JSON and missing envelopes are explicit failures", async () => {
  for (const response of [new Response("not JSON"), Response.json({ result: 1 })]) {
    await assert.rejects(createAppClient({ ...options, fetch: async () => response }).identity.get(), errorCode("AI_FACTORY_RESPONSE_INVALID"));
  }
});

test("the simulator exercises shared entity operations without a Workspace", async () => {
  const app = createSimulatedApp({ manifest });
  assert.equal(app.mode, "simulation");
  assert.equal((await app.identity.get()).workspace.id, 0);
  const tickets = app.data.entity("ticket");
  const first = await tickets.create({ title: "First", status: "open" });
  await tickets.create({ title: "Second" });
  const page = await tickets.list({ pageSize: 1 });
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  assert.equal((await tickets.list({ after: page.nextCursor })).items.length, 1);
  first.data.title = "Must not alter stored data";
  assert.equal((await tickets.get(first.id)).data.title, "First");
  const updated = await tickets.replace(first.id, { title: "Edited" }, 1);
  assert.equal(updated.revision, 2);
  await assert.rejects(tickets.replace(first.id, { title: "Stale" }, 1), errorCode("AI_FACTORY_RECORD_CONFLICT"));
  await tickets.delete(first.id, 2);
  await assert.rejects(tickets.get(first.id), errorCode("AI_FACTORY_RECORD_NOT_FOUND"));
});

test("simulated installations never share a record store", async () => {
  const first = createSimulatedApp({ manifest });
  const second = createSimulatedApp({ manifest });
  const record = await first.data.entity("ticket").create({ title: "Private to this installation" });
  await assert.rejects(second.data.entity("ticket").get(record.id), errorCode("AI_FACTORY_RECORD_NOT_FOUND"));
  assert.deepEqual((await second.data.entity("ticket").list()).items, []);
});

test("simulation enforces declared fields and permissions and freezes the contract", async () => {
  const copy = structuredClone(manifest);
  const app = createSimulatedApp({ manifest: copy });
  copy.entities[0].fields[0].required = false;
  const tickets = app.data.entity("ticket");
  for (const data of [{}, { title: "T", unknown: 1 }, { title: 1 }, { title: "T", status: "unknown" }, { title: "\u0000" }, { title: "\ud800" }]) {
    await assert.rejects(tickets.create(data), errorCode("AI_FACTORY_ENTITY_INVALID"));
  }
  assert.equal((await tickets.create({ title: "Emoji 😀" })).data.title, "Emoji 😀");
  await assert.rejects(app.data.entity("unknown").list(), errorCode("AI_FACTORY_ENTITY_NOT_FOUND"));
  const readOnly = createSimulatedApp({ manifest: { ...manifest, permissions: ["data.read"] } });
  await assert.rejects(readOnly.data.entity("ticket").create({ title: "Denied" }), errorCode("AI_FACTORY_PERMISSION_DENIED"));
  await readOnly.session.revoke();
  await assert.rejects(readOnly.data.entity("ticket").list(), errorCode("AI_FACTORY_SESSION_INVALID"));
});

test("simulation rejects unsupported contract majors and later delivery steps", () => {
  for (const change of [{ sdkMajor: 2 }, { schemaVersion: true }, { permissions: ["gmail.read"] },
                        { permissions: ["data.read", "data.read"] }, { serverFunctions: [] },
                        // ADR 0093 opened exact origins; a wildcard is still refused.
                        { externalOrigins: ["https://*.example.com"] }]) {
    assert.throws(() => createSimulatedApp({ manifest: { ...manifest, ...change } }), errorCode("MANIFEST_INVALID"));
  }
});

test("simulation accepts a declared device permission and still refuses unknown ones (ADR 0093)", () => {
  const withDevices = { ...manifest, permissions: [...manifest.permissions, "device.microphone", "clipboard.write"] };
  assert.equal(createSimulatedApp({ manifest: withDevices }).mode, "simulation");
  assert.throws(() => createSimulatedApp({ manifest: { ...manifest, permissions: [...manifest.permissions, "device.geolocation"] } }));
});

test("simulation accepts exact https external origins and refuses anything looser (ADR 0093)", () => {
  assert.equal(createSimulatedApp({ manifest: { ...manifest, externalOrigins: ["https://abc.supabase.co", "https://api.example.com:8443"] } }).mode, "simulation");
  for (const origins of [["http://abc.example.com"], ["https://*.example.com"], ["https://example.com/"], ["https://example.com:443"], ["https://a.example.com", "https://a.example.com"]]) {
    assert.throws(() => createSimulatedApp({ manifest: { ...manifest, externalOrigins: origins } }), undefined, origins.join(","));
  }
});

test("an identity token names one approved back-end (ADR 0094)", async () => {
  const calls = [];
  const app = createAppClient({ ...options, fetch: async (url, init) => {
    calls.push({ url, init });
    return ok({ token: "zaf_i_x", tokenType: "ZenextiaIdentity", audience: "https://api.example.org", expiresIn: 300 });
  } });
  assert.equal((await app.identity.token("https://api.example.org")).expiresIn, 300);
  assert.equal(calls[0].url, `https://api.example.com/ai-factory/runtime/${installationId}/identity/token`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { audience: "https://api.example.org" });
  for (const audience of ["https://api.example.org/", "http://api.example.org", "https://*.example.org", "https://api.example.org:443", undefined]) {
    await assert.rejects(app.identity.token(audience), errorCode("AI_FACTORY_INPUT_INVALID"), String(audience));
  }
  assert.equal(calls.length, 1);
});

test("a back-end has Zenextia check an identity token and gets null when it is not valid", async () => {
  const identityToken = "zaf_i_" + "a".repeat(20) + "." + "b".repeat(43);
  const verified = { active: true, member: { id: 42, name: "Member" }, workspace: { id: 7, name: "Workspace" } };
  const seen = [];
  const answer = (data) => async (url, init) => { seen.push({ url, init }); return ok(data); };
  const input = { apiOrigin: "https://api.example.com", installationId, audience: "https://api.example.org", token: identityToken };
  assert.deepEqual(await verifyIdentityToken({ ...input, fetch: answer(verified) }), verified);
  assert.equal(seen[0].url, `https://api.example.com/ai-factory/runtime/${installationId}/identity/introspect`);
  assert.deepEqual(JSON.parse(seen[0].init.body), { token: identityToken, audience: "https://api.example.org" });
  assert.equal(seen[0].init.headers.Authorization, undefined);
  assert.equal(await verifyIdentityToken({ ...input, fetch: answer({ active: false }) }), null);
  assert.equal(await verifyIdentityToken({ ...input, token: "zaf_s_" + "a".repeat(43), fetch: async () => assert.fail("Must not fetch") }), null);
  await assert.rejects(verifyIdentityToken({ ...input, fetch: async () => Response.json(
    { error: { code: "AI_FACTORY_QUOTA_EXCEEDED", message: "Budget", requestId: "req-1" } }, { status: 429 }) }),
  (error) => errorCode("AI_FACTORY_QUOTA_EXCEEDED")(error) && error.status === 429 && error.requestId === "req-1");
  await assert.rejects(verifyIdentityToken({ ...input, audience: "https://api.example.org/", fetch: answer(verified) }), errorCode("AI_FACTORY_INPUT_INVALID"));
  await assert.rejects(verifyIdentityToken({ ...input, apiOrigin: "http://api.example.com", fetch: answer(verified) }), errorCode("AI_FACTORY_INPUT_INVALID"));
});

test("simulated identity tokens follow the manifest and never pass a real check", async () => {
  const app = createSimulatedApp({ manifest: { ...manifest, externalOrigins: ["https://api.example.org"] } });
  const issued = await app.identity.token("https://api.example.org");
  assert.equal(issued.audience, "https://api.example.org");
  await assert.rejects(app.identity.token("https://other.example.org"), errorCode("AI_FACTORY_IDENTITY_AUDIENCE_DENIED"));
  assert.equal(await verifyIdentityToken({ apiOrigin: "https://api.example.com", installationId,
    audience: "https://api.example.org", token: issued.token, fetch: async () => assert.fail("Must not fetch") }), null);
  const withoutIdentity = createSimulatedApp({ manifest: { ...manifest, permissions: ["data.read"], externalOrigins: ["https://api.example.org"] } });
  await assert.rejects(withoutIdentity.identity.token("https://api.example.org"), errorCode("AI_FACTORY_PERMISSION_DENIED"));
});
