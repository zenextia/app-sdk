/**
 * Opens a link in a new tab (ADR 0102). Inside Zenextia the frame cannot open
 * a tab: the portal opens it, for a site the manifest lists in `linkOrigins`
 * (or `externalOrigins`) and the administrator approved. Outside Zenextia it
 * opens the tab itself. Returns false for an address that is not http(s).
 */
export function openUrl(url) {
  const bridge = globalThis.__ZENEXTIA_HOST__;
  if (bridge && typeof bridge.openUrl === "function") return bridge.openUrl(String(url));
  let target;
  try { target = new URL(String(url), globalThis.location?.href); } catch { return false; }
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  globalThis.open?.(target.href, "_blank", "noopener,noreferrer");
  return true;
}
