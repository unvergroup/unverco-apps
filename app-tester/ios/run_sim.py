#!/usr/bin/env python3
"""iOS Simulator + Mobile Safari fallback. Two methods; the report says which one ran:
  A) simctl openurl + simctl io screenshot: opens the app in Mobile Safari, takes a screenshot, decides "blank screen" from the image.
  B) safaridriver (safari:useSimulator) + Selenium: runs the journey in Mobile Safari with the same layout checks (off by default).
Exit code: 0 (at least one method ran), 2 (neither ran = infrastructure error)."""
import argparse, os, json, pathlib, re, subprocess, sys, time, traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
from qa_common import *  # noqa
from generic_driver import run_generic

def sh(cmd, check=True, timeout=300):
    print("$", cmd, flush=True)
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    if r.stdout.strip(): print(r.stdout.strip()[-1500:], flush=True)
    if r.stderr.strip(): print(r.stderr.strip()[-800:], flush=True)
    if check and r.returncode: raise RuntimeError(f"command failed ({r.returncode}): {cmd}")
    return r.stdout

def pick_device():
    data = json.loads(sh("xcrun simctl list -j devices available", timeout=60))
    cands = []
    for rt, devs in data["devices"].items():
        m = re.search(r"iOS-(\d+)-(\d+)", rt)
        if not m: continue
        ver = (int(m.group(1)), int(m.group(2)))
        for d in devs:
            if d["name"].startswith("iPhone") and "SE" not in d["name"] and "Pro Max" not in d["name"] and "Plus" not in d["name"] and "Air" not in d["name"]:
                pref = 0 if re.fullmatch(r"iPhone 1[5-7]( Pro)?", d["name"]) else 1
                cands.append((ver, -pref, d["name"], d["udid"], f"{ver[0]}.{ver[1]}"))
    if not cands: raise RuntimeError("no iPhone simulator found")
    cands.sort(reverse=True)
    best = cands[0]
    return dict(name=best[2], udid=best[3], ios=best[4])

def blank_from_png(path):
    from PIL import Image
    im = Image.open(path).convert("RGB")
    w, h = im.size
    crop = im.crop((0, int(h * 0.18), w, int(h * 0.82)))
    crop.thumbnail((200, 400))
    cols = crop.quantize(colors=32).convert("RGB").getcolors(100000) or []
    total = sum(c for c, _ in cols) or 1
    top = max(c for c, _ in cols) / total
    return (len(cols) < 6 or top > 0.97), len(cols), round(top, 2)

def diff_ratio(a, b):
    """Share of changed pixels between two screenshots (did Safari really open?)."""
    from PIL import Image, ImageChops
    x, y = Image.open(a).convert("L"), Image.open(b).convert("L")
    if x.size != y.size: return 1.0
    x.thumbnail((120, 260)); y.thumbnail((120, 260))
    d = ImageChops.difference(x, y).point(lambda v: 255 if v > 24 else 0)
    return sum(1 for v in d.getdata() if v) / (d.size[0] * d.size[1])

def method_a(dev, apps, base, res, out, label):
    shots = out / "screenshots"; shots.mkdir(parents=True, exist_ok=True)
    u = dev["udid"]
    t0 = time.time()
    sh(f"xcrun simctl boot {u}", check=False)
    sh(f"xcrun simctl bootstatus {u} -b", timeout=900)
    print(f"INFRA-TIME simulator boot: {time.time()-t0:.0f} s", flush=True)
    time.sleep(5)
    home = shots / "ios-sim-home-screen.png"
    sh(f"xcrun simctl io {u} screenshot '{home}'", check=False)
    for app in apps:
        p = shots / f"ios-sim-simctl-{app['id']}-launch.png"
        repro = f"Open {app_url(app, base)} in Mobile Safari in the iOS Simulator."
        ok = False
        for attempt in (1, 2):
            sh(f"xcrun simctl openurl {u} '{app_url(app, base)}'")
            time.sleep(14 if attempt == 1 else 20)
            sh(f"xcrun simctl io {u} screenshot '{p}'")
            ratio = diff_ratio(home, p) if home.exists() else 1.0
            print(f"    Did Safari open? difference from home screen={ratio:.2f} (attempt {attempt})", flush=True)
            if ratio > 0.15: ok = True; break
        if not ok:
            res.add("Mobile Safari (simctl)", label, app["name"], "Blank screen (image analysis)", SKIPPED,
                    "Safari did not open (screen identical to the home screen): infrastructure problem, not counted as a product failure", p.relative_to(out).as_posix(), repro)
            print("[INFRA] Safari did not open after simctl openurl", flush=True)
            continue
        try:
            blank, ncol, top = blank_from_png(p)
            res.add("Mobile Safari (simctl)", label, app["name"], "Blank screen (image analysis)", FAILED if blank else PASSED,
                    f"content area colors={ncol}, dominant ratio={top}" if blank else "", p.relative_to(out).as_posix(), repro)
            print("    SCREEN", p.name, img_stats(p), flush=True)
        except Exception as e:
            res.add("Mobile Safari (simctl)", label, app["name"], "Blank screen (image analysis)", SKIPPED, f"image could not be analyzed: {e}", None, repro)

