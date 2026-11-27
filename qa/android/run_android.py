#!/usr/bin/env python3
"""Android emulatorunde Chrome: adb + Chrome DevTools (CDP). Yerel sunucuya `adb reverse` ile localhost:8000 uzerinden erisilir
(localhost guvenli baglam: service worker calisir). Ekran goruntusu adb screencap ile (Chrome arayuzu dahil tam ekran).
Cikis: 0 = testler kosdu, 2 = altyapi hatasi (Chrome acilamadi vb.)."""
import argparse, json, pathlib, re, subprocess, sys, time, traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_common import *  # noqa
from generic_driver import run_generic
from cdp import CDP, http_json

CHROME = "com.android.chrome"


def adb(*args, check=True, timeout=120, binary=False):
    r = subprocess.run(["adb", *args], capture_output=True, timeout=timeout)
    if check and r.returncode:
        raise RuntimeError(f"adb {' '.join(args)}: {r.stderr.decode()[-300:]}")
    return r.stdout if binary else r.stdout.decode(errors="replace")


class AndroidDrv:
    def __init__(self, cdp, shotfn):
        self.c, self.shotfn = cdp, shotfn
        self.mark = 0

    def get(self, url):
        n = len(self.c.take_events())
        self.c.send("Page.navigate", {"url": url})
        self.c.wait_event("Page.loadEventFired", 25, since=n)

    def reload(self):
        n = len(self.c.take_events())
        self.c.send("Page.reload", {"ignoreCache": False})
        self.c.wait_event("Page.loadEventFired", 25, since=n)

    def js(self, fn, arg=None):
        expr = f"({fn})({json.dumps(arg)})" if arg is not None else f"({fn})()"
        r = self.c.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError("js hatası: " + str(r["exceptionDetails"].get("exception", {}).get("description", r["exceptionDetails"].get("text")))[:300])
        return r["result"].get("value")

    def shot(self, path):
        self.shotfn(path)

    def console_errors(self):
        out = []
        for e in self.c.take_events():
            m, p = e.get("method"), e.get("params", {})
            if m == "Runtime.exceptionThrown":
                d = p["exceptionDetails"]
                out.append("pageerror: " + str(d.get("exception", {}).get("description") or d.get("text"))[:200])
            elif m == "Runtime.consoleAPICalled" and p.get("type") == "error":
                out.append("console.error: " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))[:200])
            elif m == "Log.entryAdded" and p["entry"].get("level") == "error":
                out.append("log: " + p["entry"].get("text", "")[:200] + " " + p["entry"].get("url", ""))
            elif m == "Network.responseReceived" and p["response"]["status"] >= 400:
                out.append(f"HTTP {p['response']['status']} {p['response']['url']}")
        return out


