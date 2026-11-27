#!/usr/bin/env python3
"""telefon-test.sh yardimcisi: calisma gunlugunden (artifact'a ihtiyac duymadan) GEÇTİ/KALDI tablosu uretir.
Girdi dizini: <wf>.run.json, <wf>.jobs.json, <wf>.log, <wf>.not (altyapi notlari, satir satir).
Cikis kodu: 0 hepsi gecti, 1 urun hatasi (KALDI), 2 altyapi/zaman asimi (urun hatasi yoksa)."""
import collections, json, pathlib, re, sys, datetime as dt

WF = [("web", "qa-web"), ("android", "qa-android"), ("ios", "qa-ios")]
ROW = re.compile(r"^\[(GEÇTİ|KALDI|UYARI|ATLANDI)\] (.*)$")
TS = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ?")
ORTAM = {"web": "Masaüstü taklidi", "android": "Emülatör", "webkit-iphone": "Masaüstü taklidi", "simulator": "Simülatör"}


def ortam(job):
    for k, v in ORTAM.items():
        if job.startswith(k): return v
    return "?"


def secs(j):
    try:
        f = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return int((f(j["completed_at"]) - f(j["started_at"])).total_seconds())
    except Exception:
        return None


def parse_log(path):
    rows = collections.defaultdict(list); alt = collections.defaultdict(list)
    if not path.exists(): return rows, alt
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        p = line.split("\t", 2)
        if len(p) < 3: continue
        job, txt = p[0], TS.sub("", p[2]).rstrip()
        m = ROW.match(txt)
        if m: rows[job].append((m.group(1), m.group(2)))
        elif txt.startswith("[ALTYAPI]") or txt.startswith("ALTYAPI-SURE"): alt[job].append(txt)
    return rows, alt


def main(d):
    d = pathlib.Path(d)
    tablo, kaldi, notlar, bilgi = [], [], [], []
    product_fail = infra = False
    sec = (d / "secilen").read_text().split() if (d / "secilen").exists() else [k for k, _ in WF]
    for key, name in WF:
        if key not in sec: continue
        runf = d / f"{key}.run.json"
        if not runf.exists():
            notlar.append(f"{name}: çalıştırma bulunamadı/tetiklenemedi (altyapı)"); infra = True; continue
        run = json.loads(runf.read_text())
        jobs = json.loads((d / f"{key}.jobs.json").read_text()) if (d / f"{key}.jobs.json").exists() else []
        rows, alt = parse_log(d / f"{key}.log")
        extra = [l.strip() for l in (d / f"{key}.not").read_text().splitlines()] if (d / f"{key}.not").exists() else []
        for n in extra: notlar.append(f"{name}: {n}"); infra = True
        for j in jobs:
            if j["name"] in ("rapor",): continue
            r = rows.get(j["name"], [])
            c = collections.Counter(s for s, _ in r)
            sure = secs(j)
            if r:
                sonuc = "KALDI" if c["KALDI"] else "GEÇTİ"
                if c["KALDI"]: product_fail = True
            elif j["conclusion"] in ("cancelled", "skipped") or j["status"] != "completed":
                sonuc = "ALTYAPI"; infra = True
                if not j.get("runner_name") and j["conclusion"] == "cancelled" and (sure or 0) >= 600:
                    et = "macOS kuyruğu" if key == "ios" else "runner kuyruğu"
                    notlar.append(f"{name}/{j['name']}: altyapı: {et} — iş {sure//60} dk kuyrukta kaldı, hiç runner atanmadı (GitHub 15 dk'da iptal etti); ürün hatası değil")
                if not any(j["name"] in n for n in notlar):
                    notlar.append(f"{name}/{j['name']}: tamamlanmadı (durum={j['status']}/{j['conclusion']})")
            else:
                sonuc = "ALTYAPI" if j["conclusion"] != "success" else "GEÇTİ"
                if j["conclusion"] != "success":
                    infra = True; notlar.append(f"{name}/{j['name']}: sonuç satırı yok, iş {j['conclusion']} (altyapı hatası)")
            for a in alt.get(j["name"], []):
                if a.startswith("[ALTYAPI]"): infra = True; notlar.append(f"{name}/{j['name']}: {a}")
                else: bilgi.append(f"{name}/{j['name']}: {a}")
            tablo.append((ortam(j["name"]), f"{name}/{j['name']}", f"{sure//60}dk{sure%60:02d}sn" if sure is not None else "-",
                          c["GEÇTİ"], c["KALDI"], c["UYARI"], c["ATLANDI"], sonuc, run.get("id")))
            g = collections.OrderedDict()
            for st, txt in r:
                if st != "KALDI": continue
                parts = txt.split(" | ", 3)
                if len(parts) == 4:
                    eng, prof, app, rest = parts
                else:
                    eng, prof, app, rest = "?", "?", "?", txt
                g.setdefault((eng, app, rest), []).append(prof)
            for (eng, app, rest), profs in g.items():
                kaldi.append((j["name"], eng, app, rest, len(profs), profs[0]))
    print()
    print("=" * 100)
    print(f"{'Ortam türü':<17} {'İş':<28} {'Süre':<9} {'GEÇTİ':>6} {'KALDI':>6} {'UYARI':>6} {'ATLANDI':>7}  Sonuç   Run")
    print("-" * 100)
    for t in tablo:
        print(f"{t[0]:<17} {t[1]:<28} {t[2]:<9} {t[3]:>6} {t[4]:>6} {t[5]:>6} {t[6]:>7}  {t[7]:<8}{t[8]}")
    print("=" * 100)
    if kaldi:
        print(f"\n[KALDI] satırları (aynı hata birden çok profilde ise bir kez, profil sayısıyla):")
        for job, eng, app, rest, n, p0 in kaldi:
            print(f"[KALDI] {job} | {eng} | {app} | {rest[:230]} ({n} profil, ör. {p0})")
    if notlar:
        print("\nALTYAPI notları (ürün hatası sayılmaz):")
        for n in notlar: print(f"  - {n}")
    for b in bilgi: print(f"Bilgi: {b}")
    code = 1 if product_fail else (2 if infra else 0)
    print(f"\nSONUÇ: {['HEPSİ GEÇTİ', 'ÜRÜN HATASI VAR (KALDI)', 'ALTYAPI SORUNU / ZAMAN AŞIMI (ürün hatası yok)'][code]}  (çıkış kodu {code})")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
