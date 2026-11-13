import { createAppClient, createSimulatedApp, verifyIdentityToken, type AppManifest, type DataRecord, type IdentityToken } from "@zenextia/app-sdk";

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
const kept = await app.files.upload(new Blob(["TEST"]), { name: "TEST.txt" });
const keptId: string = kept.fileId;
const bytes: Blob = await app.files.download(keptId);
void bytes;
const proof: IdentityToken = await app.identity.token("https://api.example.org");
const verified = await verifyIdentityToken({
  apiOrigin: "https://api.example.com", installationId: "00000000-0000-0000-0000-000000000001",
  audience: "https://api.example.org", token: proof.token,
});
const memberId: number | undefined = verified?.member.id;
void memberId;
const toolCall = await verifyIdentityToken({
  apiOrigin: "https://api.example.com", installationId: "00000000-0000-0000-0000-000000000001",
  audience: "https://api.example.org", token: proof.token, tool: "deposer_facture",
});
const callId: string | undefined = toolCall?.tool?.callId;
void callId;
