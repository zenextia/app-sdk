import { createAppClient, createSimulatedApp, type AppManifest, type DataRecord } from "@zenextia/app-sdk";

interface Ticket { title: string; status?: "open" | "closed" }
const app = createAppClient({
  apiOrigin: "https://api.example.com", installationId: "00000000-0000-0000-0000-000000000001",
  accessToken: async () => "zaf_s_" + "a".repeat(43),
});
const ticket: DataRecord<Ticket> = await app.data.entity<Ticket>("ticket").create({ title: "Typed" });
await app.data.entity<Ticket>("ticket").replace(ticket.id, { title: "Edited", status: "closed" }, ticket.revision);
// @ts-expect-error A replacement cannot omit its expected revision.
app.data.entity<Ticket>("ticket").replace(ticket.id, { title: "Stale" });
// @ts-expect-error Business data follows the application's declared type.
app.data.entity<Ticket>("ticket").create({ title: 1 });
declare const manifest: AppManifest;
const simulated = createSimulatedApp({ manifest });
const mode: "live" | "simulation" = simulated.mode;
void mode;
