#!/usr/bin/env python3
"""iOS Simulator + Mobile Safari through Appium 2 + XCUITest (WebDriverAgent). Shared checks (lib/generic_driver.py):
launch, main journey, primary action, persistence after reload, landscape, overflow, console (safariConsole), offline.
Exit code: 0 ran, 2 infrastructure (Appium/WDA could not start; not a product failure)."""
import argparse, json, pathlib, re, subprocess, sys, time, traceback, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
from qa_common import *  # noqa
from generic_driver import run_generic

def sh(cmd, check=True, timeout=300):
    print("$", cmd, flush=True)
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    if r.stdout.strip(): print(r.stdout.strip()[-1200:], flush=True)
    if r.stderr.strip(): print(r.stderr.strip()[-600:], flush=True)
    if check and r.returncode: raise RuntimeError(f"command failed ({r.returncode}): {cmd}")
    return r.stdout

def pick_device(want):
    data = json.loads(sh("xcrun simctl list -j devices available", timeout=60))
    sdk = sh("xcrun --sdk iphonesimulator --show-sdk-version", check=False).strip()
    c = []
    for rt, devs in data["devices"].items():
        m = re.search(r"iOS-(\d+)-(\d+)", rt)
        if not m: continue
        v = f"{m.group(1)}.{m.group(2)}"
        for d in devs:
            if d["name"] == want:
                c.append((v == sdk, (int(m.group(1)), int(m.group(2))), d["name"], d["udid"], v))
    if not c: raise RuntimeError(f"simulator not found: {want}")
    c.sort(reverse=True)
    return dict(name=c[0][2], udid=c[0][3], ios=c[0][4])

class Drv:
    def __init__(self, d): self.d = d; self.seen = 0
    def get(self, u): self.d.get(u)
    def reload(self): self.d.refresh()
    def js(self, fn, arg=None):
        if arg is None: return self.d.execute_script(f"return ({fn})()")
        return self.d.execute_script(f"return ({fn})(arguments[0])", arg)
    def click(self, sel):
        from selenium.webdriver.common.by import By
        el = self.d.find_element(By.CSS_SELECTOR, sel)
        self.d.execute_script("arguments[0].scrollIntoView({block:'center'})", el)
        el.click()  # gercek WDA dokunusu
    def shot(self, path): self.d.save_screenshot(path)
    def console_errors(self):
        try:
            logs = self.d.get_log("safariConsole")
        except Exception:
            return None
        return [l.get("message", "")[:200] for l in logs if l.get("level") in ("SEVERE", "ERROR")]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="qa-out/ios-sim")
    ap.add_argument("--device", default="iPhone 16"); ap.add_argument("--wda-cache", default=str(pathlib.Path.home() / "wda-derived"))
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    apps = load_apps()
    res = Results(ENV_SIM, "macos", out / "results.json")
    dev = pick_device(a.device)
    label = f"{dev['name']} (iOS {dev['ios']} simulator)"
    log = open(out / "appium.log", "w")
    srv = subprocess.Popen(["appium", "--port", "4723", "--log-no-colors"], stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(300):
            try: urllib.request.urlopen("http://127.0.0.1:4723/status", timeout=2); break
            except Exception: time.sleep(1)
        else: raise RuntimeError("Appium server did not start")
        print("INFRA-TIME Appium server ready", flush=True)
        t0 = time.time()
        sh(f"xcrun simctl boot {dev['udid']}", check=False); sh(f"xcrun simctl bootstatus {dev['udid']} -b", timeout=900)
        print(f"INFRA-TIME simulator boot: {time.time()-t0:.0f} s", flush=True)
        from appium import webdriver
        from appium.options.ios import XCUITestOptions
        o = XCUITestOptions()
        o.platform_name = "iOS"; o.browser_name = "Safari"
        o.set_capability("appium:deviceName", dev["name"]); o.set_capability("appium:platformVersion", dev["ios"])
        o.set_capability("appium:udid", dev["udid"]); o.set_capability("appium:derivedDataPath", a.wda_cache)
        o.set_capability("appium:wdaLaunchTimeout", 600000); o.set_capability("appium:wdaConnectionTimeout", 600000)
        o.set_capability("appium:newCommandTimeout", 600); o.set_capability("appium:safariIgnoreFraudWarning", True)
        o.set_capability("appium:autoAcceptAlerts", True)
        # If a prebuilt WDA is cached, skip the rebuild (xcodebuild): saves several minutes
        prebuilt = bool(list(pathlib.Path(a.wda_cache).glob("Build/Products/*.xctestrun")))
        print(f"INFRA WDA cache: {'found, starting without a rebuild' if prebuilt else 'missing, will be built'}", flush=True)

        def session(ready):
            o.set_capability("appium:usePrebuiltWDA", ready)
            t1 = time.time()
            dd = webdriver.Remote("http://127.0.0.1:4723", options=o)
            print(f"INFRA-TIME Appium session (usePrebuiltWDA={ready}): {time.time()-t1:.0f} s", flush=True)
            return dd

        try:
            d = session(prebuilt)
        except Exception as e:
            if not prebuilt: raise
            print(f"INFRA start without rebuild failed ({type(e).__name__}); retrying with a build", flush=True)
            d = session(False)
        ua = d.execute_script("return navigator.userAgent"); print("UA:", ua, flush=True)
        with static_server(8000, obj=True) as server:
            # The landscape tour runs on a separate origin (localhost) so data/service workers stored on 127.0.0.1 cannot affect it
            tours = [(orient, prof, base, app) for orient, prof, base in
                      (("PORTRAIT", label, server.url), ("LANDSCAPE", label + " landscape", server.url.replace("127.0.0.1", "localhost")))
                      for app in apps]
            retries = 1  # If the WDA connection drops, the session is rebuilt once and the interrupted tour is repeated
            i = 0
            while i < len(tours):
                orient, prof, base, app = tours[i]
                try:
                    if d.orientation != orient: d.orientation = orient; time.sleep(2)
                    run_generic(Drv(d), app, base, res, "Mobile Safari (Appium)", prof, out / "screenshots",
                                offline_note="", console_note="the safariConsole log could not be read", server=server)
                    i += 1
                except Exception as e:
                    dropped = any(k in repr(e) for k in ("RemoteDisconnected", "Connection aborted", "ConnectionRefused", "invalid session", "Max retries"))
                    if not (dropped and retries > 0): raise
                    retries -= 1
                    print(f"[INFRA] WDA connection dropped ({type(e).__name__}); rebuilding the session, the tour will be repeated", flush=True)
                    try: d.quit()
                    except Exception: pass
                    d = session(bool(list(pathlib.Path(a.wda_cache).glob("Build/Products/*.xctestrun"))))
        try: d.quit()
        except Exception: pass
        (out / "meta.json").write_text(json.dumps({"engine": "ios-simulator-appium", "device": dev["name"], "ios": dev["ios"], "ua": ua}, ensure_ascii=False))
        return 0
    except Exception:
        traceback.print_exc()
        print("[INFRA] The Appium/XCUITest session could not start or was interrupted; log tail:", flush=True)
        log.flush(); print((out / "appium.log").read_text(errors="replace")[-3000:], flush=True)
        return 2
    finally:
        srv.terminate()

if __name__ == "__main__":
    sys.exit(main())
