// Start-up helpers for the single-file build opened straight from disk (file://).
// No network, no storage of its own beyond a write/read/delete probe on the real adapter.
import { button, h } from "./ui.js";

export const FILE_WARNING =
  "This browser is not saving your list when the file is opened directly. Download a backup before you close this page.";

export function isFileProtocol(loc = globalThis.location) {
  return Boolean(loc) && loc.protocol === "file:";
}

// Writes, reads back and deletes one key. Returns true only when the data really persists.
export async function probeStorage(adapter) {
  if (!adapter || adapter.volatile === true || adapter.kind === "memory") return false;
  const key = "__file_probe";
  const value = { probe: String(Date.now()) };
  try {
    await adapter.set(key, value);
    const back = await adapter.get(key);
    await adapter.delete(key);
    return Boolean(back) && back.probe === value.probe;
  } catch {
    return false;
  }
}

// Persistent (no close button) warning strip; the backup button is the primary action.
export function fileWarning({ onBackup, label = "Download backup" }) {
  return h("div", { class: "banner banner-error row no-print", id: "file-warning", role: "alert" },
    h("span", { text: FILE_WARNING }),
    button({ label, variant: "primary", onClick: onBackup }));
}
