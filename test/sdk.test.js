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
  // ADR 0100: a manifest may declare tools; the simulator checks their shape only.
  const tool = { name: "lister", description: "TEST", mode: "read", target: { type: "records", entityType: "ticket", operation: "list" } };
  assert.equal(createSimulatedApp({ manifest: { ...manifest, tools: [tool] } }).mode, "simulation");
  for (const tools of [[tool, tool], [{ ...tool, name: "Bad" }], [{ ...tool, target: { type: "shell" } }], "lister"]) {
    assert.throws(() => createSimulatedApp({ manifest: { ...manifest, tools } }));
  }
  for (const origins of [["http://abc.example.com"], ["https://*.example.com"], ["https://example.com/"], ["https://example.com:443"], ["https://a.example.com", "https://a.example.com"]]) {
    assert.throws(() => createSimulatedApp({ manifest: { ...manifest, externalOrigins: origins } }), undefined, origins.join(","));
  }
});

test("a file is sent as a multipart form and read back as bytes (ADR 0101)", async () => {
  const fileId = "00000000-0000-4000-8000-0000000000aa";
  const reference = { fileId, name: "TEST facture.pdf", contentType: "application/pdf", size: 9 };
  const calls = [];
  const app = createAppClient({ ...options, fetch: async (url, init) => {
    calls.push({ url, init });
    return init.method === "POST" ? Response.json({ data: reference }, { status: 201 })
      : new Response("%PDF-TEST", { headers: { "content-type": "application/pdf" } });
  } });
  const pdf = new Blob(["%PDF-TEST"], { type: "application/pdf" });
  assert.deepEqual(await app.files.upload(pdf, { name: "TEST facture.pdf" }), reference);
  const sent = calls[0];
  assert.equal(sent.url, `https://api.example.com/ai-factory/runtime/${installationId}/files`);
  assert.ok(sent.init.body instanceof FormData);
  assert.equal(sent.init.body.get("file").name, "TEST facture.pdf");
  // The browser writes the multipart boundary: no Content-Type is set by hand.
  assert.deepEqual(Object.keys(sent.init.headers).sort(), ["Accept", "Authorization"]);
  assert.equal(sent.init.credentials, "omit");
  assert.equal(await (await app.files.download(fileId)).text(), "%PDF-TEST");
  assert.equal(calls[1].url, `https://api.example.com/ai-factory/runtime/${installationId}/files/${fileId}`);
  // Refused before any request: not a Blob, empty, too large, a bad identifier.
  await assert.rejects(app.files.upload("text"), errorCode("AI_FACTORY_FILE_INVALID"));
  await assert.rejects(app.files.upload(new Blob([])), errorCode("AI_FACTORY_FILE_EMPTY"));
  await assert.rejects(app.files.upload(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)])), errorCode("AI_FACTORY_FILE_TOO_LARGE"));
  await assert.rejects(app.files.download("../identity"), errorCode("AI_FACTORY_INPUT_INVALID"));
  assert.equal(calls.length, 2);
  const refusing = createAppClient({ ...options, fetch: async () => Response.json(
    { error: { code: "AI_FACTORY_QUOTA_EXCEEDED", message: "Quota", requestId: "req-9" } }, { status: 429 }) });
  await assert.rejects(refusing.files.upload(pdf), (error) => errorCode("AI_FACTORY_QUOTA_EXCEEDED")(error) && error.status === 429 && error.requestId === "req-9");
  const offline = createAppClient({ ...options, fetch: async () => { throw new TypeError("offline"); } });
  await assert.rejects(offline.files.upload(pdf), errorCode("AI_FACTORY_NETWORK_ERROR"));
});

test("simulated files belong to one record and go with it (ADR 0101)", async () => {
  const withFile = { ...manifest, entities: [{ ...manifest.entities[0], fields: [
    ...manifest.entities[0].fields, { name: "piece", label: "Pièce jointe", type: "file" }] }] };
  const app = createSimulatedApp({ manifest: withFile });
  const tickets = app.data.entity("ticket");
  const reference = await app.files.upload(new Blob(["%PDF-TEST"], { type: "application/pdf" }), { name: "TEST.pdf" });
  assert.deepEqual({ name: reference.name, contentType: reference.contentType, size: reference.size },
    { name: "TEST.pdf", contentType: "application/pdf", size: 9 });
  const record = await tickets.create({ title: "TEST", piece: { fileId: reference.fileId, name: "other.exe" } });
  assert.deepEqual(record.data.piece, reference);
  await assert.rejects(tickets.create({ title: "TEST 2", piece: { fileId: reference.fileId } }), errorCode("AI_FACTORY_FILE_NOT_AVAILABLE"));
  await assert.rejects(tickets.create({ title: "TEST 3", piece: "TEST.pdf" }), errorCode("AI_FACTORY_ENTITY_INVALID"));
  assert.equal(await (await app.files.download(reference.fileId)).text(), "%PDF-TEST");
  // Keeping the reference keeps the file; dropping the field removes it.
  const kept = await tickets.replace(record.id, { title: "TEST v2", piece: record.data.piece }, 1);
  assert.equal(await (await app.files.download(reference.fileId)).text(), "%PDF-TEST");
  await tickets.replace(record.id, { title: "TEST v3" }, kept.revision);
  await assert.rejects(app.files.download(reference.fileId), errorCode("AI_FACTORY_FILE_NOT_FOUND"));
  // A manifest with no file field keeps no file; six file fields are refused.
  await assert.rejects(createSimulatedApp({ manifest }).files.upload(new Blob(["x"])), errorCode("AI_FACTORY_FILES_NOT_DECLARED"));
  const six = { ...manifest, entities: [{ ...manifest.entities[0], fields: [...manifest.entities[0].fields,
    ...[1, 2, 3, 4, 5, 6].map((index) => ({ name: `f${index}`, label: "TEST", type: "file" }))] }] };
  assert.throws(() => createSimulatedApp({ manifest: six }), errorCode("MANIFEST_INVALID"));
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

test("a tool route accepts only the call Zenextia makes for that tool", async () => {
  const identityToken = "zaf_i_" + "a".repeat(20) + "." + "b".repeat(43);
  const member = { active: true, member: { id: 42, name: "Member" }, workspace: { id: 7, name: "Workspace" } };
  const call = { ...member, tool: { name: "deposer_facture", mode: "write", callId: "00000000-0000-4000-8000-000000000001" } };
  const input = { apiOrigin: "https://api.example.com", installationId, audience: "https://api.example.org", token: identityToken };
  const answer = (data) => async () => ok(data);
  assert.deepEqual(await verifyIdentityToken({ ...input, tool: "deposer_facture", fetch: answer(call) }), call);
  // The application's own token, or another tool's, does not open a tool route.
  assert.equal(await verifyIdentityToken({ ...input, tool: "deposer_facture", fetch: answer(member) }), null);
  assert.equal(await verifyIdentityToken({ ...input, tool: "lister_factures", fetch: answer(call) }), null);
  // Without `tool`, the caller reads the claim and decides.
  assert.equal((await verifyIdentityToken({ ...input, fetch: answer(call) })).tool.name, "deposer_facture");
  await assert.rejects(verifyIdentityToken({ ...input, tool: "Deposer Facture", fetch: answer(call) }), errorCode("AI_FACTORY_INPUT_INVALID"));
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
