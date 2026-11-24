// "Yazdir / PDF olarak kaydet". Belge basligi gecici olarak PDF dosya adi olur.
export function printDocument({ title, win = globalThis.window, doc = globalThis.document } = {}) {
  const old = doc.title;
  if (title) doc.title = title;
  try {
    win.print();
  } finally {
    doc.title = old;
  }
}

// iPhone / iPad Home Screen app (navigator.standalone === true): window.print() does nothing there, silently. Callers show
// an explanation window instead. Ordinary browsers and computers never take this path.
export function isStandalone(win = globalThis.window) {
  return Boolean(win && win.navigator && win.navigator.standalone === true);
}
