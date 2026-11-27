"""Driver-independent journey runner (iOS Safari via Appium/Selenium and Android Chrome via DevTools).
Driver interface: get(url), reload(), js(expr_or_fn, arg=None) -> value, shot(path), console_errors() -> list|None.
Clicks use js by default; a driver may define click(selector) for a real touch."""
import json, pathlib, re, time
from qa_common import *  # noqa

PICK_JS = "(function(sels){for(var i=0;i<sels.length;i++){var e=document.querySelector(sels[i]);if(e){var r=e.getBoundingClientRect();if(r.width>0&&r.height>0)return sels[i];}}return null;})"
EXISTS_JS = "(function(s){return !!document.querySelector(s);})"
CLICK_JS = "(function(s){var e=document.querySelector(s);if(!e)return 'yok';e.scrollIntoView({block:'center'});e.click();return 'ok';})"
TEXT_JS = "(function(s){var e=document.querySelector(s);return e?(e.innerText||'').trim():null;})"


def poll(drv, sel, present=True, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if bool(drv.js(EXISTS_JS, sel)) == present:
            return True
        time.sleep(0.25)
    raise TimeoutError(f"{'expected element' if present else 'expected element to disappear'}: {sel}")


def do_step(drv, s, last):
    if "goto" in s:
        drv.js("(function(h){location.hash=h;return 1;})", s["goto"])
    if "select" in s:
        drv.js("(function(a){var e=document.querySelector(a[0]);e.value=a[1];e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 1;})", s["select"])
    if "click" in s:
        if not s.get("rapid"):
            gap = time.time() - last[0]
            if gap < 0.9:
                time.sleep(0.9 - gap)
        sels = s["click"] if isinstance(s["click"], list) else [s["click"]]
        pick = drv.js(PICK_JS, sels) or sels[0]
        if hasattr(drv, "click"):
            drv.click(pick)
        else:
            if drv.js(CLICK_JS, pick) != "ok":
                raise RuntimeError(f"element to click not found: {pick}")
        last[0] = time.time()
    if "wait" in s:
        poll(drv, s["wait"], True)
    if "waitGone" in s:
        poll(drv, s["waitGone"], False)
    if "sleep" in s:
        time.sleep(s["sleep"] / 1000)


def run_generic(drv, app, base, res, engine, profile, shots_dir, *, offline_note, desktop=False, console_note=None, server=None):
    """Main journey + layout checks + persistence (+ console if readable) + offline. res: Results."""
    shots_dir = pathlib.Path(shots_dir)
    shots_dir.mkdir(parents=True, exist_ok=True)
    out_dir = res.outfile.parent
    tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"{engine}-{profile}-{app['id']}")
    repro = repro_text(app, profile, engine, res.env, "Open the same address in the browser on the device.")
    agg, journey_err, last, nshots, shot_main = {}, None, [0.0], 0, None
    rel = lambda p: str(pathlib.Path(p).relative_to(out_dir)) if p else None
    drv.get(app_url(app, base))
    time.sleep(2.0)

    def layout():
        r = drv.js(CHECKS_JS, {"main": app["main"]})
        for _ in range(4):  # slow devices may paint late: look again if the screen seems blank
            if not r["blank"]["blank"]:
                break
            time.sleep(1.0)
            r = drv.js(CHECKS_JS, {"main": app["main"]})
        return r

    def add_agg(label, summ):
        for k, (st, d) in summ.items():
            agg.setdefault(k, []).append((st, f"[{label}] {d}" if d else ""))

    # The first launch can be slow (new origin, service worker install, resume): wait up to 30 s for the first
    # screen, reload once if it does not appear. If still missing, the address and page text go into the log.
    first = app["journey"][0].get("wait") if app.get("journey") else None
    if first:
        try:
            poll(drv, first, True, timeout=30.0)
        except TimeoutError:
            print(f"[INFRA] first screen did not appear within 30 s; reloading the page", flush=True)
            drv.get(app_url(app, base))
            try:
                poll(drv, first, True, timeout=30.0)
            except TimeoutError:
                try:
                    state = drv.js("(function(){return location.href+' | '+(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,160);})")
                    print(f"[INFRA] first screen still missing: {state}", flush=True)
                except Exception:
                    pass

    for s in app["journey"]:
        try:
            do_step(drv, s, last)
            if s.get("check"):
                add_agg(s.get("label", "step"), summarize_checks(layout()))
            if s.get("shot"):
                p = shots_dir / f"{tag}-{s['shot']}.png"
                drv.shot(str(p))
                nshots += 1
                if nshots == 2 or shot_main is None:
                    shot_main = p
        except Exception as e:
            journey_err = f"Step '{s.get('label')}': {str(e).splitlines()[0][:200]}"
            p = shots_dir / f"{tag}-ERROR.png"
            try:
                drv.shot(str(p))
                shot_main = p
                add_agg(s.get("label", "?"), summarize_checks(layout()))
            except Exception:
                pass
            break
    res.add(engine, profile, app["name"], "Main journey", FAILED if journey_err else PASSED, journey_err or "", rel(shot_main), repro)
    for k in ("Blank screen", "Horizontal overflow", "Clipped text", "Touch target 44px"):
        rows = agg.get(k, [])
        if not rows:
            res.add(engine, profile, app["name"], k, SKIPPED, "the journey did not reach this screen", None, repro)
            continue
        st = FAILED if any(r[0] == FAILED for r in rows) else WARNING if any(r[0] == WARNING for r in rows) else PASSED
        res.add(engine, profile, app["name"], k, st, " | ".join(r[1] for r in rows if r[1])[:1500], rel(shot_main), repro)
    # persistence (only when configured)
    cfg = app.get("persistence")
    if not cfg:
        res.add(engine, profile, app["name"], "Data persistence", SKIPPED, "no persistence steps in config.json (optional)", None, repro)
    elif journey_err:
        res.add(engine, profile, app["name"], "Data persistence", SKIPPED, "journey did not complete", None, repro)
    else:
        try:
            pre = drv.js(TEXT_JS, cfg["probe"]) or ""
            for s in cfg["steps"]:
                try:
                    do_step(drv, s, last)
                except Exception as e:
                    res.add(engine, profile, app["name"], "Primary action reachable", FAILED, f"{cfg['label']}: {str(e).splitlines()[0][:200]}", None, repro)
                    res.add(engine, profile, app["name"], "Data persistence", SKIPPED, "not tested because the primary action could not be performed", None, repro)
                    raise StopIteration
            res.add(engine, profile, app["name"], "Primary action reachable", PASSED, "", None, repro)
            before = drv.js(TEXT_JS, cfg["probe"]) or ""
            for _ in range(12):  # slow devices may update the screen late: wait until the text changes
                if before != pre:
                    break
                time.sleep(0.5)
                before = drv.js(TEXT_JS, cfg["probe"]) or ""
            drv.reload()
            time.sleep(1.5)
            poll(drv, cfg["ready"], True, 12)
            time.sleep(0.5)
            after = drv.js(TEXT_JS, cfg["probe"]) or ""
            ok = before == after and after != ""
            res.add(engine, profile, app["name"], "Data persistence", PASSED if ok else FAILED,
                    "" if ok else f"{cfg['label']}: text differs after reload. before={before[:100]!r} after={after[:100]!r}", None, repro)
        except StopIteration:
            pass
        except Exception as e:
            res.add(engine, profile, app["name"], "Data persistence", FAILED, f"{cfg['label']}: {str(e).splitlines()[0][:200]}", None, repro)
    errs = drv.console_errors()
    if errs is None:
        res.add(engine, profile, app["name"], "Console errors", SKIPPED, console_note or "this driver cannot read the console", None, repro)
    else:
        errs = sorted(set(e for e in errs if "favicon" not in e))
        res.add(engine, profile, app["name"], "Console errors", FAILED if errs else PASSED, " | ".join(errs)[:1500], None, repro)
    try:
        detected = drv.js(PWA_JS)
    except Exception:
        detected = False
    if not offline_possible(app):
        res.add(engine, profile, app["name"], "Offline launch", SKIPPED, "live URL: the offline test needs the app folder to be served from this repository (use \"path\" in config.json)", None, repro)
    elif not is_pwa(app, detected):
        res.add(engine, profile, app["name"], "Offline launch", SKIPPED, "not a PWA (no manifest link or service worker found)", None, repro)
    elif server is not None and not journey_err:
        try:
            drv.reload()
            time.sleep(1.0)
            ctl = False
            for _ in range(30):
                if drv.js("(function(){return !!(navigator.serviceWorker && navigator.serviceWorker.controller);})"):
                    ctl = True
                    break
                time.sleep(0.5)
            server.stop()  # real offline: server stopped; the only source is the service worker cache
            try:
                drv.reload()
                time.sleep(2.0)
                poll(drv, app["offline"]["ready"], True, 12)
                r = layout()
                ok = not r["blank"]["blank"]
                p = shots_dir / f"{tag}-offline.png"
                drv.shot(str(p))
                res.add(engine, profile, app["name"], "Offline launch", PASSED if ok else FAILED,
                        ("" if ok else "home screen is blank while the server is stopped") + ("" if ctl else " (note: the page was not controlled by a service worker)"), rel(p), repro)
            finally:
                server.start()
        except Exception as e:
            res.add(engine, profile, app["name"], "Offline launch", FAILED, f"could not open while the server was stopped: {str(e).splitlines()[0][:200]}", None, repro)
    else:
        res.add(engine, profile, app["name"], "Offline launch", SKIPPED, offline_note if not journey_err else "journey did not complete", None, repro)
    if app.get("print"):
        res.add(engine, profile, app["name"], "Print page count", SKIPPED, "PDF page count cannot be measured from a mobile browser", None, repro)
