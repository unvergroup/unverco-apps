"""Surucu-bagimsiz yolculuk kosucusu (iOS Safari/Selenium ve Android Chrome/DevTools icin).
Surucu arayuzu: get(url), reload(), js(expr_or_fn, arg=None) -> deger, shot(path), console_errors() -> liste|None,
click_js varsayilan olarak js ile yapilir; Selenium surucusu gercek tik icin click(selector) tanimlar."""
import json, pathlib, re, time
from qa_common import *  # noqa

PICK_JS = "(function(sels){for(var i=0;i<sels.length;i++){var e=document.querySelector(sels[i]);if(e){var r=e.getBoundingClientRect();if(r.width>0&&r.height>0)return sels[i];}}return null;})"
EXISTS_JS = "(function(s){return !!document.querySelector(s);})"
CLICK_JS = "(function(s){var e=document.querySelector(s);if(!e)return 'yok';e.scrollIntoView({block:'center'});e.click();return 'ok';})"
TEXT_JS = "(function(s){var e=document.querySelector(s);return e?(e.innerText||'').trim():null;})"


def poll(drv, sel, present=True, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if bool(drv.js(EXISTS_JS, sel)) == present:
            return True
        time.sleep(0.25)
    raise TimeoutError(f"{'beklenen' if present else 'kaybolması beklenen'} öğe: {sel}")


def do_step(drv, s, last):
    if "goto" in s:
        drv.js("(function(h){location.hash=h;return 1;})", s["goto"])
    if "select" in s:
        drv.js("(function(a){var e=document.querySelector(a[0]);e.value=a[1];e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 1;})", s["select"])
    if "click" in s:
        if not s.get("rapid"):
            gap = time.time() - last[0]
            if gap < 0.9:
                time.sleep(0.9 - gap)
        sels = s["click"] if isinstance(s["click"], list) else [s["click"]]
        pick = drv.js(PICK_JS, sels) or sels[0]
        if hasattr(drv, "click"):
            drv.click(pick)
        else:
            if drv.js(CLICK_JS, pick) != "ok":
                raise RuntimeError(f"tıklanacak öğe yok: {pick}")
        last[0] = time.time()
    if "wait" in s:
        poll(drv, s["wait"], True)
    if "waitGone" in s:
        poll(drv, s["waitGone"], False)
    if "sleep" in s:
        time.sleep(s["sleep"] / 1000)


def run_generic(drv, app, base, res, engine, profile, shots_dir, *, offline_note, desktop=False, console_note=None, server=None):
    """Ana yolculuk + yerlesim denetimleri + kalicilik (+ konsol varsa). res: Results."""
    shots_dir = pathlib.Path(shots_dir)
    shots_dir.mkdir(parents=True, exist_ok=True)
    out_dir = res.outfile.parent
    tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"{engine}-{profile}-{app['id']}")
    repro = repro_text(app, profile, engine, res.env, "Cihazda aynı adresi (bilgisayarın yerel sunucusu) Safari/Chrome ile açın.")
    agg, journey_err, last, nshots, shot_main = {}, None, [0.0], 0, None
    rel = lambda p: str(pathlib.Path(p).relative_to(out_dir)) if p else None
    drv.get(f"{base}{app['dir']}/")
    time.sleep(2.0)

    def layout():
        r = drv.js(CHECKS_JS, {"main": app["main"]})
        for _ in range(4):  # yavas cihazda ekran gec cizilebilir: bos gorunuyorsa yeniden bak
            if not r["blank"]["blank"]:
                break
            time.sleep(1.0)
            r = drv.js(CHECKS_JS, {"main": app["main"]})
        return r

    def add_agg(label, summ):
        for k, (st, d) in summ.items():
            agg.setdefault(k, []).append((st, f"[{label}] {d}" if d else ""))

    # Ilk acilis yavas olabilir (yeni origin, service worker kurulumu, dondurme sonrasi): ilk ekran 30 sn
    # beklenir, gelmezse sayfa bir kez yeniden yuklenir. Hala gelmezse adres ve sayfa metni hata notuna eklenir.
    first = app["journey"][0].get("wait") if app.get("journey") else None
    if first:
        try:
            poll(drv, first, True, timeout=30.0)
        except TimeoutError:
            print(f"[ALTYAPI] {app['id']} ilk ekran 30 sn'de gelmedi; sayfa yeniden yukleniyor", flush=True)
            drv.get(f"{base}{app['dir']}/")
            try:
                poll(drv, first, True, timeout=30.0)
            except TimeoutError:
                try:
                    durum = drv.js("(function(){return location.href+' | '+(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,160);})")
                    print(f"[ALTYAPI] {app['id']} ilk ekran yok: {durum}", flush=True)
                except Exception:
                    pass

    for s in app["journey"]:
        try:
            do_step(drv, s, last)
            if s.get("check"):
                add_agg(s["label"], summarize_checks(layout()))
            if s.get("shot"):
                p = shots_dir / f"{tag}-{s['shot']}.png"
                drv.shot(str(p))
                nshots += 1
                if nshots == 2 or shot_main is None:
                    shot_main = p
        except Exception as e:
            journey_err = f"'{s.get('label')}' adımı: {str(e).splitlines()[0][:200]}"
            p = shots_dir / f"{tag}-HATA.png"
            try:
                drv.shot(str(p))
                shot_main = p
                add_agg(s.get("label", "?"), summarize_checks(layout()))
            except Exception:
                pass
            break
    res.add(engine, profile, app["name"], "Ana yolculuk", KALDI if journey_err else GECTI, journey_err or "", rel(shot_main), repro)
    for k in ("Boş ekran", "Yatay taşma", "Kırpılmış metin", "Dokunma hedefi 44px"):
        rows = agg.get(k, [])
        if not rows:
            res.add(engine, profile, app["name"], k, ATLANDI, "yolculuk bu ekrana ulaşmadı", None, repro)
            continue
        st = KALDI if any(r[0] == KALDI for r in rows) else UYARI if any(r[0] == UYARI for r in rows) else GECTI
        res.add(engine, profile, app["name"], k, st, " | ".join(r[1] for r in rows if r[1])[:1500], rel(shot_main), repro)
    # kalicilik
    cfg = app["persistence"]
    if journey_err:
        res.add(engine, profile, app["name"], "Veri kalıcılığı", ATLANDI, "yolculuk tamamlanmadı", None, repro)
    else:
        try:
            pre = drv.js(TEXT_JS, cfg["probe"]) or ""
            for s in cfg["steps"]:
                try:
                    do_step(drv, s, last)
                except Exception as e:
                    res.add(engine, profile, app["name"], "Ana eylem erişilebilir", KALDI, f"{cfg['label']}: {str(e).splitlines()[0][:200]}", None, repro)
                    res.add(engine, profile, app["name"], "Veri kalıcılığı", ATLANDI, "ana eylem yapılamadığı için sınanamadı", None, repro)
                    raise StopIteration
            res.add(engine, profile, app["name"], "Ana eylem erişilebilir", GECTI, "", None, repro)
            before = drv.js(TEXT_JS, cfg["probe"]) or ""
            for _ in range(12):  # yavas cihazda ekran guncellemesi gecikebilir: metin degisene kadar bekle
                if before != pre:
                    break
                time.sleep(0.5)
                before = drv.js(TEXT_JS, cfg["probe"]) or ""
            drv.reload()
            time.sleep(1.5)
            poll(drv, cfg["ready"], True, 12)
            time.sleep(0.5)
            after = drv.js(TEXT_JS, cfg["probe"]) or ""
            ok = before == after and after != ""
            res.add(engine, profile, app["name"], "Veri kalıcılığı", GECTI if ok else KALDI,
                    "" if ok else f"{cfg['label']}: yenileme sonrası metin farklı. önce={before[:100]!r} sonra={after[:100]!r}", None, repro)
        except StopIteration:
            pass
        except Exception as e:
            res.add(engine, profile, app["name"], "Veri kalıcılığı", KALDI, f"{cfg['label']}: {str(e).splitlines()[0][:200]}", None, repro)
    errs = drv.console_errors()
    if errs is None:
        res.add(engine, profile, app["name"], "Konsol hataları", ATLANDI, console_note or "bu sürücü konsolu okuyamaz", None, repro)
    else:
        errs = sorted(set(e for e in errs if "favicon" not in e))
        res.add(engine, profile, app["name"], "Konsol hataları", KALDI if errs else GECTI, " | ".join(errs)[:1500], None, repro)
    if server is not None and not journey_err:
        try:
            drv.reload()
            time.sleep(1.0)
            ctl = False
            for _ in range(30):
                if drv.js("(function(){return !!(navigator.serviceWorker && navigator.serviceWorker.controller);})"):
                    ctl = True
                    break
                time.sleep(0.5)
            server.stop()  # gercek cevrimdisi: sunucu kapali; tek kaynak service worker onbellegi
            try:
                drv.reload()
                time.sleep(2.0)
                poll(drv, app["offline"]["ready"], True, 12)
                r = layout()
                ok = not r["blank"]["blank"]
                p = shots_dir / f"{tag}-cevrimdisi.png"
                drv.shot(str(p))
                res.add(engine, profile, app["name"], "Çevrimdışı açılış", GECTI if ok else KALDI,
                        ("" if ok else "sunucu kapalıyken ana ekran boş") + ("" if ctl else " (not: sayfa service worker denetiminde değildi)"), rel(p), repro)
            finally:
                server.start()
        except Exception as e:
            res.add(engine, profile, app["name"], "Çevrimdışı açılış", KALDI, f"sunucu kapalıyken açılamadı: {str(e).splitlines()[0][:200]}", None, repro)
    else:
        res.add(engine, profile, app["name"], "Çevrimdışı açılış", ATLANDI, offline_note if not journey_err else "yolculuk tamamlanmadı", None, repro)
    res.add(engine, profile, app["name"], "Yazdırma sayfa sayısı", ATLANDI, "mobil tarayıcıdan PDF sayfa sayısı ölçülemez; gerçek cihaz yazdırma penceresi gerekir", None, repro)
