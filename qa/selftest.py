#!/usr/bin/env python3
"""Denetimlerin kendisini sinar: bilerek bozuk sayfalar (qa/fixtures) bulunmali, saglam sayfa temiz cikmali.
Kullanim: python qa/selftest.py [chromium|firefox|webkit]"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))
from qa_common import CHECKS_JS, static_server
from playwright.sync_api import sync_playwright

eng = sys.argv[1] if len(sys.argv) > 1 else "chromium"
BEKLENEN = {
    "blank.html": lambda r: r["blank"]["blank"],
    "overflow.html": lambda r: r["overflow"]["overflow"],
    "small.html": lambda r: len(r["small"]) == 1,
    "clipped.html": lambda r: len(r["clipped"]) >= 1,
    "ok.html": lambda r: not r["blank"]["blank"] and not r["overflow"]["overflow"] and not r["small"] and not r["clipped"],
}
bad = 0
with sync_playwright() as p, static_server(8011) as base:
    b = getattr(p, eng).launch()
    for f, ok in BEKLENEN.items():
        pg = b.new_page(viewport={"width": 390, "height": 844})
        pg.goto(base + "qa/fixtures/" + f)
        r = pg.evaluate(CHECKS_JS, {"main": "#main"})
        s = ok(r)
        bad += 0 if s else 1
        print(("OK   " if s else "HATA ") + f, flush=True)
    errs = []
    pg = b.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(base + "qa/fixtures/console.html"); pg.wait_for_timeout(300)
    print(("OK   " if errs else "HATA ") + "console.html pageerror yakalandi", flush=True)
    bad += 0 if errs else 1
    b.close()
print(f"SELFTEST {eng}: {'GECTI' if not bad else 'KALDI'}")
sys.exit(1 if bad else 0)
