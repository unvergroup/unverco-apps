"""Shared helpers: configuration, result collection, local static server, check interpretation."""
import contextlib, json, os, pathlib, re, subprocess, sys, time, urllib.request

QA = pathlib.Path(__file__).resolve().parent.parent      # <repo>/app-tester
REPO = QA.parent                                          # repository root (served locally)
CHECKS_JS = (QA / "lib" / "checks.js").read_text(encoding="utf-8")
KIT_VERSION = "1.0.0"

# Environment kinds (report column). Real devices are NOT used by this kit.
ENV_DESKTOP = "Desktop emulation"
ENV_SIM = "iOS Simulator"
ENV_EMU = "Android emulator"

PASSED, FAILED, SKIPPED, WARNING = "PASSED", "FAILED", "SKIPPED", "WARNING"

# Check name -> priority. P0 is the highest.
CHECK_PRIORITY = {
    "Main journey": "P0",
    "Blank screen": "P0",
    "Blank screen (image analysis)": "P0",
    "Primary action reachable": "P0",
    "Data persistence": "P0",
    "Console errors": "P1",
    "Offline launch": "P1",
    "Print page count": "P1",
    "Horizontal overflow": "P2",
    "Clipped text": "P3",
    "Touch target 44px": "P3",
}

# Detects a PWA: web app manifest link or an active service worker.
PWA_JS = ("(function(){return !!document.querySelector('link[rel~=\"manifest\"]') || "
          "!!(navigator.serviceWorker && navigator.serviceWorker.controller);})")

DEFAULT_JOURNEY = [{"label": "Home screen", "check": True, "shot": "01-home"}]


def img_stats(path):
    """Is the screenshot blank? (quantized color count, share of the dominant color). None if PIL is missing."""
    try:
        from PIL import Image
        im = Image.open(path).convert("RGB")
        im.thumbnail((200, 400))
        q = im.quantize(colors=64).convert("RGB")
        cols = q.getcolors(100000) or []
        total = sum(c for c, _ in cols) or 1
        top = max((c for c, _ in cols), default=0) / total
        return {"colors": len(cols), "dominant_ratio": round(top, 2), "size": Image.open(path).size}
    except Exception:
        return None


def load_config():
    # APP_TESTER_CONFIG (optional) points to another config file, for example example/broken/config.json.
    cfg_path = pathlib.Path(os.environ["APP_TESTER_CONFIG"]) if os.environ.get("APP_TESTER_CONFIG") else QA / "config.json"
    try:
        return json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise SystemExit(f"[CONFIG ERROR] Cannot read {cfg_path}: {e}")


def load_apps(only=None):
    """Builds the single app description from config.json. `only` is accepted for call compatibility and ignored."""
    c = load_config()
    path = str(c.get("path") or "").strip().strip("/")
    url = str(c.get("url") or "").strip()
    if not url and "path" not in c:
        raise SystemExit("[CONFIG ERROR] config.json needs either \"path\" (static folder in this repo) or \"url\" (live site).")
    if url and not re.match(r"^https?://", url):
        raise SystemExit("[CONFIG ERROR] \"url\" must start with http:// or https://")
    return [{
        "id": "app",
        "name": str(c.get("app_name") or "My app"),
        "dir": path,
        "url": url or None,
        "main": c.get("main_selector") or "body",
        "journey": c.get("journey") or DEFAULT_JOURNEY,
        "persistence": c.get("persistence") or None,
        "offline": c.get("offline") or {"ready": "body"},
        "print": c.get("print") or [],
        "pwa": c.get("pwa", "auto"),
    }]


def app_url(app, base):
    """Address to open: the live URL if configured, otherwise the local server serving the repo folder."""
    if app.get("url"):
        return app["url"]
    return f"{base}{app['dir']}/" if app["dir"] else base


def is_pwa(app, detected):
    p = app.get("pwa", "auto")
    return bool(detected) if p == "auto" else bool(p)


def offline_possible(app):
    """Offline launch needs the app to be served locally (the server is stopped to go offline)."""
    return not app.get("url")


