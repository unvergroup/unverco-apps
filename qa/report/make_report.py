#!/usr/bin/env python3
"""Sonuc JSON dosyalarindan Turkce rapor uretir.
Kullanim: python qa/report/make_report.py --in <dizin> --out <dizin> [--title ...] [--summary $GITHUB_STEP_SUMMARY] [--gate]
--in altinda her results.json (ve yanindaki meta.json) toplanir. --gate: KALDI varsa cikis kodu 1."""
import argparse, collections, json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
from qa_common import CHECK_ONCELIK, GECTI, KALDI, ATLANDI, UYARI

SIM = {GECTI: "G", KALDI: "K", UYARI: "U", ATLANDI: "-"}


def load(inp):
    rows, metas = [], []
    for f in sorted(pathlib.Path(inp).rglob("results.json")):
        rel = f.parent.relative_to(inp)
        for r in json.loads(f.read_text(encoding="utf-8")):
            r["_dir"] = str(rel)
            rows.append(r)
        m = f.parent / "meta.json"
        if m.exists():
            metas.append(dict(json.loads(m.read_text(encoding="utf-8")), _dir=str(rel)))
    return rows, metas


def cell(sts):
    if KALDI in sts: return "K"
    if UYARI in sts: return "U"
    if all(s == ATLANDI for s in sts): return "-"
    return "G"


def build(rows, metas, title):
    L = []
    cnt = collections.Counter(r["status"] for r in rows)
    L.append(f"# {title}\n")
    L.append("> Gerçek cihaz testi bu sistemde YOK. Tüm sonuçlar masaüstü taklidi, emülatör ya da simülatör ortamındandır; gerçek iPhone/Android cihaz sonuçları ayrıca elle doğrulanmalıdır.\n")
    L.append(f"**Genel:** GEÇTİ {cnt[GECTI]} | KALDI {cnt[KALDI]} | UYARI {cnt[UYARI]} | ATLANDI {cnt[ATLANDI]}\n")
    if metas:
        L.append("**Ortam notları:** " + "; ".join(f"{m.get('engine', m['_dir'])}: " + ", ".join(f"{k}={v}" for k, v in m.items() if k not in ('_dir', 'engine')) for m in metas) + "\n")
    # 1) ozet
    L.append("## Özet tablo (ortam türü / motor / uygulama)\n")
    L.append("| Ortam türü | Motor | Uygulama | GEÇTİ | KALDI | UYARI | ATLANDI |\n|---|---|---|---:|---:|---:|---:|")
    g = collections.defaultdict(collections.Counter)
    for r in rows:
        g[(r["env"], r["engine"], r["app"])][r["status"]] += 1
    for (env, eng, app), c in sorted(g.items()):
        L.append(f"| {env} | {eng} | {app} | {c[GECTI]} | {c[KALDI]} | {c[UYARI]} | {c[ATLANDI]} |")
    L.append("")
    # 2) oncelikli hatalar
    L.append("## Öncelikli hata listesi\n")
    groups = collections.OrderedDict()
    for r in rows:
        if r["status"] not in (KALDI, UYARI):
            continue
        key = (r["status"], r["app"], r["check"], (r["detail"] or "")[:140] if r["check"] not in ("Dokunma hedefi 44px", "Kırpılmış metin") else "")
        e = groups.setdefault(key, dict(rows=[]))
        e["rows"].append(r)
    def sk(k):
        return (0 if k[0] == KALDI else 1, CHECK_ONCELIK.get(k[2], "P9"), k[1])
    if not groups:
        L.append("Hata yok.\n")
    for i, (k, e) in enumerate(sorted(groups.items(), key=lambda kv: sk(kv[0])), 1):
        r0 = e["rows"][0]
        ort = sorted({f"{x['env']} / {x['engine']}" for x in e["rows"]})
        prof = sorted({x["profile"] for x in e["rows"]})
        L.append(f"### {i}. [{CHECK_ONCELIK.get(k[2], 'P9')}] {k[1]}: {k[2]} ({k[0]})\n")
        L.append(f"- Ortam türü: {', '.join(ort)}")
        L.append(f"- Profiller ({len(prof)}): {', '.join(prof)}")
        L.append(f"- Ayrıntı: {r0['detail'][:700]}")
        if r0.get("shot"):
            L.append(f"- Ekran görüntüsü: `{r0['_dir']}/{r0['shot']}`")
        L.append(f"- Yeniden üretme: {r0.get('repro') or '-'}\n")
    # 3) mobil uyumluluk matrisi
    L.append("## Mobil uyumluluk raporu (G=geçti, K=kaldı, U=uyarı, -=atlandı)\n")
    by = collections.defaultdict(list)
    for r in rows:
        by[(r["env"], r["engine"], r["app"])].append(r)
    for (env, eng, app), rs in sorted(by.items()):
        profs = list(dict.fromkeys(r["profile"] for r in rs))
        checks = list(dict.fromkeys(r["check"] for r in rs))
        L.append(f"### {app} | {eng} | {env}\n")
        L.append("| Denetim | " + " | ".join(profs) + " |\n|---|" + "---|" * len(profs))
        for c in checks:
            L.append(f"| {c} | " + " | ".join(cell([r["status"] for r in rs if r["check"] == c and r["profile"] == p] or [ATLANDI]) for p in profs) + " |")
        L.append("")
    # 4) atlananlar
    sk_ = collections.OrderedDict()
    for r in rows:
        if r["status"] == ATLANDI:
            sk_.setdefault((r["engine"], r["check"], r["detail"]), []).append(r["profile"])
    L.append("## Atlanan denetimler\n")
    if not sk_:
        L.append("Yok.\n")
    for (eng, c, d), ps in sk_.items():
        L.append(f"- {eng} | {c} | {d} ({len(ps)} profil)")
    L.append("")
    return "\n".join(L), cnt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="UNVERCO mobil QA raporu")
    ap.add_argument("--summary")
    ap.add_argument("--gate", action="store_true")
    a = ap.parse_args()
    rows, metas = load(a.inp)
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    if not rows:
        print("Sonuç bulunamadı", file=sys.stderr); return 2
    md, cnt = build(rows, metas, a.title)
    (out / "mobil-uyumluluk-raporu.md").write_text(md, encoding="utf-8")
    (out / "tum-sonuclar.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    sm = a.summary or os.environ.get("GITHUB_STEP_SUMMARY")
    if sm:
        # Job ozeti 1 MiB ile sinirli: rapor kisaltilir, tamami artifact'ta.
        with open(sm, "a", encoding="utf-8") as f:
            f.write(md[:900000] + "\n")
    print(md[:3000])
    return 1 if (a.gate and cnt[KALDI]) else 0


if __name__ == "__main__":
    sys.exit(main())
