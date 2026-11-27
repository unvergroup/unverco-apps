#!/usr/bin/env python3
"""Combines the results of all environments into app-tester-results.json + an English Markdown report.
Usage: python app-tester/report/build_results.py --in <dir> --out <dir> [--expect web-chromium,android-emulator,...] [--gate]
--in holds the raw output folders of the environment jobs (each with results.json, meta.json, screenshots/).
Verdict: DONT_SHIP if anything FAILED; else INCOMPLETE if an environment could not run or was missing; else SHIP.
Exit code with --gate: 1 if anything FAILED."""
import argparse, collections, datetime, json, os, pathlib, shutil, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_common import CHECK_PRIORITY, KIT_VERSION, PASSED, FAILED, SKIPPED, WARNING
import make_report
from fix_prompts import build_prompt

NOTE_DEVICES = "Real devices are not used. Results come from desktop emulation, an Android emulator and the iOS Simulator."
KIND = {"web": "desktop-emulation", "android": "emulator", "ios": "simulator"}
ENV_NAME = {"web": "Desktop emulation", "android": "Android emulator", "ios": "iOS Simulator"}


def env_id_of(dirname):
    """Maps a raw output folder name to an environment id."""
    n = pathlib.Path(dirname).name
    if n.startswith("web-"):
        return n
    if n.startswith("android"):
        return "android-emulator"
    if n.startswith("ios"):
        return "ios-simulator"
    return n


def env_kind(eid):
    return KIND["web" if eid.startswith("web-") else "android" if eid.startswith("android") else "ios"]


def prio(check, level):
    if level == "warning":
        return "P2"
    p = CHECK_PRIORITY.get(check, "P2")
    return "P2" if p == "P3" else p


def collect(inp):
    """Returns {env_id: {"rows": [...], "metas": [...], "dirs": [...], "infra": [reasons]}}."""
    envs = collections.OrderedDict()
    root = pathlib.Path(inp)
    seen = set()
    for f in sorted(root.rglob("results.json")):
        d = f.parent
        eid = env_id_of(d)
        e = envs.setdefault(eid, dict(rows=[], metas=[], dirs=[], infra=[]))
        rel = str(d.relative_to(root))
        e["dirs"].append(d)
        for r in json.loads(f.read_text(encoding="utf-8")):
            r["_dir"], r["_abs"] = rel, str(d)
            e["rows"].append(r)
        m = d / "meta.json"
        if m.exists():
            meta = json.loads(m.read_text(encoding="utf-8"))
            e["metas"].append(dict(meta, _dir=rel))
            if meta.get("infra_error"):
                e["infra"].append("the environment reported an infrastructure error")
        marker = d / "infra-exit.txt"
        if marker.exists() and marker.read_text().strip() not in ("", "0"):
            e["infra"].append(f"the test step ended with exit code {marker.read_text().strip()}")
        seen.add(eid)
    # folders with only a marker (no results.json) are infrastructure failures too
    for marker in sorted(root.rglob("infra-exit.txt")):
        eid = env_id_of(marker.parent)
        if eid not in envs and marker.read_text().strip() not in ("", "0"):
            envs[eid] = dict(rows=[], metas=[], dirs=[marker.parent], infra=[f"the test step ended with exit code {marker.read_text().strip()}"])
    return envs


def env_label(eid, e):
    profiles = len({r["profile"] for r in e["rows"]})
    m = e["metas"][0] if e["metas"] else {}
    if eid == "web-webkit":
        return f"Safari engine (WebKit), {profiles} device profiles"
    if eid == "web-chromium":
        return f"Chrome engine (Chromium), {profiles} device profiles"
    if eid == "web-firefox":
        return f"Firefox engine, {profiles} device profiles"
    if eid == "android-emulator":
        return f"Android {m['android']} (API {m['api']}) emulator, Chrome" if m.get("android") else "Android emulator, Chrome"
    if eid == "ios-simulator":
        for mm in e["metas"]:
            if mm.get("device"):
                return f"{mm['device']} (iOS {mm.get('ios', '?')} simulator), Mobile Safari"
        return "iPhone simulator, Mobile Safari"
    return eid