def load_profiles(only=None):
    ps = json.loads((QA / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    if not only:
        return ps
    return [p for p in ps if p["id"] in only or p["group"] in only]


class Results:
    def __init__(self, env, runner, outfile):
        self.env, self.runner, self.outfile, self.rows = env, runner, pathlib.Path(outfile), []

    def add(self, engine, profile, app, check, status, detail="", shot=None, repro=None):
        row = dict(env=self.env, runner=self.runner, engine=engine, profile=profile, app=app, check=check,
                   status=status, detail=detail, shot=shot, repro=repro)
        self.rows.append(row)
        if shot and check in ("Main journey", "Offline launch"):
            st = img_stats(self.outfile.parent / shot)
            if st:
                row["image"] = st
                print(f"    SCREEN {shot} colors={st['colors']} dominant_ratio={st['dominant_ratio']} size={st['size']}", flush=True)
        print(f"[{status}] {engine} | {profile} | {app} | {check}" + (f" :: {detail[:300]}" if detail and status != PASSED else ""), flush=True)
        self.save()
        return row

    def save(self):
        self.outfile.parent.mkdir(parents=True, exist_ok=True)
        self.outfile.write_text(json.dumps(self.rows, ensure_ascii=False, indent=1), encoding="utf-8")


class Server:
    """Serves the repository root with `python -m http.server` (no dependency on a live site).
    stop()/start() are used for a real offline test."""
    def __init__(self, port=8000, bind="127.0.0.1"):
        self.port, self.bind, self.p = port, bind, None

    def start(self):
        self.p = subprocess.Popen([sys.executable, "-m", "http.server", str(self.port), "--bind", self.bind, "--directory", str(REPO)],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/", timeout=1)
                return self
            except Exception:
                time.sleep(0.2)
        raise RuntimeError("local server did not start")

    def stop(self):
        if self.p:
            self.p.terminate()
            self.p.wait()
            self.p = None
        for _ in range(20):  # wait until the port is closed
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/", timeout=0.5)
                time.sleep(0.2)
            except Exception:
                return

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}/"


@contextlib.contextmanager
def static_server(port=8000, bind="127.0.0.1", obj=False):
    sv = Server(port, bind).start()
    try:
        yield sv if obj else sv.url
    finally:
        sv.stop()


def short_err(e):
    t = str(e)
    if "outside of the viewport" in t:
        return "element is outside the viewport and cannot be reached even after scrolling (" + t.splitlines()[0][:120] + ")"
    if "not visible" in t or "element is not visible" in t:
        return "element is not visible (" + t.splitlines()[0][:120] + ")"
    return t.splitlines()[0][:200]


def repro_text(app, profile_name, engine, env, extra=""):
    steps = " -> ".join(s.get("label", "") for s in app["journey"] if s.get("label"))
    where = app["url"] if app.get("url") else (f"run `python -m http.server 8000` in the repository root and open "
                                                  f"`http://localhost:8000/{app['dir']}{'/' if app['dir'] else ''}`")
    return (f"Environment: {env} / {engine} / {profile_name}. Open the app: {where}. Journey: {steps}. {extra}").strip()


def summarize_checks(res):
    """Turns the checks.js output into a {check: (status, detail)} map (one screen)."""
    out = {}
    b = res["blank"]
    out["Blank screen"] = (FAILED if b["blank"] else PASSED, f"main area found={b['mainFound']} text length={b['textLen']} visible elements={b['visible']}" if b["blank"] else "")
    o = res["overflow"]
    out["Horizontal overflow"] = (FAILED if o["overflow"] else PASSED, f"scrollWidth {o['scrollWidth']} > {o['innerWidth']}; " + "; ".join(o["offenders"]) if o["overflow"] else "")
    out["Clipped text"] = (WARNING if res["clipped"] else PASSED, "; ".join(res["clipped"]) if res["clipped"] else "")
    out["Touch target 44px"] = (WARNING if res["small"] else PASSED, (f"{len(res['small'])} targets: " + "; ".join(res["small"][:8])) if res["small"] else "")
    return out
