// Metni panoya kopyalar. Once navigator.clipboard (HTTPS / localhost), olmazsa gizli textarea + execCommand (file:// ve eski tarayici).
// Doner true / false; asla firlatmaz. Bagimliliklar enjekte edilebilir (testler).
export async function copyText(text, { nav = globalThis.navigator, doc = globalThis.document } = {}) {
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch { /* izin yok: yedek yol */ }
  try {
    if (!doc || typeof doc.createElement !== "function") return false;
    const ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.className = "clip-shadow";
    doc.body.append(ta);
    ta.select();
    if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(0, text.length);
    const ok = typeof doc.execCommand === "function" ? doc.execCommand("copy") : false;
    ta.remove();
    return Boolean(ok);
  } catch { return false; }
}