def build_failures(envs, app_label_by_env):
    groups = collections.OrderedDict()
    for eid, e in envs.items():
        for r in e["rows"]:
            if r["status"] not in (FAILED, WARNING):
                continue
            level = "failed" if r["status"] == FAILED else "warning"
            groups.setdefault((eid, r["app"], r["check"], level), []).append(r)
    items = []
    for (eid, app, check, level), rs in groups.items():
        r0 = rs[0]
        profiles = list(dict.fromkeys(r["profile"] for r in rs))
        shot = None
        for r in rs:
            if r.get("shot"):
                s = pathlib.PurePosixPath(r['shot'])
                shot = f"screenshots/{pathlib.Path(r['_dir']).name}/{s.relative_to('screenshots') if s.parts[0] == 'screenshots' else s}"
                break
        items.append(dict(
            priority=prio(check, level), level=level, app=app, environment=eid, profile=profiles[0],
            check=check, message=(r0["detail"] or "")[:600], screenshot=shot, repro=r0.get("repro") or "",
            _extra=len(profiles) - 1, _all_profiles=profiles))
    order = {"P0": 0, "P1": 1, "P2": 2}
    items.sort(key=lambda x: (0 if x["level"] == "failed" else 1, order[x["priority"]], x["environment"]))
    for i, it in enumerate(items, 1):
        it["id"] = f"F{i}"
        it["fix_prompt"] = build_prompt(dict(
            app=it["app"], environment=it["environment"], env_label=app_label_by_env[it["environment"]],
            profile=it["profile"], check=it["check"], message=it["message"], repro=it["repro"],
            level=it["level"], extra_profiles=it["_extra"]))
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--expect", default="", help="comma-separated environment ids that must have run")
    ap.add_argument("--title", default="ÜNVERCO App Tester report")
    ap.add_argument("--gate", action="store_true")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    envs = collect(a.inp)
    for x in [x for x in a.expect.split(",") if x]:
        envs.setdefault(x, dict(rows=[], metas=[], dirs=[], infra=["no results were produced (the job may have failed before the tests started)"]))
    if not envs:
        print("No results found", file=sys.stderr)
        return 2

    repo = os.environ.get("GITHUB_REPOSITORY", "local/unknown")
    run_url = ""
    if os.environ.get("GITHUB_RUN_ID") and os.environ.get("GITHUB_REPOSITORY"):
        run_url = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{repo}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    now = datetime.datetime.now(datetime.timezone.utc)
    duration = 0
    started = os.environ.get("APP_TESTER_RUN_STARTED")
    if started:
        try:
            duration = max(0, int((now - datetime.datetime.fromisoformat(started.replace("Z", "+00:00"))).total_seconds()))
        except ValueError:
            duration = 0

    env_list, all_rows, labels = [], [], {}
    for eid, e in envs.items():
        c = collections.Counter(r["status"] for r in e["rows"])
        infra = bool(e["infra"]) or not e["rows"]
        status = "infra" if infra else "failed" if c[FAILED] else "passed"
        labels[eid] = env_label(eid, e)
        env_list.append(dict(id=eid, kind=env_kind(eid), label=labels[eid], status=status,
                             passed=c[PASSED], failed=c[FAILED], run_url=run_url))
        all_rows += e["rows"]
        # copy screenshots next to the JSON
        for d in e["dirs"]:
            src = d / "screenshots"
            if src.is_dir():
                shutil.copytree(src, out / "screenshots" / d.name, dirs_exist_ok=True)

    failures = build_failures(envs, labels)
    tot = collections.Counter(r["status"] for r in all_rows)
    infra_envs = [x for x in env_list if x["status"] == "infra"]
    any_failed = tot[FAILED] > 0
    ran = any(x["status"] != "infra" for x in env_list)
    verdict = "DONT_SHIP" if any_failed else "INCOMPLETE" if (infra_envs or not ran) else "SHIP"

    notes = [NOTE_DEVICES]
    for x in infra_envs:
        why = "; ".join(envs[x["id"]]["infra"]) or "no results"
        notes.append(f"{x['id']} could not run completely ({why}). This is an infrastructure problem, not a product failure; see the job log.")
    if tot[SKIPPED]:
        notes.append(f"{tot[SKIPPED]} checks were skipped because they do not apply (see the report for reasons).")

    clean = [{k: v for k, v in f.items() if not k.startswith("_")} for f in failures]
    result = {
        "tool": "unverco-app-tester", "schema": 1, "kit_version": KIT_VERSION,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "repo": repo,
        "commit": (os.environ.get("GITHUB_SHA") or "local")[:7],
        "summary": {"verdict": verdict, "passed": tot[PASSED], "failed": tot[FAILED], "warnings": tot[WARNING],
                    "skipped": tot[SKIPPED], "duration_sec": duration},
        "environments": env_list, "failures": clean, "notes": notes,
    }
    (out / "app-tester-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    md, _ = make_report.build(all_rows, [m for e in envs.values() for m in e["metas"]], a.title)
    head = [f"## Verdict: {verdict}", "",
            {"SHIP": "No failed checks in the environments that ran.",
             "DONT_SHIP": "At least one check failed. Fix the failures below, then run the workflow again.",
             "INCOMPLETE": "No check failed, but at least one environment could not run completely."}[verdict], ""]
    for n in notes[1:]:
        head.append(f"- {n}")
    head.append("")
    body = "\n".join(head) + "\n" + md
    if failures:
        body += "\n## Ready-to-paste fix prompts\n\nCopy a prompt into your AI coding assistant. The same prompts are in `app-tester-results.json`.\n"
        for f in failures:
            body += (f"\n<details><summary>{f['id']} [{f['priority']}] {f['check']}: {f['app']} ({f['environment']}, {f['level']})</summary>\n\n"
                     f"```text\n{f['fix_prompt']}\n```\n\n</details>\n")
    (out / "app-tester-report.md").write_text(body, encoding="utf-8")
    sm = os.environ.get("GITHUB_STEP_SUMMARY")
    if sm:
        with open(sm, "a", encoding="utf-8") as fh:
            fh.write(body[:900000] + "\n")
    print(f"VERDICT {verdict}: passed={tot[PASSED]} failed={tot[FAILED]} warnings={tot[WARNING]} skipped={tot[SKIPPED]} failures_listed={len(failures)}")
    return 1 if (a.gate and any_failed) else 0


if __name__ == "__main__":
    sys.exit(main())
