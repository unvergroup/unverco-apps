#!/usr/bin/env python3
"""Tests the checks themselves: the deliberately broken pages (app-tester/fixtures) must be caught, the healthy page must be clean.
Usage: python app-tester/selftest.py [chromium|firefox|webkit]"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))
from qa_common import CHECKS_JS, static_server
from playwright.sync_api import sync_playwright

eng = sys.argv[1] if len(sys.argv) > 1 else "chromium"
EXPECTED = {
    "blank.html": lambda r: r["blank"]["blank"],
    "overflow.html": lambda r: r["overflow"]["overflow"],
    "small.html": lambda r: len(r["small"]) == 1,
    "clipped.html": lambda r: len(r["clipped"]) >= 1,
    "ok.html": lambda r: not r["blank"]["blank"] and not r["overflow"]["overflow"] and not r["small"] and not r["clipped"],
}
bad = 0
with sync_playwright() as p, static_server(8011) as base:
    b = getattr(p, eng).launch()
    for f, ok in EXPECTED.items():
        pg = b.new_page(viewport={"width": 390, "height": 844})
        pg.goto(base + "app-tester/fixtures/" + f)
        r = pg.evaluate(CHECKS_JS, {"main": "#main"})
        s = ok(r)
        bad += 0 if s else 1
        print(("OK     " if s else "FAILED ") + f, flush=True)
    # Mobile emulation widens innerWidth to the content width; the overflow check must still see it.
    if eng != "firefox":
        pg = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True).new_page()
        pg.goto(base + "app-tester/fixtures/overflow.html")
        r = pg.evaluate(CHECKS_JS, {"main": "#main"})
        s = r["overflow"]["overflow"]
        bad += 0 if s else 1
        print(("OK     " if s else "FAILED ") + "overflow.html (mobile emulation)", flush=True)
    errs = []
    pg = b.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(base + "app-tester/fixtures/console.html"); pg.wait_for_timeout(300)
    print(("OK     " if errs else "FAILED ") + "console.html: page error captured", flush=True)
    bad += 0 if errs else 1
    b.close()
print(f"SELFTEST {eng}: {'PASSED' if not bad else 'FAILED'}")
sys.exit(1 if bad else 0)
