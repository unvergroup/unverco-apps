// TEK YAZDIRMA KAPISI: uygulamadaki her yazdirma requestPrint'ten gecer (window.print baska yerde cagrilmaz; tests/print-gate.test.mjs denetler).
// Iskeletin yontemi: build() ekranda gorunmeyen #print-root'a bir rapor koyar; core/print.css yazdirirken yalniz onu gosterir (kagit beyaz, tek sayfa).
export async function requestPrint({ build, title = "" }, { win = globalThis.window } = {}) {
  const d = win.document;
  const root = d.getElementById("print-root");
  root.replaceChildren(build());
  d.body.classList.add("printing");
  const old = d.title;
  if (title) d.title = title;
  const cleanup = () => { root.replaceChildren(); d.body.classList.remove("printing"); d.title = old; };
  win.addEventListener("afterprint", cleanup, { once: true });
  win.print();
  return "printed";
}
