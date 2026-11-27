#!/usr/bin/env python3
"""iOS Simulatoru + Mobile Safari, Appium 2 + XCUITest (WebDriverAgent). Ortak denetimler (qa/lib/generic_driver.py):
acilis, ana yolculuk, ana eylem, yenileme sonrasi kalicilik, yatay ekran, tasma, konsol (safariConsole), cevrimdisi.
Cikis: 0 calisti, 2 altyapi (Appium/WDA kurulamadi; urun hatasi degil)."""
import argparse, json, pathlib, re, subprocess, sys, time, traceback, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
from qa_common import *  # noqa
from generic_driver import run_generic

def sh(cmd, check=True, timeout=300):
    print("$", cmd, flush=True)
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    if r.stdout.strip(): print(r.stdout.strip()[-1200:], flush=True)
    if r.stderr.strip(): print(r.stderr.strip()[-600:], flush=True)
    if check and r.returncode: raise RuntimeError(f"komut basarisiz ({r.returncode}): {cmd}")
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
    if not c: raise RuntimeError(f"simulator yok: {want}")
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
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="qa-out/ios-sim"); ap.add_argument("--apps", default="")
    ap.add_argument("--device", default="iPhone 16"); ap.add_argument("--wda-cache", default=str(pathlib.Path.home() / "wda-derived"))
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    apps = load_apps([x for x in a.apps.split(",") if x])
    res = Results(ENV_SIM, "macos", out / "results.json")
    dev = pick_device(a.device)
    label = f"{dev['name']} (iOS {dev['ios']} simülatör)"
    log = open(out / "appium.log", "w")
    srv = subprocess.Popen(["appium", "--port", "4723", "--log-no-colors"], stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(300):
            try: urllib.request.urlopen("http://127.0.0.1:4723/status", timeout=2); break
            except Exception: time.sleep(1)
        else: raise RuntimeError("Appium sunucusu baslamadi")
        print("ALTYAPI-SURE Appium sunucusu hazir", flush=True)
        t0 = time.time()
        sh(f"xcrun simctl boot {dev['udid']}", check=False); sh(f"xcrun simctl bootstatus {dev['udid']} -b", timeout=900)
        print(f"ALTYAPI-SURE simulator acilis: {time.time()-t0:.0f} sn", flush=True)
        from appium import webdriver
        from appium.options.ios import XCUITestOptions
        o = XCUITestOptions()
        o.platform_name = "iOS"; o.browser_name = "Safari"
        o.set_capability("appium:deviceName", dev["name"]); o.set_capability("appium:platformVersion", dev["ios"])
        o.set_capability("appium:udid", dev["udid"]); o.set_capability("appium:derivedDataPath", a.wda_cache)
        o.set_capability("appium:wdaLaunchTimeout", 600000); o.set_capability("appium:wdaConnectionTimeout", 600000)
        o.set_capability("appium:newCommandTimeout", 600); o.set_capability("appium:safariIgnoreFraudWarning", True)
        o.set_capability("appium:autoAcceptAlerts", True)
        # Onbellekte derlenmis WDA varsa yeniden derleme (xcodebuild) yapma: ~9 dk -> ~1 dk
        prebuilt = bool(list(pathlib.Path(a.wda_cache).glob("Build/Products/*.xctestrun")))
        print(f"ALTYAPI WDA onbellek: {'var, derlemesiz baslatma' if prebuilt else 'yok, derlenecek'}", flush=True)

        def oturum(hazir):
            o.set_capability("appium:usePrebuiltWDA", hazir)
            t1 = time.time()
            dd = webdriver.Remote("http://127.0.0.1:4723", options=o)
            print(f"ALTYAPI-SURE Appium oturumu (usePrebuiltWDA={hazir}): {time.time()-t1:.0f} sn", flush=True)
            return dd

        try:
            d = oturum(prebuilt)
        except Exception as e:
            if not prebuilt: raise
            print(f"ALTYAPI derlemesiz baslatma olmadi ({type(e).__name__}); derleyerek yeniden deneniyor", flush=True)
            d = oturum(False)
        ua = d.execute_script("return navigator.userAgent"); print("UA:", ua, flush=True)
        with static_server(8000, obj=True) as server:
            # Yatay tur ayri origin'de (localhost): 127.0.0.1'deki kayitli veri/service worker yatay turu etkilemesin
            turlar = [(orient, prof, base, app) for orient, prof, base in
                      (("PORTRAIT", label, server.url), ("LANDSCAPE", label + " yatay", server.url.replace("127.0.0.1", "localhost")))
                      for app in apps]
            yeniden = 1  # WDA baglantisi koparsa oturum bir kez yeniden kurulur, yarim kalan tur tekrarlanir
            i = 0
            while i < len(turlar):
                orient, prof, base, app = turlar[i]
                try:
                    if d.orientation != orient: d.orientation = orient; time.sleep(2)
                    run_generic(Drv(d), app, base, res, "Mobile Safari (Appium)", prof, out / "screenshots",
                                offline_note="", console_note="safariConsole günlüğü okunamadı", server=server)
                    i += 1
                except Exception as e:
                    baglanti = any(k in repr(e) for k in ("RemoteDisconnected", "Connection aborted", "ConnectionRefused", "invalid session", "Max retries"))
                    if not (baglanti and yeniden > 0): raise
                    yeniden -= 1
                    print(f"[ALTYAPI] WDA baglantisi koptu ({type(e).__name__}); oturum yeniden kuruluyor, tur tekrarlanacak", flush=True)
                    try: d.quit()
                    except Exception: pass
                    d = oturum(bool(list(pathlib.Path(a.wda_cache).glob("Build/Products/*.xctestrun"))))
        try: d.quit()
        except Exception: pass
        (out / "meta.json").write_text(json.dumps({"engine": "ios-simulator-appium", "cihaz": dev["name"], "ios": dev["ios"], "ua": ua}, ensure_ascii=False))
        return 0
    except Exception:
        traceback.print_exc()
        print("[ALTYAPI] Appium/XCUITest oturumu kurulamadi veya kesildi; log sonu:", flush=True)
        log.flush(); print((out / "appium.log").read_text(errors="replace")[-3000:], flush=True)
        return 2
    finally:
        srv.terminate()

if __name__ == "__main__":
    sys.exit(main())
