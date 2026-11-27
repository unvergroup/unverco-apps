(function (opts) {
  // Ortak sayfa denetimleri. Playwright evaluate, Selenium execute_script ve Chrome DevTools Runtime.evaluate ayni dosyayi kullanir.
  // Eski tarayicilar (Chrome 66+) icin ES2017 ile sinirli: ?. ve ?? YOK.
  opts = opts || {};
  var vw = window.innerWidth, vh = window.innerHeight;
  var de = document.documentElement;
  function rectOf(e) {
    var r = e.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return null;
    var cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return null;
    return r;
  }
  function label(e) {
    var cls = (typeof e.className === 'string' && e.className.trim()) ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    var t = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + cls + (t ? ' "' + t + '"' : '');
  }
  function hiddenByAncestor(e) {
    for (var p = e; p && p !== document.body; p = p.parentElement) {
      if (p.getAttribute('aria-hidden') === 'true' || p.hasAttribute('hidden') || p.hasAttribute('inert')) return true;
      var cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  }
  function inScroller(e) {
    for (var p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && p.getBoundingClientRect().right <= vw + 1) return true;
    }
    return false;
  }
  var out = {};

  // 1) Bos ekran
  var main = opts.main ? document.querySelector(opts.main) : document.body;
  var text = main ? (main.innerText || '').trim() : '';
  var visibleCount = 0;
  if (main) {
    var all = main.querySelectorAll('*');
    for (var i = 0; i < all.length && visibleCount < 50; i++) { if (rectOf(all[i])) visibleCount++; }
  }
  out.blank = { blank: !main || text.length < 15 || visibleCount < 3, mainFound: !!main, textLen: text.length, visible: visibleCount };

  // 2) Yatay tasma
  var sw = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0);
  var off = [];
  if (sw > vw + 1) {
    var els = document.body.querySelectorAll('*');
    for (var j = 0; j < els.length && off.length < 8; j++) {
      var e2 = els[j], r2 = rectOf(e2);
      if (!r2) continue;
      if ((r2.right > vw + 1 || r2.left < -1) && getComputedStyle(e2).position !== 'fixed' && !hiddenByAncestor(e2) && !inScroller(e2)) off.push(label(e2) + ' sag=' + Math.round(r2.right));
    }
  }
  out.overflow = { overflow: sw > vw + 1, scrollWidth: sw, innerWidth: vw, offenders: off };

  // 3) Kirpilmis metin (overflow:hidden/clip + icerik tasiyor, ellipsis degil)
  var clipped = [];
  var cand = document.body.querySelectorAll('*');
  for (var k = 0; k < cand.length && clipped.length < 8; k++) {
    var e3 = cand[k];
    if (e3.closest && e3.closest('#print-root')) continue;
    var own = false;
    for (var n = e3.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3 && n.nodeValue.trim()) { own = true; break; } }
    if (!own || !rectOf(e3) || hiddenByAncestor(e3)) continue;
    var cs3 = getComputedStyle(e3);
    var hx = /(hidden|clip)/.test(cs3.overflowX) && e3.scrollWidth > e3.clientWidth + 1 && cs3.textOverflow !== 'ellipsis';
    var hy = /(hidden|clip)/.test(cs3.overflowY) && e3.scrollHeight > e3.clientHeight + 2 && !(cs3.webkitLineClamp && cs3.webkitLineClamp !== 'none');
    if (hx || hy) clipped.push(label(e3) + (hx ? ' yatay' : ' dikey') + ' ' + e3.scrollWidth + 'x' + e3.scrollHeight + ' > ' + e3.clientWidth + 'x' + e3.clientHeight);
  }
  out.clipped = clipped;

  // 4) 44x44 dokunma hedefi
  var small = [];
  var tg = document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch]');
  var seen = {};
  for (var m = 0; m < tg.length; m++) {
    var e4 = tg[m], r4 = rectOf(e4);
    if (!r4 || hiddenByAncestor(e4)) continue;
    if (r4.right <= 0 || r4.bottom <= 0 || r4.left >= vw && !inScroller(e4)) continue; // ekran disi (ornek: icerige atla baglantisi)
    var cs4 = getComputedStyle(e4);
    if (e4.tagName === 'A' && cs4.display === 'inline') continue; // metin ici baglanti (WCAG istisnasi)
    if (r4.width < 43.5 || r4.height < 43.5) {
      var key = label(e4);
      if (seen[key]) continue; seen[key] = 1;
      small.push(label(e4) + ' ' + Math.round(r4.width) + 'x' + Math.round(r4.height));
    }
  }
  out.small = small;
  out.title = document.title;
  return out;
})
