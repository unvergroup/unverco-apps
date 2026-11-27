"""QA ortak yardimcilari: yapilandirma, sonuc toplama, yerel statik sunucu, ortak denetim yorumlama."""
import contextlib, json, os, pathlib, re, subprocess, sys, time, urllib.request

QA = pathlib.Path(__file__).resolve().parent.parent
REPO = QA.parent
CHECKS_JS = (QA / "lib" / "checks.js").read_text(encoding="utf-8")

# Ortam turleri (rapor sutunu). Gercek cihaz testi bu sistemde YOK.
ENV_MASAUSTU = "Masaüstü taklidi"
ENV_SIM = "Simülatör (gerçek iOS + Mobile Safari)"
ENV_EMU = "Emülatör"

GECTI, KALDI, ATLANDI, UYARI = "GEÇTİ", "KALDI", "ATLANDI", "UYARI"

# Denetim adi -> (oncelik, durum kuralı). P0 en yuksek.
CHECK_ONCELIK = {
    "Ana yolculuk": "P0",
    "Eski tarayıcı uyarısı görünür": "P0",
    "Boş ekran": "P0",
    "Ana eylem erişilebilir": "P0",
    "Veri kalıcılığı": "P0",
    "Konsol hataları": "P1",
    "Çevrimdışı açılış": "P1",
    "Yazdırma sayfa sayısı": "P1",
    "Yatay taşma": "P2",
    "Kırpılmış metin": "P3",
    "Dokunma hedefi 44px": "P3",
}


def img_stats(path):
    """Ekran goruntusu bos mu? (kuantize renk sayisi, baskin rengin orani). PIL yoksa None."""
    try:
        from PIL import Image
        im = Image.open(path).convert("RGB")
        im.thumbnail((200, 400))
        q = im.quantize(colors=64).convert("RGB")
        cols = q.getcolors(100000) or []
        total = sum(c for c, _ in cols) or 1
        top = max((c for c, _ in cols), default=0) / total
        return {"renk": len(cols), "baskin_oran": round(top, 2), "boyut": Image.open(path).size}
    except Exception:
        return None


def load_apps(only=None):
    apps = json.loads((QA / "apps.json").read_text(encoding="utf-8"))["apps"]
    return [a for a in apps if not only or a["id"] in only or a["dir"] in only]


def load_profiles(only=None):
    ps = json.loads((QA / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    if not only:
        return ps
    return [p for p in ps if p["id"] in only or p["group"] in only]


def app_version(app):
    try:
        t = (REPO / app["dir"] / app["version_file"]).read_text(encoding="utf-8")
        m = re.search(app["version_regex"], t)
        return m.group(1) if m else "?"
    except Exception:
        return "?"


class Results:
    def __init__(self, env, runner, outfile):
        self.env, self.runner, self.outfile, self.rows = env, runner, pathlib.Path(outfile), []

    def add(self, engine, profile, app, check, status, detail="", shot=None, repro=None):
        row = dict(env=self.env, runner=self.runner, engine=engine, profile=profile, app=app, check=check,
                   status=status, detail=detail, shot=shot, repro=repro)
        self.rows.append(row)
        if shot and check in ("Ana yolculuk", "Çevrimdışı açılış"):
            st = img_stats(self.outfile.parent / shot)
            if st:
                row["goruntu"] = st
                print(f"    EKRAN {shot} renk={st['renk']} baskin_oran={st['baskin_oran']} boyut={st['boyut']}", flush=True)
        print(f"[{status}] {engine} | {profile} | {app} | {check}" + (f" :: {detail[:300]}" if detail and status != GECTI else ""), flush=True)
        self.save()
        return row

    def save(self):
        self.outfile.parent.mkdir(parents=True, exist_ok=True)
        self.outfile.write_text(json.dumps(self.rows, ensure_ascii=False, indent=1), encoding="utf-8")


class Server:
    """Depo kokunu `python -m http.server` ile sunar (canli siteye bagimlilik yok). stop()/start(): gercek cevrimdisi sinama."""
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
        raise RuntimeError("yerel sunucu başlamadı")

    def stop(self):
        if self.p:
            self.p.terminate()
            self.p.wait()
            self.p = None
        for _ in range(20):  # port kapandi mi
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
        return "düğme görünüm alanının dışında kalıyor, kaydırılsa da erişilemiyor (" + t.splitlines()[0][:120] + ")"
    if "not visible" in t or "element is not visible" in t:
        return "düğme görünmüyor (" + t.splitlines()[0][:120] + ")"
    return t.splitlines()[0][:200]


def repro_text(app, profile_name, engine, env, extra=""):
    steps = " -> ".join(s.get("label", "") for s in app["journey"] if s.get("label"))
    return (f"Ortam: {env} / {engine} / {profile_name}. Depoyu klonla, kokte `python -m http.server 8000` calistir, "
            f"`http://localhost:8000/{app['dir']}/` ac. Yolculuk: {steps}. {extra}").strip()


def summarize_checks(res):
    """checks.js ciktisini {denetim: (durum, ayrinti)} haritasina cevirir (tek ekran)."""
    out = {}
    b = res["blank"]
    out["Boş ekran"] = (KALDI if b["blank"] else GECTI, f"ana alan bulundu={b['mainFound']} metin={b['textLen']} gorunen={b['visible']}" if b["blank"] else "")
    o = res["overflow"]
    out["Yatay taşma"] = (KALDI if o["overflow"] else GECTI, f"scrollWidth {o['scrollWidth']} > {o['innerWidth']}; " + "; ".join(o["offenders"]) if o["overflow"] else "")
    out["Kırpılmış metin"] = (UYARI if res["clipped"] else GECTI, "; ".join(res["clipped"]) if res["clipped"] else "")
    out["Dokunma hedefi 44px"] = (UYARI if res["small"] else GECTI, (f"{len(res['small'])} hedef: " + "; ".join(res["small"][:8])) if res["small"] else "")
    return out
