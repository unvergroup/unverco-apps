#!/usr/bin/env python3
"""Chrome on an Android emulator: adb + Chrome DevTools (CDP). The local server is reached through `adb reverse` on localhost:8000
(localhost is a secure context, so service workers work). Screenshots come from adb screencap (full screen incl. Chrome UI).
Exit code: 0 = tests ran, 2 = infrastructure error (Chrome did not start etc.)."""
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
            raise RuntimeError("js error: " + str(r["exceptionDetails"].get("exception", {}).get("description", r["exceptionDetails"].get("text")))[:300])
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
    """Dismisses Chrome first-run screens (Accept & continue / No thanks / Skip / Next) with uiautomator."""
    import xml.etree.ElementTree as ET
    labels = re.compile(r"accept|no thanks|skip|next|continue|got it|not now|yes, i'm in|no, thanks|more", re.I)
    for i in range(8):
        act = adb("shell", "dumpsys", "activity", "activities", check=False)
        top = "\n".join(l for l in act.splitlines() if "ResumedActivity" in l)
        if "firstrun" not in top.lower() and "FirstRun" not in top and "signin" not in top.lower() and "Welcome" not in top:
            print("No first-run screen / done:", top.strip()[:160], flush=True)
            return
        adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False, timeout=60)
        xml = adb("shell", "cat", "/sdcard/ui.xml", check=False)
        try:
            root = ET.fromstring(xml[xml.index("<?xml"):] if "<?xml" in xml else xml)
        except Exception as e:
            print("could not read ui dump", e, flush=True)
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
        print("First-run step", i, "candidates:", [c[4][:40] for c in cand], flush=True)
        if cand:
            cand.sort()
            c = cand[0]
            adb("shell", "input", "tap", str(c[2]), str(c[3]), check=False)
        time.sleep(3)


def diag():
    """Logs diagnostics when DevTools cannot be reached."""
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
            print("DIAG error", cmd, e, flush=True)


def fallback_screens(apps, base, res, out, shots, api, label, meta):
    """No DevTools: open the URL with adb and decide "blank screen?" from the screenshot."""
    meta["method"] = "adb + screenshot only (DevTools socket could not be opened)"
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "ios"))
    from run_sim import blank_from_png
    for app in apps:
        p = shots / f"android-api{api}-{app['id']}-launch.png"
        adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", app_url(app, base), CHROME)
        time.sleep(15)
        screencap(p)
        blank, ncol, top = blank_from_png(p)
        res.add("Chrome (Android)", label, app["name"], "Blank screen (image analysis)", FAILED if blank else WARNING,
                f"content area colors={ncol}, dominant ratio={top}" if blank else "No DevTools: image analysis only; could not verify that the screen is the app (it may be a Chrome first-run screen)", p.relative_to(out).as_posix(), repro_text(app, label, "Chrome", ENV_EMU))
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return 0


def screencap(path):
    data = adb("exec-out", "screencap", "-p", binary=True)
    pathlib.Path(path).write_bytes(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="qa-out/android")
    ap.add_argument("--api", default="?")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    shots = out / "screenshots"
    shots.mkdir(exist_ok=True)
    apps = load_apps()
    res = Results(ENV_EMU, "ubuntu-latest", out / "results.json")
    meta = {"engine": f"android-api{a.api}"}
    try:
        release = adb("shell", "getprop", "ro.build.version.release").strip()
        sdk = adb("shell", "getprop", "ro.build.version.sdk").strip()
        model = adb("shell", "getprop", "ro.product.model").strip()
        size = adb("shell", "wm", "size").strip()
        dump = adb("shell", "dumpsys", "package", CHROME)
        m = re.search(r"versionName=([\d.]+)", dump)
        chrome_ver = m.group(1) if m else "unknown"
        meta.update(android=release, api=sdk, model=model, screen=size, chrome_package_version=chrome_ver)
        print("ENVIRONMENT", meta, flush=True)
        label = f"Android {release} (API {sdk}) emulator"
        # Turn off Chrome first-run screens with official command-line flags
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
            screencap(shots / "chrome-first-launch.png")
            dismiss_fre()
            screencap(shots / "chrome-after-first-run.png")
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
            meta["chrome_browser"] = ver.get("Browser")
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
            for app in apps:
                # 1) first launch: decide "blank screen?" from the screenshot
                p = shots / f"android-api{a.api}-{app['id']}-launch.png"
                drv.get(app_url(app, base))
                time.sleep(8)
                screencap(p)
                repro = repro_text(app, label, "Chrome " + (ver.get("Browser") or ""), ENV_EMU)
                try:
                    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "ios"))
                    from run_sim import blank_from_png
                    blank, ncol, top = blank_from_png(p)
                    res.add("Chrome (Android)", label, app["name"], "Blank screen (image analysis)", FAILED if blank else PASSED,
                            f"content area colors={ncol}, dominant ratio={top}" if blank else "", p.relative_to(out).as_posix(), repro)
                    print("    SCREEN", p.name, img_stats(p), flush=True)
                except Exception as e:
                    print("image analysis:", e, flush=True)
                # 2) full journey + checks
                run_generic(drv, app, base, res, "Chrome (Android)", label, shots,
                            offline_note="offline test not available", server=server)
            cdp.close()
    except Exception:
        traceback.print_exc()
        (out / "meta.json").write_text(json.dumps(dict(meta, infra_error=traceback.format_exc()[-500:]), ensure_ascii=False), encoding="utf-8")
        return 2
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print("META", json.dumps(meta, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