def dismiss_fre():
    """Chrome ilk calistirma ekranlarini (Accept & continue / No thanks / Skip / Next) uiautomator ile gecer."""
    import xml.etree.ElementTree as ET
    labels = re.compile(r"accept|no thanks|skip|next|continue|got it|not now|yes, i'm in|no, thanks|more", re.I)
    for i in range(8):
        act = adb("shell", "dumpsys", "activity", "activities", check=False)
        top = "\n".join(l for l in act.splitlines() if "ResumedActivity" in l)
        if "firstrun" not in top.lower() and "FirstRun" not in top and "signin" not in top.lower() and "Welcome" not in top:
            print("FRE yok/bitti:", top.strip()[:160], flush=True)
            return
        adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False, timeout=60)
        xml = adb("shell", "cat", "/sdcard/ui.xml", check=False)
        try:
            root = ET.fromstring(xml[xml.index("<?xml"):] if "<?xml" in xml else xml)
        except Exception as e:
            print("ui dump okunamadi", e, flush=True)
            time.sleep(2)
            continue
        cand = []
        for n in root.iter("node"):
            txt = (n.get("text") or "") + " " + (n.get("content-desc") or "") + " " + (n.get("resource-id") or "")
            if n.get("clickable") == "true" and labels.search(txt):
                b = re.findall(r"\d+", n.get("bounds", ""))
                if len(b) == 4:
                    x1, y1, x2, y2 = map(int, b)
                    cand.append((("negative" in txt.lower() or "no thanks" in txt.lower() or "skip" in txt.lower()) * -1, -y1, (x1 + x2) // 2, (y1 + y2) // 2, txt.strip()))
        print("FRE adim", i, "aday:", [c[4][:40] for c in cand], flush=True)
        if cand:
            cand.sort()
            c = cand[0]
            adb("shell", "input", "tap", str(c[2]), str(c[3]), check=False)
        time.sleep(3)


def diag():
    """DevTools acilmadiginda nedeni loga yazar."""
    for cmd in (["shell", "cat", "/proc/net/unix"], ["shell", "ps", "-A"], ["shell", "dumpsys", "activity", "activities"], ["shell", "cat", "/data/local/tmp/chrome-command-line"],
                ["logcat", "-d", "-t", "300"]):
        try:
            o = adb(*cmd, check=False, timeout=60)
            if cmd[1] == "cat" and "unix" in cmd[2]:
                o = "\n".join(l for l in o.splitlines() if "devtools" in l.lower() or "chrome" in l.lower())
            elif cmd[1] == "ps":
                o = "\n".join(l for l in o.splitlines() if "chrome" in l.lower())
            elif cmd[1] == "dumpsys":
                o = "\n".join(l for l in o.splitlines() if "mResumedActivity" in l or "topResumedActivity" in l)
            elif cmd[0] == "logcat":
                o = "\n".join(l for l in o.splitlines() if re.search(r"chrome|AndroidRuntime|FATAL|ActivityManager", l, re.I))[-3500:]
            print("DIAG", " ".join(cmd), "->", o[-3500:], flush=True)
        except Exception as e:
            print("DIAG hata", cmd, e, flush=True)


def fallback_screens(apps, base, res, out, shots, api, label, meta):
    """DevTools yok: adb ile URL ac, ekran goruntusunden 'bos ekran mi' karari ver."""
    meta["yontem"] = "yalniz adb + ekran goruntusu (DevTools soketi acilamadi)"
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "ios"))
    from run_sim import blank_from_png
    for app in apps:
        p = shots / f"android-api{api}-{app['id']}-acilis.png"
        adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"{base}{app['dir']}/", CHROME)
        time.sleep(15)
        screencap(p)
        blank, ncol, top = blank_from_png(p)
        res.add("Chrome (Android)", label, app["name"], "Boş ekran (görüntü analizi)", KALDI if blank else UYARI,
                f"içerik alanında renk={ncol}, baskın oran={top}" if blank else "DevTools yok: yalnız görüntü analizi; ekranın uygulama olduğu doğrulanamadı (Chrome ilk çalıştırma ekranı olabilir)", p.relative_to(out).as_posix(), repro_text(app, label, "Chrome", ENV_EMU))
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return 0


def screencap(path):
    data = adb("exec-out", "screencap", "-p", binary=True)
    pathlib.Path(path).write_bytes(data)


TABAN_CHROME = 80
UYARI_JS = """function(){var b=document.querySelector('#boot-warning');if(!b)return null;var r=b.getBoundingClientRect();
return {role:b.getAttribute('role'),text:(b.textContent||'').trim(),w:Math.round(r.width),h:Math.round(r.height),
vis:getComputedStyle(b).display!=='none'&&getComputedStyle(b).visibility!=='hidden'}}"""


