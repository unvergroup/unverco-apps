#!/usr/bin/env python3
"""Telefon testi kapsam kontrolu: yayindaki her uygulama testte mi?

Kok dizinde index.html + sw.js tasiyan her klasor bir uygulamadir. Her biri icin:
  1. qa/apps.json'da bir profilin "path"i o klasoru gosterir
  2. qa-web.yml ve qa-android.yml push yollarinda '<klasor>/**' var
  3. uc workflow'un app_ref checkout satirinda klasor adi var
Yeni uygulama eklenip teste baglanmazsa bu betik KIRMIZI verir (28 Kas 2026: 10 uygulama
push'ta test edilmiyordu; hata defteri 25).

Kullanim: python3 qa/kapsam-kontrol.py         -> 0 tamam, 1 eksik
          python3 qa/kapsam-kontrol.py --test  -> kendi mutasyon testi
"""
import json, os, re, sys

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = {n: os.path.join(KOK, ".github", "workflows", n) for n in ("qa-web.yml", "qa-android.yml", "qa-ios.yml")}


def uygulamalar(kok):
    return sorted(d for d in os.listdir(kok)
                  if os.path.isfile(os.path.join(kok, d, "index.html")) and os.path.isfile(os.path.join(kok, d, "sw.js")))


def denetle(apps, apps_json, wf_metin):
    eksik = []
    yollar = {a.get("dir", "").strip("/") for a in apps_json.get("apps", [])}
    for d in apps:
        if d not in yollar:
            eksik.append(f"{d}: qa/apps.json'da profil yok")
        for n in ("qa-web.yml", "qa-android.yml"):
            if f"'{d}/**'" not in wf_metin[n]:
                eksik.append(f"{d}: {n} push yolunda yok")
        for n, s in wf_metin.items():
            satir = [l for l in s.splitlines() if "git checkout" in l and "app_ref" in l]
            if satir and not all(re.search(rf"(?<![\w-]){re.escape(d)}(?![\w-])", l) for l in satir):
                eksik.append(f"{d}: {n} app_ref checkout satirinda yok")
    return eksik


def oku():
    apps_json = json.load(open(os.path.join(KOK, "qa", "apps.json"), encoding="utf-8"))
    wf = {n: open(p, encoding="utf-8").read() for n, p in WF.items()}
    return uygulamalar(KOK), apps_json, wf


if __name__ == "__main__":
    apps, aj, wf = oku()
    if "--test" in sys.argv:
        assert denetle(apps, aj, wf) == [], denetle(apps, aj, wf)
        hedef = "pet-business-tracker"
        m1 = {**wf, "qa-web.yml": wf["qa-web.yml"].replace(f"'{hedef}/**'", "")}
        m2 = {**wf, "qa-ios.yml": wf["qa-ios.yml"].replace(f" {hedef}", "")}
        m3 = {"apps": [a for a in aj["apps"] if hedef not in json.dumps(a)]}
        for ad, args in (("web-yol", (apps, aj, m1)), ("ios-checkout", (apps, aj, m2)), ("apps.json", (apps, m3, wf)),
                         ("yeni-klasor", (apps + ["yeni-uygulama"], aj, wf))):
            assert denetle(*args), f"mutasyon yakalanmadi: {ad}"
        print("kapsam-kontrol: TEST GECTI (4 mutasyon yakalandi)")
        sys.exit(0)
    e = denetle(apps, aj, wf)
    for x in e:
        print("  EKSIK", x)
    print(f"kapsam-kontrol: {len(apps)} uygulama, {'TAMAM' if not e else str(len(e)) + ' eksik'}")
    sys.exit(1 if e else 0)
