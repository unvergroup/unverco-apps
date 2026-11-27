/* Eski tarayici korumasi. ES5, klasik betik (modul degil): uygulamadan ONCE yuklenir, ayristirmasi hicbir modern ozelligine bagli degildir.
   1) Eksik tarayici ozelliklerini kucuk yedeklerle doldurur (structuredClone, replaceChildren, <dialog>).
   2) Uygulama acilmazsa (modul yuklenemedi, baslangicta hata, zaman asimi) bos ekran yerine 5 dilde sade bir uyari gosterir.
   Uygulama acilinca app.js __unvercoBoot.ready() cagirir; uyari kalkar. CSP script-src 'self' ile uyumlu: satir ici betik yok, stil CSSOM ile. */
(function (w, d) {
  "use strict";

  // ---- 1. Yedekler (yalniz eksikse) ----
  function def(obj, name, fn) {
    try { if (obj && typeof obj[name] !== "function") Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true }); } catch (e) { /* yedek kurulamadi */ }
  }
  // Uygulama verisi yalniz duz JSON (metin, sayi, mantiksal, dizi, nesne); bu yuzden JSON gidis-donusu esdegerdir.
  if (typeof w.structuredClone !== "function") {
    w.structuredClone = function (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
  }
  function replaceChildrenShim() {
    var frag = d.createDocumentFragment(), i, a;
    for (i = 0; i < arguments.length; i++) {
      a = arguments[i];
      frag.appendChild(a && typeof a === "object" && a.nodeType ? a : d.createTextNode(String(a)));
    }
    while (this.firstChild) this.removeChild(this.firstChild);
    this.appendChild(frag);
  }
  def(w.Element && w.Element.prototype, "replaceChildren", replaceChildrenShim);
  def(w.Document && w.Document.prototype, "replaceChildren", replaceChildrenShim);
  def(w.DocumentFragment && w.DocumentFragment.prototype, "replaceChildren", replaceChildrenShim);
  // <dialog>: iOS Safari 15.4 oncesinde yok (bilinmeyen eleman); open ozelligi ile ac / kapat.
  try {
    var probe = d.createElement("dialog");
    if (typeof probe.showModal !== "function" && w.HTMLUnknownElement) {
      var P = w.HTMLUnknownElement.prototype;
      Object.defineProperty(P, "open", {
        configurable: true,
        get: function () { return this.hasAttribute("open"); },
        set: function (v) { if (v) this.setAttribute("open", ""); else this.removeAttribute("open"); }
      });
      def(P, "showModal", function () { this.setAttribute("open", ""); });
      def(P, "show", function () { this.setAttribute("open", ""); });
      def(P, "close", function (rv) {
        if (!this.hasAttribute("open")) return;
        if (rv !== undefined) this.returnValue = rv;
        this.removeAttribute("open");
        var ev;
        try { ev = new w.Event("close"); } catch (e) { ev = d.createEvent("Event"); ev.initEvent("close", false, false); }
        this.dispatchEvent(ev);
      });
    }
  } catch (e) { /* dialog yedegi kurulamadi */ }

  // ---- 2. Bos ekran yerine uyari ----
  var TEXT = {
    en: ["The app could not start", "This browser may be too old. Please update Chrome or Safari, then reload this page."],
    es: ["La aplicación no pudo iniciarse", "Es posible que este navegador sea demasiado antiguo. Actualiza Chrome o Safari y vuelve a cargar esta página."],
    fr: ["L’application n’a pas pu démarrer", "Ce navigateur est peut-être trop ancien. Mettez à jour Chrome ou Safari, puis rechargez cette page."],
    de: ["Die App konnte nicht gestartet werden", "Dieser Browser ist möglicherweise zu alt. Bitte aktualisieren Sie Chrome oder Safari und laden Sie die Seite neu."],
    pt: ["O aplicativo não pôde iniciar", "Este navegador pode ser muito antigo. Atualize o Chrome ou o Safari e recarregue esta página."]
  };
  var done = false, box = null;

  function pickLang() {
    var n = w.navigator || {}, raw = (n.languages && n.languages[0]) || n.language || "en";
    var code = String(raw).slice(0, 2).toLowerCase();
    return TEXT[code] ? code : "en";
  }

  function show() {
    if (done || box || !d.body) return;
    var t = TEXT[pickLang()];
    box = d.createElement("div");
    box.id = "boot-warning";
    box.setAttribute("role", "alert");
    var s = box.style;
    s.position = "fixed"; s.top = "0"; s.left = "0"; s.right = "0"; s.bottom = "0"; s.zIndex = "2147483000";
    s.display = "flex"; s.flexDirection = "column"; s.alignItems = "center"; s.justifyContent = "center";
    s.padding = "24px"; s.textAlign = "center"; s.background = "#071a21"; s.color = "#f3f7f8";
    s.fontFamily = "system-ui, -apple-system, Roboto, Arial, sans-serif"; s.lineHeight = "1.45";
    var h = d.createElement("h1"); h.textContent = t[0];
    h.style.fontSize = "22px"; h.style.margin = "0 0 12px";
    var p = d.createElement("p"); p.textContent = t[1];
    p.style.fontSize = "17px"; p.style.margin = "0"; p.style.maxWidth = "34em";
    box.appendChild(h); box.appendChild(p);
    d.body.appendChild(box);
  }

  function ready() {
    done = true;
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
  }

  w.__unvercoBoot = { ready: ready, fail: show };

  // Betik yuklenemedi / soz dizimi hatasi / baslangicta hata: uygulama hazir olmadan gelen her sey uyari acar.
  w.addEventListener("error", function (e) {
    var tg = e && e.target;
    if (tg && tg !== w && tg.tagName !== "SCRIPT") return; // gorsel vb. kaynak hatasi uygulamayi durdurmaz
    show();
  }, true);
  w.addEventListener("unhandledrejection", function () { show(); });

  function onReadyDom() {
    // Modul desteklemeyen tarayici (Chrome 61 oncesi, iOS 10.3 oncesi): module betigi hic calismaz.
    var mods = d.querySelectorAll('script[type="module"]');
    if (mods.length && !("noModule" in d.createElement("script"))) show();
  }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", onReadyDom); else onReadyDom();
  w.setTimeout(function () { if (!done) show(); }, 15000);
})(window, document);
