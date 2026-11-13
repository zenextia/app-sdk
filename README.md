# @zenextia/app-sdk

Identity and shared data for applications published on
[Zenextia](https://zenextia.com).

An application published to a Zenextia Workspace runs inside Zenextia, for the
members allowed to use it. This package lets it read who is using it and keep
records shared by the Workspace's members. It has no runtime dependencies and
ships ES modules with TypeScript types.

Requires Node.js 20 or later to build. Publish your application with
[`@zenextia/cli`](https://github.com/zenextia/cli).

```sh
npm install @zenextia/app-sdk
```

## Démarrage rapide (français)

1. Déclarez dans `zenextia.app.json` les permissions et les types
   d'enregistrements (`entities`) dont l'application a besoin.
2. Dans l'application : `const app = await connectToPortal();`, puis
   `app.identity.get()` et `app.data.entity("nom").list/get/create/replace/delete`.
3. Pendant le développement, hors de Zenextia, utilisez
   `createSimulatedApp({ manifest })` : mêmes appels, données en mémoire.
   Un back-end à vous ? `app.identity.token(...)` côté application et
   `verifyIdentityToken(...)` côté serveur (section « Your own back-end »).
   Des actions que l'assistant Zenextia peut lancer pour un membre ? Déclarez
   des `tools` (section « Tools the assistant can call »).
4. Envoyez l'application avec `npx @zenextia/cli deploy`. Un administrateur de
   l'espace valide ensuite les permissions demandées.

## Declare what the application needs

Permissions and record types live in the application's `zenextia.app.json`:

```json
{
  "schemaVersion": 1,
  "sdkMajor": 1,
  "id": "ticket-tracker",
  "version": "1.0.0",
  "name": "Ticket tracker",
  "description": "Track tickets shared by the members of one Workspace.",
  "author": "Your name",
  "entrypoint": "index.html",
  "permissions": ["identity.read", "data.read", "data.write"],
  "entities": [
    {
      "entityType": "ticket",
      "label": "Tickets",
      "fields": [
        { "name": "title", "label": "Title", "type": "string", "required": true },
        { "name": "status", "label": "Status", "type": "enum", "enumValues": ["open", "closed"] }
      ]
    }
  ],
  "externalOrigins": []
}
```

| Permission | Lets the application |
| --- | --- |
| `identity.read` | Show the current member's and Workspace's names (never their email). |
| `data.read` | List and read its records. |
| `data.write` | Create, replace and delete its records. |
| `device.microphone` | Record audio (`getUserMedia({ audio: true })`). |
| `device.camera` | Take photos or video (`getUserMedia({ video: true })`). |
| `device.screen` | Capture the screen or a tab (`getDisplayMedia()`). |
| `clipboard.write` | Copy to the clipboard (`navigator.clipboard.write*`). |

`externalOrigins` lists up to 10 exact `https://host[:port]` origins (no path
or wildcard) that the application calls, for example a Supabase project. Once
an administrator approves them, `fetch`, XHR and WebSockets (`wss:`) may reach
them; data sent there leaves Zenextia. Workers, WebAssembly, downloads after a
click and `window.print()` need no declaration.

Request only what you use: a Workspace administrator reviews the request and
may grant less. Data permissions require `entities`, and `entities` require a
data permission. Field types: `string`, `text`, `number`, `integer`, `boolean`,
`date` (kept as a string) and `enum`. `sdkMajor: 1` is the contract this
package implements.

## Inside Zenextia

```js
import { connectToPortal } from "@zenextia/app-sdk";

const app = await connectToPortal();
const { member, workspace } = await app.identity.get();

const tickets = app.data.entity("ticket");
const created = await tickets.create({ title: "Inspect the site", status: "open" });
const updated = await tickets.replace(created.id, { title: "Site inspected", status: "closed" }, created.revision);
const page = await tickets.list({ pageSize: 25 });
await tickets.delete(updated.id, updated.revision);
```

`connectToPortal()` works only in an application opened from Zenextia; it
fails with `AI_FACTORY_BRIDGE_REQUIRED` anywhere else. Show that error: do not
fall back silently to the simulator.

## Your own back-end

Zenextia runs no server code for your application. When it needs a back-end
(a secret key, a database, webhooks), host it yourself, for example on
Supabase or a Node.js server, and list its exact origin in `externalOrigins`.
The application tells it who is calling with a five-minute identity token. It
needs the `identity.read` permission:

```js
const { token } = await app.identity.token("https://api.example.com");
const response = await fetch("https://api.example.com/orders", {
  headers: { Authorization: `Bearer ${token}` },
});
```

The back-end has Zenextia check the token before answering:

```js
import { verifyIdentityToken } from "@zenextia/app-sdk";

const identity = await verifyIdentityToken({
  apiOrigin: "https://api.zenextia.com",
  installationId: "<the installationId printed by zenextia deploy>",
  audience: "https://api.example.com", // this back-end's own origin
  token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
});
if (!identity) return new Response(null, { status: 401 });
// identity.member.id, identity.workspace.id, identity.preview
```

- The token names one approved origin, lives five minutes (`expiresIn`) and
  grants no access to Zenextia data. Ask for a new one when it expires.
- Zenextia rechecks the member, their role and the approvals on every check:
  a removed member stops getting through at once. Pin the installation IDs
  your back-end serves.
- Without Node.js, POST `{"token", "audience"}` as JSON to
  `https://api.zenextia.com/ai-factory/runtime/<installationId>/identity/introspect`.
  The answer's `data` is `{"active": false}`, or the member, the Workspace and
  the version.
- CORS: allow the application's origin, or any origin, with the
  `Authorization` and `Content-Type` headers; the token protects each call. Do
  not rely on cookies: browsers block another site's cookies inside the frame.
  Sign-in pages (Google, Microsoft) cannot open in the frame either.
- Tokens from the simulator never pass this check.

## Tools the assistant can call

An application can publish tools: actions the Zenextia assistant, or a
member's own agent connected to Zenextia, runs for a member who asks in plain
words ("file this invoice in the subscriptions application"). Declare them in
`zenextia.app.json`:

```json
"tools": [
  {
    "name": "list_tickets",
    "description": "List the tickets of the Workspace.",
    "mode": "read",
    "target": { "type": "records", "entityType": "ticket", "operation": "list" }
  },
  {
    "name": "file_invoice",
    "description": "File an invoice against a subscription.",
    "mode": "write",
    "input": [
      { "name": "supplier", "label": "Supplier", "type": "string", "required": true },
      { "name": "amount", "label": "Amount incl. tax", "type": "number", "required": true },
      { "name": "invoice", "label": "Invoice (PDF)", "type": "file" }
    ],
    "target": { "type": "endpoint", "url": "https://api.example.com/tools/file-invoice" }
  }
]
```

- Up to 20 tools. `name` is lowercase letters, digits and underscores (at most
  48). `description` is what the assistant and the administrator read: say
  what the tool does and when to use it.
- `mode` is `read` or `write`. A read answers at once. A write is shown to the
  member as a card with the exact values, and runs only when they approve it.
- A `records` target runs `list`, `get`, `create` or `replace` on one of your
  `entities`. It needs `data.read` or `data.write` and declares no `input`:
  the entity's fields are its parameters.
- An `endpoint` target is a route of your own back-end. Its origin must be in
  `externalOrigins`, and it needs `identity.read`. `input` lists up to 30
  parameters: the field types, plus `file` for one document the member can
  read in Zenextia (a Documents file, a file attached to the conversation, or
  an attachment of a message in their own Gmail or Outlook mailbox);
  `multiple: true` makes a list (not for `file`).
- An administrator approves each tool, version by version. A tool is offered
  only to members whose role opens the application with the matching read or
  write right.

Zenextia calls an `endpoint` tool from its servers, for one member:

```http
POST https://api.example.com/tools/file-invoice
Authorization: Bearer zaf_i_...
Idempotency-Key: action:5f0c...
X-Zenextia-Tool: file_invoice
X-Zenextia-Call: 0b9e...

{ "tool": "file_invoice", "callId": "0b9e...",
  "input": { "supplier": "LinkedIn", "amount": 40 },
  "files": { "invoice": { "name": "invoice.pdf", "contentType": "application/pdf", "size": 48211, "base64": "..." } } }
```

The route checks who the call is for, exactly as for the application's own
requests, and asks for this tool by name:

```js
const identity = await verifyIdentityToken({
  apiOrigin: "https://api.zenextia.com",
  installationId: "<the installationId printed by zenextia deploy>",
  audience: "https://api.example.com",
  token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
  tool: "file_invoice", // any token that is not a call of this tool gives null
});
if (!identity) return new Response(null, { status: 401 });
// identity.member.id, identity.workspace.id, identity.tool.callId
```

- Always check the token, then apply your own rules to `identity.member` and
  `identity.workspace`. Never trust a member or Workspace found in `input`.
- The token is for this tool and this call, lives five minutes and is accepted
  **once**: check it once per request and keep the result.
- `Idempotency-Key` is the same on every attempt of one approved write. Store
  it and answer a repeat without doing the work twice.
- Answer with JSON, 256 KB at most and not compressed (Zenextia sends
  `Accept-Encoding: identity`), within 30 seconds for the whole exchange. The
  request is 10 MB at most, files included (7 MB per file). A non-2xx status
  is reported to the member as a failure.
- A tool always waits for the member: it cannot be run by an unattended
  automation.
- What you answer is read by the assistant as data. It is not followed as
  instructions.

## While developing

```js
import { createSimulatedApp } from "@zenextia/app-sdk";
import manifest from "./zenextia.app.json" with { type: "json" };

const app = createSimulatedApp({ manifest });
```

The simulator offers the same calls with an in-memory store and a fictitious
member and Workspace. It checks declared fields, required values, enums,
permissions and revisions; it does not reproduce a Workspace's roles. Show a
visible "simulation" label while it is in use (`app.mode === "simulation"`).

## Rules worth knowing

- **Replace sends the whole record.** Omitted optional fields are removed.
- **Revisions guard every change.** `replace` and `delete` need the latest
  `revision`. A `409` error means someone changed the record: read it again and
  let the member decide.
- **Pages.** `list` returns at most 100 records and a `nextCursor`; follow it
  until it is `null`. Records are ordered by identifier, not by date.
- **Size.** A record's data is at most 32 KiB of JSON.
- **Errors.** `ZenextiaAppError` carries `code`, `status` and, when available,
  `requestId`. Show the request ID so support can trace it.
- **No automatic retry of writes.** After a network failure the write may have
  succeeded: read again before trying once more.
- **Who decides.** Zenextia checks the member's current rights on every call.
  Removing a member, a role or the application stops access at once; the SDK
  cannot override that.

## TypeScript

```ts
type Ticket = { title: string; status: "open" | "closed" };
const tickets = app.data.entity<Ticket>("ticket");
```

## Development

```sh
npm test
```

Releases are published from `v*` tags by GitHub Actions with npm trusted
publishing and provenance.

## License

MIT
