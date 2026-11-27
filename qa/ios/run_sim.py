#!/usr/bin/env python3
"""Gercek iOS Simulatoru + Mobile Safari. Iki yontem, hangisinin calistigi rapora yazilir:
  A) simctl openurl + simctl io screenshot: iki uygulamayi Mobile Safari'de acar, ekran goruntusu alir, bos ekran karari goruntuden verir.
  B) safaridriver (safari:useSimulator) + Selenium: yolculugu Mobile Safari'de surer, ayni yerlesim denetimlerini calistirir.
Cikis kodu: 0 (en az bir yontem calisti), 2 (ikisi de calismadi = altyapi hatasi)."""
import argparse, json, pathlib, re, subprocess, sys, time, traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
from qa_common import *  # noqa
from generic_driver import run_generic

def sh(cmd, check=True, timeout=300):
    print("$", cmd, flush=True)
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    if r.stdout.strip(): print(r.stdout.strip()[-1500:], flush=True)
    if r.stderr.strip(): print(r.stderr.strip()[-800:], flush=True)
    if check and r.returncode: raise RuntimeError(f"komut basarisiz ({r.returncode}): {cmd}")
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
    if not cands: raise RuntimeError("iPhone simulatoru bulunamadi")
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
    """Iki ekran goruntusu arasindaki degisen piksel orani (Safari gercekten acildi mi?)."""
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
    print(f"ALTYAPI-SURE simulator acilis: {time.time()-t0:.0f} sn", flush=True)
    time.sleep(5)
    home = shots / "ios-sim-ana-ekran.png"
    sh(f"xcrun simctl io {u} screenshot '{home}'", check=False)
    for app in apps:
        p = shots / f"ios-sim-simctl-{app['id']}-acilis.png"
        repro = f"Simülatörde Mobile Safari ile {base}{app['dir']}/ adresini aç (yerel sunucu)."
        ok = False
        for attempt in (1, 2):
            sh(f"xcrun simctl openurl {u} '{base}{app['dir']}/'")
            time.sleep(14 if attempt == 1 else 20)
            sh(f"xcrun simctl io {u} screenshot '{p}'")
            ratio = diff_ratio(home, p) if home.exists() else 1.0
            print(f"    Safari acildi mi? ana ekrandan fark orani={ratio:.2f} (deneme {attempt})", flush=True)
            if ratio > 0.15: ok = True; break
        if not ok:
            res.add("Mobile Safari (simctl)", label, app["name"], "Boş ekran (görüntü analizi)", ATLANDI,
                    "Safari açılmadı (ekran ana ekranla aynı): altyapı sorunu, ürün hatası sayılmaz", p.relative_to(out).as_posix(), repro)
            print("[ALTYAPI] Safari simctl openurl sonrasi acilmadi", flush=True)
            continue
        try:
            blank, ncol, top = blank_from_png(p)
            res.add("Mobile Safari (simctl)", label, app["name"], "Boş ekran (görüntü analizi)", KALDI if blank else GECTI,
                    f"içerik alanında renk={ncol}, baskın oran={top}" if blank else "", p.relative_to(out).as_posix(), repro)
            print("    EKRAN", p.name, img_stats(p), flush=True)
        except Exception as e:
            res.add("Mobile Safari (simctl)", label, app["name"], "Boş ekran (görüntü analizi)", ATLANDI, f"görüntü çözümlenemedi: {e}", None, repro)

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
        print("Oturum caps:", {k: v for k, v in d.capabilities.items() if "safari" in k or k in ("browserName", "browserVersion", "platformName")}, flush=True)
        ua = d.execute_script("return navigator.userAgent")
        print("UA:", ua, flush=True)
        for app in apps:
            run_generic(SeleniumDrv(d), app, base, res, "Mobile Safari (WebDriver)", label, out / "screenshots",
                        offline_note="çevrimdışı sınanamadı", server=server,
                        console_note="Safari WebDriver konsol günlüğünü vermez")
        return ua
    finally:
        try: d.quit()
        except Exception: pass

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="qa-out/ios-sim"); ap.add_argument("--apps", default="")
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    apps = load_apps([x for x in a.apps.split(",") if x])
    res = Results(ENV_SIM, "macos", out / "results.json")
    meta = {"engine": "ios-simulator", "yontem_A_simctl": "calismadi", "yontem_B_safaridriver": "calismadi"}
    ok_any = False
    with static_server(8000, obj=True) as server:
        base = server.url
        dev = pick_device()
        label = f"{dev['name']} (iOS {dev['ios']} simülatör)"
        meta.update(cihaz=dev["name"], ios=dev["ios"])
        try:
            method_a(dev, apps, base, res, out, label); meta["yontem_A_simctl"] = "calisti"; ok_any = True
        except Exception:
            traceback.print_exc(); meta["yontem_A_hata"] = traceback.format_exc()[-300:]
        try:
            ua = method_b(dev, apps, base, res, out, label, server); meta["yontem_B_safaridriver"] = "calisti"; meta["safari_ua"] = ua; ok_any = True
        except Exception:
            traceback.print_exc(); meta["yontem_B_hata"] = traceback.format_exc()[-400:]
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print("META", json.dumps(meta, ensure_ascii=False))
    if not ok_any: print("[ALTYAPI] iOS simulatoru: iki yontem de calismadi", flush=True)
    return 0 if ok_any else 2

if __name__ == "__main__":
    sys.exit(main())