class SeleniumDrv:
    def __init__(self, d): self.d = d
    def get(self, u): self.d.get(u)
    def reload(self): self.d.refresh()
    def js(self, fn, arg=None):
        if arg is None: return self.d.execute_script(f"return ({fn})()")
        return self.d.execute_script(f"return ({fn})(arguments[0])", arg)
    def click(self, sel):
        from selenium.webdriver.common.by import By
        el = self.d.find_element(By.CSS_SELECTOR, sel)
        self.d.execute_script("arguments[0].scrollIntoView({block:'center'})", el)
        el.click()
    def shot(self, path): self.d.save_screenshot(path)
    def console_errors(self): return None

def method_b(dev, apps, base, res, out, label, server=None):
    from selenium import webdriver
    sh(f"xcrun simctl shutdown {dev['udid']}", check=False)
    sh("sudo safaridriver --enable", check=False)
    opts = webdriver.SafariOptions()
    opts.set_capability("safari:useSimulator", True)
    opts.set_capability("safari:deviceType", "iPhone")
    opts.set_capability("safari:deviceName", dev["name"])
    opts.set_capability("safari:platformVersion", dev["ios"])
    d = webdriver.Safari(options=opts)
    try:
        print("Session caps:", {k: v for k, v in d.capabilities.items() if "safari" in k or k in ("browserName", "browserVersion", "platformName")}, flush=True)
        ua = d.execute_script("return navigator.userAgent")
        print("UA:", ua, flush=True)
        for app in apps:
            run_generic(SeleniumDrv(d), app, base, res, "Mobile Safari (WebDriver)", label, out / "screenshots",
                        offline_note="offline test not available", server=server,
                        console_note="Safari WebDriver does not expose the console log")
        return ua
    finally:
        try: d.quit()
        except Exception: pass

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="qa-out/ios-sim"); 
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    apps = load_apps()
    res = Results(ENV_SIM, "macos", out / "results.json")
    meta = {"engine": "ios-simulator", "method_A_simctl": "did not run", "method_B_safaridriver": "did not run"}
    ok_any = False
    with static_server(8000, obj=True) as server:
        base = server.url
        dev = pick_device()
        label = f"{dev['name']} (iOS {dev['ios']} simulator)"
        meta.update(device=dev["name"], ios=dev["ios"])
        try:
            method_a(dev, apps, base, res, out, label); meta["method_A_simctl"] = "ran"; ok_any = True
        except Exception:
            traceback.print_exc(); meta["method_A_error"] = traceback.format_exc()[-300:]
        # Method B (safaridriver + safari:useSimulator) is NOT supported on macOS 15 / Xcode 26 runners:
        # "The 'macOS' platform is incompatible with requested capability: safari:useSimulator".
        # Off by default; set QA_SAFARIDRIVER=1 to try it.
        if os.environ.get("QA_SAFARIDRIVER") == "1":
            try:
                ua = method_b(dev, apps, base, res, out, label, server); meta["method_B_safaridriver"] = "ran"; meta["safari_ua"] = ua; ok_any = True
            except Exception:
                traceback.print_exc(); meta["method_B_error"] = traceback.format_exc()[-400:]
        else:
            meta["method_B_safaridriver"] = "not supported (safari:useSimulator is rejected on macOS runners)"
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print("META", json.dumps(meta, ensure_ascii=False))
    if not ok_any: print("[INFRA] iOS Simulator: neither method ran", flush=True)
    return 0 if ok_any else 2

if __name__ == "__main__":
    sys.exit(main())
