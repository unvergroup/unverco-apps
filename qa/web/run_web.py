#!/usr/bin/env python3
"""Playwright ile web QA: her (profil x uygulama) icin ana yolculuk + ortak denetimler.
Kullanim: python qa/web/run_web.py --engine chromium [--apps habit,budget] [--profiles iphone,masaustu] [--out qa-out/web-chromium] [--env-label ...]
Cikis kodu: 0 (testler kosdu; KALDI satirlari rapor asamasinda degerlendirilir), 2 (altyapi hatasi)."""
import argparse, io, json, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
from qa_common import *  # noqa
from playwright.sync_api import sync_playwright

PRINT_STUB = ("window.__printed = 0; window.print = function () { window.__printed += 1; };"
              "document.addEventListener('securitypolicyviolation', function (e) { console.error('CSP ihlali: ' + e.violatedDirective + ' engellenen=' + e.blockedURI + ' ornek=' + (e.sample || '') + ' kaynak=' + e.sourceFile + ':' + e.lineNumber); }, true);")
LEGACY_STUB = ("delete window.structuredClone; delete Object.hasOwn; delete Array.prototype.at; delete Array.prototype.findLast; delete Array.prototype.findLastIndex;"
               "delete String.prototype.at; delete Element.prototype.replaceChildren;")
PAPERS = [("Letter", {"format": "Letter"}), ("A4", {"format": "A4"}), ("8.5x10.8in", {"width": "8.5in", "height": "10.8in"})]


