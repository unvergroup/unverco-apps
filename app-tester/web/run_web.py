#!/usr/bin/env python3
"""Web QA with Playwright: for every device profile, the main journey plus the shared checks.
Usage: python app-tester/web/run_web.py --engine chromium [--profiles iphone,desktop] [--out qa-out/web-chromium]
Exit code: 0 (tests ran; FAILED rows are evaluated in the report step), 2 (infrastructure error)."""
import argparse, io, json, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
from qa_common import *  # noqa
from playwright.sync_api import sync_playwright

PRINT_STUB = ("window.__printed = 0; window.print = function () { window.__printed += 1; };"
              "document.addEventListener('securitypolicyviolation', function (e) { console.error('CSP violation: ' + e.violatedDirective + ' blocked=' + e.blockedURI + ' sample=' + (e.sample || '') + ' source=' + e.sourceFile + ':' + e.lineNumber); }, true);")
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
        return c

    def attach_logs(self, pg, logs):
        def on_console(m):
            if m.type != "error":
                return
            loc = m.location or {}
            t = m.text
            # The Playwright WebKit inspector (web-inspector://) injects inline <style>; this is not a CSP violation of the app.
            if str(loc.get("url", "")).startswith("web-inspector://") or (self.engine == "webkit" and ("Refused to apply a stylesheet" in t or ("CSP violation: style-src-elem" in t and "source=:" in t))):
                return
            logs.append(f"console.error: {t} @ {loc.get('url', '')}:{loc.get('lineNumber', '')}")
        pg.on("console", on_console)
        pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
        pg.on("response", lambda r: logs.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)
        pg.on("requestfailed", lambda r: logs.append(f"requestfailed {r.url} {r.failure}") if not self.offline_now else None)

    offline_now = False

    # ---- step runner ----
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
        for _ in range(4):  # allow late paint: look again if blank
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
        agg = {}  # check -> [(status, detail)]
        last = [0.0]
        journey_err, shot_first, nshots = None, None, 0

        def add_agg(label, summ):
            for k, (st, d) in summ.items():
                agg.setdefault(k, []).append((st, f"[{label}] {d}" if d else ""))

        try:
            pg.goto(app_url(app, self.base), wait_until="load", timeout=20000)
            for s in app["journey"]:
                try:
                    self.step(pg, s, last)
                    if s.get("check"):
                        add_agg(s.get("label", "step"), summarize_checks(self.layout(pg, app)))
                    if s.get("shot"):
                        p = self.shots / f"{tag}-{s['shot']}.png"
                        pg.screenshot(path=str(p), scale="css")
                        nshots += 1
                        if nshots == 2 or shot_first is None:
                            shot_first = p
                except Exception as e:
                    journey_err = f"Step '{s.get('label')}': {short_err(e)}"
                    p = self.shots / f"{tag}-ERROR.png"
                    try:
                        pg.screenshot(path=str(p))
                        add_agg(s.get("label", "?"), summarize_checks(self.layout(pg, app)))
                    except Exception:
                        pass
                    shot_first = p
                    break
        except Exception as e:
            journey_err = f"page could not be opened: {str(e).splitlines()[0][:200]}"
        rel = lambda p: str(pathlib.Path(p).relative_to(self.out)) if p else None
        self.res.add(eng, pname, aid, "Main journey", FAILED if journey_err else PASSED, journey_err or "", rel(shot_first), repro)
        for k in ("Blank screen", "Horizontal overflow", "Clipped text", "Touch target 44px"):
            if k == "Touch target 44px" and prof["group"] == "desktop":
                self.res.add(eng, pname, aid, k, SKIPPED, "not applicable on desktop", None, repro)
                continue
            rows = agg.get(k, [])
            if not rows:
                self.res.add(eng, pname, aid, k, SKIPPED, "the journey did not reach this screen", None, repro)
                continue
            st = FAILED if any(r[0] == FAILED for r in rows) else WARNING if any(r[0] == WARNING for r in rows) else PASSED
            self.res.add(eng, pname, aid, k, st, " | ".join(r[1] for r in rows if r[1])[:1500], rel(shot_first), repro)

        if journey_err:
            self.res.add(eng, pname, aid, "Data persistence", SKIPPED, "journey did not complete", None, repro)
            self.res.add(eng, pname, aid, "Offline launch", SKIPPED, "journey did not complete", None, repro)
        else:
            if app.get("persistence"):
                self.persistence(ctx, pg, app, prof, repro, last)
            else:
                self.res.add(eng, pname, aid, "Data persistence", SKIPPED, "no persistence steps in config.json (optional)", None, repro)
            self.offline(ctx, pg, app, prof, repro)
        errs = sorted(set(logs))
        errs = [e for e in errs if "favicon" not in e]
        self.res.add(eng, pname, aid, "Console errors", FAILED if errs else PASSED, " | ".join(errs)[:1500], None, repro)
        if prof.get("print") and app.get("print"):
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
                    self.res.add(eng, pname, aid, "Primary action reachable", FAILED, f"{cfg['label']}: {short_err(e)}", None, repro)
                    self.res.add(eng, pname, aid, "Data persistence", SKIPPED, "not tested because the primary action could not be performed", None, repro)
                    return
            self.res.add(eng, pname, aid, "Primary action reachable", PASSED, "", None, repro)
            before = pg.inner_text(cfg["probe"]).strip()
            for _ in range(12):  # the screen may update late: wait until the text changes
                if before != pre:
                    break
                pg.wait_for_timeout(500)
                before = pg.inner_text(cfg["probe"]).strip()
            pg.reload(wait_until="load")
            pg.wait_for_selector(cfg["ready"], state="attached", timeout=8000)
            pg.wait_for_timeout(500)
            after = pg.inner_text(cfg["probe"]).strip()
            ok = before == after and len(after) > 0
            self.res.add(eng, pname, aid, "Data persistence", PASSED if ok else FAILED,
                         "" if ok else f"{cfg['label']}: text differs before/after reload. before={before[:120]!r} after={after[:120]!r}", None, repro)
        except Exception as e:
            self.res.add(eng, pname, aid, "Data persistence", FAILED, f"{cfg['label']}: {short_err(e)}", None, repro)

    def offline(self, ctx, pg, app, prof, repro):
        eng, pname, aid = self.engine, prof["name"], app["name"]
        if not offline_possible(app):
            self.res.add(eng, pname, aid, "Offline launch", SKIPPED, "live URL: the offline test needs the app folder to be served from this repository (use \"path\" in config.json)", None, repro)
            return
        try:
            detected = pg.evaluate(PWA_JS)
        except Exception:
            detected = False
        if not is_pwa(app, detected):
            self.res.add(eng, pname, aid, "Offline launch", SKIPPED, "not a PWA (no manifest link or service worker found)", None, repro)
            return
        stopped = False
        try:
            has_sw = pg.evaluate("navigator.serviceWorker ? navigator.serviceWorker.getRegistration().then(function(r){return !!r;}) : false")
            if not has_sw:
                self.res.add(eng, pname, aid, "Offline launch", FAILED, "no service worker is registered, so the app cannot open offline", None, repro)
                return
            pg.evaluate("navigator.serviceWorker.ready.then(function(){return 1})")
            pg.reload(wait_until="load")
            pg.wait_for_timeout(600)
            controlled = pg.evaluate("!!navigator.serviceWorker.controller")
            self.offline_now = True
            stopped = True
            self.server.stop()  # real offline: server stopped, the only source is the service worker cache
            pg.reload(wait_until="load", timeout=15000)
            pg.wait_for_selector(app["offline"]["ready"], state="attached", timeout=10000)
            res = self.layout(pg, app)
            ok = not res["blank"]["blank"]
            p = self.shots / f"{eng}-{prof['id']}-{app['id']}-offline.png"
            pg.screenshot(path=str(p), scale="css")
            self.res.add(eng, pname, aid, "Offline launch", PASSED if ok else FAILED,
                         "" if ok else "home screen is blank while the server is stopped", str(p.relative_to(self.out)), repro)
            if not controlled:
                self.res.rows[-1]["detail"] += " (note: the page was not controlled by a service worker)"
        except Exception as e:
            self.res.add(eng, pname, aid, "Offline launch", FAILED, f"could not open while the server was stopped: {str(e).splitlines()[0][:200]}", None, repro)
        finally:
            self.offline_now = False
            if stopped:
                self.server.start()

    def printing(self, pg, ctx, app, prof, repro, last):
        eng, pname, aid = self.engine, prof["name"], app["name"]
        if eng != "chromium":
            self.res.add(eng, pname, aid, "Print page count", SKIPPED, "page.pdf is only available in Chromium; iOS printing cannot be measured here", None, repro)
            return
        from pypdf import PdfReader
        prn = []
        for pr in app.get("print", []):
            try:
                counts, printed = {}, 1
                # The print flow restarts for every paper size: after the first PDF the app may clean up its print
                # markup on afterprint (correct behavior); a second pdf() on the same page would print the whole app.
                for name, kw in PAPERS:
                    if name not in pr.get("papers", [n for n, _ in PAPERS]): continue
                    pg.goto(app_url(app, self.base), wait_until="load")
                    pg.wait_for_selector(app["offline"]["ready"], state="attached", timeout=8000)
                    pg.emulate_media(media="screen")
                    for s in pr["steps"]:
                        self.step(pg, s, last)
                    printed = min(printed, pg.evaluate("window.__printed"))
                    pg.emulate_media(media="print")
                    counts[name] = len(PdfReader(io.BytesIO(pg.pdf(**kw))).pages)
                pg.emulate_media(media="screen")
                bad = {k: v for k, v in counts.items() if v != pr["pages"]}
                prn.append((FAILED if bad or not printed else PASSED, f"{pr['label']}: expected {pr['pages']} pages; measured {counts}" + ("" if printed else " (window.print was not called)")))
            except Exception as e:
                prn.append((FAILED, f"{pr['label']}: {str(e).splitlines()[0][:200]}"))
        bad = [d for st, d in prn if st == FAILED]
        self.res.add(eng, pname, aid, "Print page count", FAILED if bad else PASSED, " | ".join(bad), None, repro)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True, choices=["chromium", "firefox", "webkit"])
    ap.add_argument("--profiles", default="")
    ap.add_argument("--out", default="qa-out/web")
    ap.add_argument("--runner", default="ubuntu-latest")
    ap.add_argument("--env", default=ENV_DESKTOP)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    apps = load_apps()
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
        print("INFRA ERROR:", e, file=sys.stderr)
        return 2
    (out / "meta.json").write_text(json.dumps({"engine": a.engine, "seconds": round(time.time() - t0), "app": apps[0]["name"]}), encoding="utf-8")
    print(f"DONE {round(time.time() - t0)} s, {len(res.rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