def taban_alti_denetimi(drv, app, base, res, out, shots, api, label, ver):
    p = shots / f"android-api{api}-{app['id']}-eski-tarayici-uyarisi.png"
    repro = repro_text(app, label, "Chrome " + (ver.get("Browser") or ""), ENV_EMU) + " Beklenen: en geç 6 sn içinde #boot-warning uyarısı."
    drv.get(f"{base}{app['dir']}/")
    t0, info, gec = time.time(), None, None
    while time.time() - t0 < 12:
        try:
            info = drv.js(UYARI_JS)
        except Exception:
            info = None
        if info and info.get("vis") and info.get("role") == "alert" and info.get("text"):
            gec = time.time() - t0; break
        time.sleep(0.4)
    time.sleep(1)
    screencap(p)
    st = img_stats(p)
    print("    EKRAN", p.name, st, flush=True)
    print("    UYARI DOM:", json.dumps(info, ensure_ascii=False), f"gorunme={gec}", flush=True)
    ok = gec is not None and gec <= 6.5
    detay = (f"uyarı {gec:.1f} sn'de göründü; metin={info['text'][:90]!r}; kutu={info['w']}x{info['h']}; görüntü renk={st and st['renk']} baskın_oran={st and st['baskin_oran']}"
             if ok else (f"uyarı {gec:.1f} sn'de göründü (>6 sn)" if gec is not None else f"#boot-warning görünmedi (DOM={info}); ekran boş/uygulama açılmadı"))
    res.add("Chrome (Android)", label, app["name"], "Eski tarayıcı uyarısı görünür", GECTI if ok else KALDI, "" if ok else detay,
            p.relative_to(out).as_posix(), repro)
    if ok: print("    KANIT:", detay, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="qa-out/android")
    ap.add_argument("--api", default="?")
    ap.add_argument("--apps", default="")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    shots = out / "screenshots"
    shots.mkdir(exist_ok=True)
    apps = load_apps([x for x in a.apps.split(",") if x])
    res = Results(ENV_EMU, "ubuntu-latest", out / "results.json")
    meta = {"engine": f"android-api{a.api}"}
    try:
        release = adb("shell", "getprop", "ro.build.version.release").strip()
        sdk = adb("shell", "getprop", "ro.build.version.sdk").strip()
        model = adb("shell", "getprop", "ro.product.model").strip()
        size = adb("shell", "wm", "size").strip()
        dump = adb("shell", "dumpsys", "package", CHROME)
        m = re.search(r"versionName=([\d.]+)", dump)
        chrome_ver = m.group(1) if m else "bilinmiyor"
        meta.update(android=release, api=sdk, model=model, ekran=size, chrome_paket_surumu=chrome_ver)
        print("ORTAM", meta, flush=True)
        label = f"Android {release} (API {sdk}) emülatör"
        # Chrome ilk acilis ekranlarini kapat (derlenmis ucreti olmayan resmi bayraklar)
        adb("shell", "echo '_ --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line; chmod 755 /data/local/tmp/chrome-command-line", check=False)
        adb("shell", "am", "set-debug-app", "--persistent", CHROME, check=False)
        adb("shell", "pm", "grant", CHROME, "android.permission.POST_NOTIFICATIONS", check=False)
        adb("shell", "am", "force-stop", CHROME, check=False)
        adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote", check=False)
        with static_server(8000, obj=True) as server:
            base = server.url
            adb("reverse", "tcp:8000", "tcp:8000")
            adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "about:blank", CHROME)
            ver = None
            time.sleep(5)
            screencap(shots / "chrome-acilis-hemen.png")
            dismiss_fre()
            screencap(shots / "chrome-fre-sonrasi.png")
            for _ in range(30):
                try:
                    ver = http_json("http://127.0.0.1:9222/json/version")
                    break
                except Exception:
                    adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote", check=False)
                    time.sleep(2)
            if not ver:
                diag()
                return fallback_screens(apps, base, res, out, shots, a.api, label, meta)
            meta["chrome_tarayici"] = ver.get("Browser")
            meta["user_agent"] = ver.get("User-Agent")
            print("CHROME", ver, flush=True)
            tabs = [t for t in http_json("http://127.0.0.1:9222/json/list") if t.get("type") == "page"]
            if not tabs:
                try:
                    tabs = [http_json("http://127.0.0.1:9222/json/new?about:blank", "PUT")]
                except Exception:
                    tabs = [http_json("http://127.0.0.1:9222/json/new?about:blank")]
            cdp = CDP(tabs[0]["webSocketDebuggerUrl"])
            for dom in ("Page", "Runtime", "Log", "Network"):
                try:
                    cdp.send(f"{dom}.enable")
                except Exception as e:
                    print("enable", dom, e, flush=True)
            drv = AndroidDrv(cdp, screencap)
            m_ver = re.search(r"/(\d+)\.", ver.get("Browser") or "")
            chrome_major = int(m_ver.group(1)) if m_ver else 999
            taban_alti = chrome_major < TABAN_CHROME
            meta["chrome_major"] = chrome_major; meta["taban_alti"] = taban_alti
            for app in apps:
                if taban_alti:
                    # Spec tabani Chrome/WebView 80: bunun altinda beklenen sonuc uygulamanin acilmasi DEGIL,
                    # #boot-warning (role=alert, dolu metin) uyarisinin <= 6 sn icinde gorunmesidir.
                    taban_alti_denetimi(drv, app, base, res, out, shots, a.api, label, ver)
                    continue
                # 1) ilk acilis: ekran goruntusuyle "bos ekran mi" karari
                p = shots / f"android-api{a.api}-{app['id']}-acilis.png"
                drv.get(f"{base}{app['dir']}/")
                time.sleep(8)
                screencap(p)
                repro = repro_text(app, label, "Chrome " + (ver.get("Browser") or ""), ENV_EMU)
                try:
                    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "ios"))
                    from run_sim import blank_from_png
                    blank, ncol, top = blank_from_png(p)
                    res.add("Chrome (Android)", label, app["name"], "Boş ekran (görüntü analizi)", KALDI if blank else GECTI,
                            f"içerik alanında renk={ncol}, baskın oran={top}" if blank else "", p.relative_to(out).as_posix(), repro)
                    print("    EKRAN", p.name, img_stats(p), flush=True)
                except Exception as e:
                    print("görüntü analizi:", e, flush=True)
                # 2) tam yolculuk + denetimler
                run_generic(drv, app, base, res, "Chrome (Android)", label, shots,
                            offline_note="çevrimdışı sınanamadı", server=server)
            cdp.close()
    except Exception:
        traceback.print_exc()
        (out / "meta.json").write_text(json.dumps(dict(meta, altyapi_hatasi=traceback.format_exc()[-500:]), ensure_ascii=False), encoding="utf-8")
        return 2
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print("META", json.dumps(meta, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