class Runner:
    def __init__(self, pw, engine, out, res, server):
        self.pw, self.engine, self.out, self.res, self.server, self.base = pw, engine, pathlib.Path(out), res, server, server.url
        self.br = getattr(pw, engine).launch()
        self.shots = self.out / "screenshots"
        self.shots.mkdir(parents=True, exist_ok=True)

    def new_ctx(self, prof):
        kw = dict(viewport={"width": prof["w"], "height": prof["h"]}, device_scale_factor=prof["dpr"], locale="en-US",
                  has_touch=prof["mobile"], accept_downloads=True)
        if prof["mobile"] and self.engine != "firefox":
            kw["is_mobile"] = True
        c = self.br.new_context(**kw)
        c.add_init_script(PRINT_STUB)
        if prof.get("legacy"):
            c.add_init_script(LEGACY_STUB)
        return c

    def attach_logs(self, pg, logs):
        def on_console(m):
            if m.type != "error":
                return
            loc = m.location or {}
            t = m.text
            # Playwright WebKit denetcisi (web-inspector://) sayfaya satir ici <style> ekler; urunun CSP ihlali degildir.
            if str(loc.get("url", "")).startswith("web-inspector://") or (self.engine == "webkit" and ("Refused to apply a stylesheet" in t or ("CSP ihlali: style-src-elem" in t and "kaynak=:" in t))):
                return
            logs.append(f"console.error: {t} @ {loc.get('url', '')}:{loc.get('lineNumber', '')}")
        pg.on("console", on_console)
        pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
        pg.on("response", lambda r: logs.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)
        pg.on("requestfailed", lambda r: logs.append(f"requestfailed {r.url} {r.failure}") if not self.offline_now else None)

    offline_now = False

    # ---- adim yurutucu ----
    def step(self, pg, s, last):
        if "goto" in s:
            pg.evaluate("h => { location.hash = h; }", s["goto"])
        if "select" in s:
            pg.select_option(s["select"][0], s["select"][1], timeout=8000)
        if "click" in s:
            if not s.get("rapid"):
                gap = time.time() - last[0]
                if gap < 0.9:
                    time.sleep(0.9 - gap)
            sels = s["click"] if isinstance(s["click"], list) else [s["click"]]
            pick = next((x for x in sels if pg.locator(x).first.is_visible()), sels[0])
            pg.click(pick, timeout=8000)
            last[0] = time.time()
        if "wait" in s:
            pg.wait_for_selector(s["wait"], state="attached", timeout=8000)
        if "waitGone" in s:
            pg.wait_for_selector(s["waitGone"], state="detached", timeout=8000)
        if "sleep" in s:
            pg.wait_for_timeout(s["sleep"])

    def layout(self, pg, app):
        r = pg.evaluate(CHECKS_JS, {"main": app["main"]})
        for _ in range(4):  # gec cizim payi: bos gorunuyorsa yeniden bak
            if not r["blank"]["blank"]:
                break
            pg.wait_for_timeout(1000)
            r = pg.evaluate(CHECKS_JS, {"main": app["main"]})
        return r

    def run_app(self, prof, app):
        eng, pname, aid = self.engine, prof["name"], app["name"]
        tag = f"{eng}-{prof['id']}-{app['id']}"
        repro = repro_text(app, pname, eng, self.res.env)
        ctx = self.new_ctx(prof)
        pg = ctx.new_page()
        pg.set_default_timeout(8000)
        logs = []
        self.offline_now = False
        self.attach_logs(pg, logs)
        agg = {}  # denetim -> [(durum, ayrinti)]
        last = [0.0]
        journey_err, shot_first, nshots = None, None, 0

        def add_agg(label, summ):
            for k, (st, d) in summ.items():
                agg.setdefault(k, []).append((st, f"[{label}] {d}" if d else ""))

        try:
            pg.goto(f"{self.base}{app['dir']}/", wait_until="load", timeout=20000)
            for s in app["journey"]:
                try:
                    self.step(pg, s, last)
                    if s.get("check"):
                        if self.engine != "firefox" or True:
                            pass
                        add_agg(s["label"], summarize_checks(self.layout(pg, app)))
                    if s.get("shot"):
                        p = self.shots / f"{tag}-{s['shot']}.png"
                        pg.screenshot(path=str(p), scale="css")
                        nshots += 1
                        if nshots == 2 or shot_first is None:
                            shot_first = p
                except Exception as e:
                    journey_err = f"'{s.get('label')}' adimi: {short_err(e)}"
                    p = self.shots / f"{tag}-HATA.png"
                    try:
                        pg.screenshot(path=str(p))
                        add_agg(s.get("label", "?"), summarize_checks(self.layout(pg, app)))
                    except Exception:
                        pass
                    shot_first = p
                    break
        except Exception as e:
            journey_err = f"sayfa acilamadi: {str(e).splitlines()[0][:200]}"
        rel = lambda p: str(pathlib.Path(p).relative_to(self.out)) if p else None
        self.res.add(eng, pname, aid, "Ana yolculuk", KALDI if journey_err else GECTI, journey_err or "", rel(shot_first), repro)
        for k in ("Boş ekran", "Yatay taşma", "Kırpılmış metin", "Dokunma hedefi 44px"):
            if k == "Dokunma hedefi 44px" and prof["group"] == "desktop":
                self.res.add(eng, pname, aid, k, ATLANDI, "masaüstünde uygulanmaz", None, repro)
                continue
            rows = agg.get(k, [])
            if not rows:
                self.res.add(eng, pname, aid, k, ATLANDI, "yolculuk bu ekrana ulaşmadı", None, repro)
                continue
            st = KALDI if any(r[0] == KALDI for r in rows) else UYARI if any(r[0] == UYARI for r in rows) else GECTI
            self.res.add(eng, pname, aid, k, st, " | ".join(r[1] for r in rows if r[1])[:1500], rel(shot_first), repro)

        if journey_err:
            self.res.add(eng, pname, aid, "Veri kalıcılığı", ATLANDI, "yolculuk tamamlanmadı", None, repro)
            self.res.add(eng, pname, aid, "Çevrimdışı açılış", ATLANDI, "yolculuk tamamlanmadı", None, repro)
        else:
            self.persistence(ctx, pg, app, prof, repro, last)
            self.offline(ctx, pg, app, prof, repro)
        errs = sorted(set(logs))
        errs = [e for e in errs if "favicon" not in e]
        self.res.add(eng, pname, aid, "Konsol hataları", KALDI if errs else GECTI, " | ".join(errs)[:1500], None, repro)
        if prof.get("print"):
            self.printing(pg, ctx, app, prof, repro, last)
        ctx.close()

    def persistence(self, ctx, pg, app, prof, repro, last):
        eng, pname, aid, cfg = self.engine, prof["name"], app["name"], app["persistence"]
        try:
            pre = pg.inner_text(cfg["probe"]).strip()
            for s in cfg["steps"]:
                try:
                    self.step(pg, s, last)
                except Exception as e:
                    self.res.add(eng, pname, aid, "Ana eylem erişilebilir", KALDI, f"{cfg['label']}: {short_err(e)}", None, repro)
                    self.res.add(eng, pname, aid, "Veri kalıcılığı", ATLANDI, "ana eylem yapılamadığı için sınanamadı", None, repro)
                    return
            self.res.add(eng, pname, aid, "Ana eylem erişilebilir", GECTI, "", None, repro)
            before = pg.inner_text(cfg["probe"]).strip()
            for _ in range(12):  # ekran guncellemesi gecikebilir: metin degisene kadar bekle
                if before != pre:
                    break
                pg.wait_for_timeout(500)
                before = pg.inner_text(cfg["probe"]).strip()
            pg.reload(wait_until="load")
            pg.wait_for_selector(cfg["ready"], state="attached", timeout=8000)
            pg.wait_for_timeout(500)
            after = pg.inner_text(cfg["probe"]).strip()
            ok = before == after and len(after) > 0
            self.res.add(eng, pname, aid, "Veri kalıcılığı", GECTI if ok else KALDI,
                         "" if ok else f"{cfg['label']}: yenileme öncesi/sonrası metin farklı. önce={before[:120]!r} sonra={after[:120]!r}", None, repro)
        except Exception as e:
            self.res.add(eng, pname, aid, "Veri kalıcılığı", KALDI, f"{cfg['label']}: {short_err(e)}", None, repro)

    def offline(self, ctx, pg, app, prof, repro):
        eng, pname, aid = self.engine, prof["name"], app["name"]
        try:
            pg.evaluate("navigator.serviceWorker.ready.then(function(){return 1})")
            pg.reload(wait_until="load")
            pg.wait_for_timeout(600)
            controlled = pg.evaluate("!!navigator.serviceWorker.controller")
            self.offline_now = True
            self.server.stop()  # gercek cevrimdisi: sunucu kapali, tek kaynak service worker onbellegi
            pg.reload(wait_until="load", timeout=15000)
            pg.wait_for_selector(app["offline"]["ready"], state="attached", timeout=10000)
            res = self.layout(pg, app)
            ok = not res["blank"]["blank"]
            p = self.shots / f"{eng}-{prof['id']}-{app['id']}-cevrimdisi.png"
            pg.screenshot(path=str(p), scale="css")
            self.res.add(eng, pname, aid, "Çevrimdışı açılış", GECTI if ok else KALDI,
                         "" if ok else "sunucu kapalıyken ana ekran boş", str(p.relative_to(self.out)), repro)
            if not controlled:
                self.res.rows[-1]["detail"] += " (not: sayfa sw denetiminde değildi)"
        except Exception as e:
            self.res.add(eng, pname, aid, "Çevrimdışı açılış", KALDI, f"sunucu kapalıyken açılamadı: {str(e).splitlines()[0][:200]}", None, repro)
        finally:
            self.offline_now = False
            self.server.start()

    def printing(self, pg, ctx, app, prof, repro, last):
        eng, pname, aid = self.engine, prof["name"], app["name"]
        if eng != "chromium":
            self.res.add(eng, pname, aid, "Yazdırma sayfa sayısı", ATLANDI, "page.pdf yalnızca Chromium'da var; iOS yazdırma için gerçek cihaz gerekir", None, repro)
            return
        from pypdf import PdfReader
        prn = []
        for pr in app.get("print", []):
            try:
                pg.goto(f"{self.base}{app['dir']}/", wait_until="load")
                pg.wait_for_selector(app["offline"]["ready"], state="attached", timeout=8000)
                for s in pr["steps"]:
                    self.step(pg, s, last)
                printed = pg.evaluate("window.__printed")
                pg.emulate_media(media="print")
                counts = {}
                for name, kw in PAPERS:
                    if name in pr.get("papers", [n for n, _ in PAPERS]):
                        counts[name] = len(PdfReader(io.BytesIO(pg.pdf(**kw))).pages)
                pg.emulate_media(media="screen")
                bad = {k: v for k, v in counts.items() if v != pr["pages"]}
                prn.append((KALDI if bad or not printed else GECTI, f"{pr['label']}: beklenen {pr['pages']} sayfa; ölçülen {counts}" + ("" if printed else " (window.print çağrılmadı)")))
            except Exception as e:
                prn.append((KALDI, f"{pr['label']}: {str(e).splitlines()[0][:200]}"))
        bad = [d for st, d in prn if st == KALDI]
        self.res.add(eng, pname, aid, "Yazdırma sayfa sayısı", KALDI if bad else GECTI, " | ".join(bad), None, repro)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True, choices=["chromium", "firefox", "webkit"])
    ap.add_argument("--apps", default="")
    ap.add_argument("--profiles", default="")
    ap.add_argument("--out", default="qa-out/web")
    ap.add_argument("--runner", default="ubuntu-latest")
    ap.add_argument("--env", default=ENV_MASAUSTU)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    apps = load_apps([x for x in a.apps.split(",") if x])
    profs = load_profiles([x for x in a.profiles.split(",") if x])
    res = Results(a.env, a.runner, out / "results.json")
    t0 = time.time()
    try:
        with sync_playwright() as pw, static_server(obj=True) as server:
            r = Runner(pw, a.engine, out, res, server)
            for prof in profs:
                if prof.get("engines") and a.engine not in prof["engines"]:
                    continue
                for app in apps:
                    r.run_app(prof, app)
            r.br.close()
    except Exception as e:
        print("ALTYAPI HATASI:", e, file=sys.stderr)
        return 2
    (out / "meta.json").write_text(json.dumps({"engine": a.engine, "seconds": round(time.time() - t0), "versions": {x["id"]: app_version(x) for x in apps}}), encoding="utf-8")
    print(f"BITTI {round(time.time() - t0)} sn, {len(res.rows)} satir")
    return 0


if __name__ == "__main__":
    sys.exit(main())
