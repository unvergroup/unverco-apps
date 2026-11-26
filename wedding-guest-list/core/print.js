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

// iPhone / iPad Home Screen app (navigator.standalone === true): window.print() does nothing there, silently. Every printout of the app
// is laid out as a PDF instead and handed to the share sheet (core/canvas-doc.js: canvas -> JPEG -> PDF -> navigator.share), where the
// user taps "Print". Ordinary browsers and computers never take this path: they keep window.print().
export function needsFileDelivery(win = globalThis.window) {
  return Boolean(win && win.navigator && win.navigator.standalone === true);
}
