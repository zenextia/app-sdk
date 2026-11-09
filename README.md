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
