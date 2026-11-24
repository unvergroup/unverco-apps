// Belge duzeyinde tek koruma (capture asamasi; moduller ve guardWrite'tan bagimsiz, baska urune oldugu gibi kopyalanir).
// Kazara ikinci tik "ayni YER, kisa sure" olgusudur: bir dugme gorunumu degistirince (pencere acar, seridi kapatir, sekme degistirir,
// yeniden cizer) imlecin altina BASKA bir denetim gelir. Kural: kabul edilen son fare / dokunma tiklamasindan sonra QUIET_MS icinde,
// NEAR_PX (CSS px) yaricapina gelen ve FARKLI bir denetime dusen tik yutulur (preventDefault + stopImmediatePropagation).
// Denetim "dugum kimligiyle" degil kararli anahtarla taninir (yeniden cizilen ayni dugme ayni anahtari tasir): data-action, id,
// aria-label, yoksa etiket metni; acik pencere sirasi da anahtara girer (ayni etiketli onay dugmesi baska denetimdir). YUTULMAYANLAR: klavye etkinlestirmesi (event.detail === 0), ayni denetime ikinci tik, giris /
// secici / onay kutusu / radyo (change denetimleri), dugme olmayan hedefler ve data-rapid ozniteligi olan denetimler (bilerek hizli
// tekrarlanan: "satir ekle", sayi artir / azalt). Yutulan tik sayaci uzatmaz.
export const QUIET_MS = 800;
export const NEAR_PX = 30;
const CONTROL = "button, a[href], summary, [role=button], [role=tab], [role=menuitem]";

export function controlKey(el) {
  const a = (n) => (el.getAttribute ? el.getAttribute(n) : null);
  return `${(el.tagName || "").toLowerCase()}|${a("data-action") || el.id || a("aria-label") || (el.textContent || "").trim().slice(0, 60)}`;
}

// Saf karar: state = { x, y, t, key } | null. Doner { swallow, next } (next: yeni durum).
export function decide(state, { x, y, key, now, rapid = false }) {
  const near = state && now - state.t < QUIET_MS && Math.hypot(x - state.x, y - state.y) <= NEAR_PX;
  if (near && key !== state.key && !rapid) return { swallow: true, next: state };
  return { swallow: false, next: { x, y, t: now, key } };
}

export function installClickGuard(doc = typeof document !== "undefined" ? document : null) {
  if (!doc || typeof doc.addEventListener !== "function") return null;
  let state = null;
  const onClick = (e) => {
    if (!(e.detail > 0) || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return; // klavye / programli tik
    const el = e.target && e.target.closest ? e.target.closest(CONTROL) : null;
    if (!el || el.disabled) return;
    // Kapsam: acik pencere sirasi (-1 = sayfa). Ayni etiketli dugme baska pencerede (Delete -> onay penceresindeki Delete) FARKLI denetimdir.
    const dlg = el.closest("dialog");
    const scope = dlg && doc.querySelectorAll ? [...doc.querySelectorAll("dialog[open]")].indexOf(dlg) : -1;
    const r = decide(state, { x: e.clientX, y: e.clientY, key: `${scope}:${controlKey(el)}`, now: Date.now(), rapid: Boolean(el.closest("[data-rapid]")) });
    state = r.next;
    if (r.swallow) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}

