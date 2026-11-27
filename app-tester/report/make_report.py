#!/usr/bin/env python3
"""Builds an English Markdown report from the results JSON files.
Usage: python app-tester/report/make_report.py --in <dir> --out <dir> [--title ...] [--summary $GITHUB_STEP_SUMMARY] [--gate]
Every results.json (and the meta.json next to it) under --in is collected. --gate: exit code 1 if anything FAILED."""
import argparse, collections, json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
from qa_common import CHECK_PRIORITY, PASSED, FAILED, SKIPPED, WARNING

NO_DEVICES = "Real devices are not used."


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
    if FAILED in sts: return "F"
    if WARNING in sts: return "W"
    if all(s == SKIPPED for s in sts): return "-"
    return "P"


def build(rows, metas, title):
    L = []
    cnt = collections.Counter(r["status"] for r in rows)
    L.append(f"# {title}\n")
    L.append(f"> {NO_DEVICES} Results come from desktop emulation, an Android emulator and the iOS Simulator. Test on physical phones before a major release.\n")
    L.append(f"**Overall:** PASSED {cnt[PASSED]} | FAILED {cnt[FAILED]} | WARNING {cnt[WARNING]} | SKIPPED {cnt[SKIPPED]}\n")
    if metas:
        L.append("**Environment notes:** " + "; ".join(f"{m.get('engine', m['_dir'])}: " + ", ".join(f"{k}={v}" for k, v in m.items() if k not in ('_dir', 'engine')) for m in metas) + "\n")
    # 1) summary
    L.append("## Summary table (environment / engine / app)\n")
    L.append("| Environment | Engine | App | PASSED | FAILED | WARNING | SKIPPED |\n|---|---|---|---:|---:|---:|---:|")
    g = collections.defaultdict(collections.Counter)
    for r in rows:
        g[(r["env"], r["engine"], r["app"])][r["status"]] += 1
    for (env, eng, app), c in sorted(g.items()):
        L.append(f"| {env} | {eng} | {app} | {c[PASSED]} | {c[FAILED]} | {c[WARNING]} | {c[SKIPPED]} |")
    L.append("")
    # 2) prioritized issues
    L.append("## Prioritized issue list\n")
    groups = collections.OrderedDict()
    for r in rows:
        if r["status"] not in (FAILED, WARNING):
            continue
        key = (r["status"], r["app"], r["check"], (r["detail"] or "")[:140] if r["check"] not in ("Touch target 44px", "Clipped text") else "")
        e = groups.setdefault(key, dict(rows=[]))
        e["rows"].append(r)

    def sk(k):
        return (0 if k[0] == FAILED else 1, CHECK_PRIORITY.get(k[2], "P9"), k[1])
    if not groups:
        L.append("No issues.\n")
    for i, (k, e) in enumerate(sorted(groups.items(), key=lambda kv: sk(kv[0])), 1):
        r0 = e["rows"][0]
        envs = sorted({f"{x['env']} / {x['engine']}" for x in e["rows"]})
        prof = sorted({x["profile"] for x in e["rows"]})
        L.append(f"### {i}. [{CHECK_PRIORITY.get(k[2], 'P9')}] {k[1]}: {k[2]} ({k[0]})\n")
        L.append(f"- Environment: {', '.join(envs)}")
        L.append(f"- Profiles ({len(prof)}): {', '.join(prof)}")
        L.append(f"- Detail: {r0['detail'][:700]}")
        if r0.get("shot"):
            L.append(f"- Screenshot: `{r0['_dir']}/{r0['shot']}`")
        L.append(f"- How to reproduce: {r0.get('repro') or '-'}\n")
    # 3) compatibility matrix
    L.append("## Compatibility matrix (P=passed, F=failed, W=warning, -=skipped)\n")
    by = collections.defaultdict(list)
    for r in rows:
        by[(r["env"], r["engine"], r["app"])].append(r)
    for (env, eng, app), rs in sorted(by.items()):
        profs = list(dict.fromkeys(r["profile"] for r in rs))
        checks = list(dict.fromkeys(r["check"] for r in rs))
        L.append(f"### {app} | {eng} | {env}\n")
        L.append("| Check | " + " | ".join(profs) + " |\n|---|" + "---|" * len(profs))
        for c in checks:
            L.append(f"| {c} | " + " | ".join(cell([r["status"] for r in rs if r["check"] == c and r["profile"] == p] or [SKIPPED]) for p in profs) + " |")
        L.append("")
    # 4) skipped
    skipped = collections.OrderedDict()
    for r in rows:
        if r["status"] == SKIPPED:
            skipped.setdefault((r["engine"], r["check"], r["detail"]), []).append(r["profile"])
    L.append("## Skipped checks\n")
    if not skipped:
        L.append("None.\n")
    for (eng, c, d), ps in skipped.items():
        L.append(f"- {eng} | {c} | {d} ({len(ps)} profiles)")
    L.append("")
    return "\n".join(L), cnt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="ÜNVERCO App Tester report")
    ap.add_argument("--summary")
    ap.add_argument("--gate", action="store_true")
    a = ap.parse_args()
    rows, metas = load(a.inp)
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if not rows:
        print("No results found", file=sys.stderr)
        return 2
    md, cnt = build(rows, metas, a.title)
    (out / "app-tester-report.md").write_text(md, encoding="utf-8")
    (out / "all-rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    sm = a.summary or os.environ.get("GITHUB_STEP_SUMMARY")
    if sm:
        # The job summary is limited to 1 MiB: truncate here, the full text is in the artifact.
        with open(sm, "a", encoding="utf-8") as f:
            f.write(md[:900000] + "\n")
    print(md[:3000])
    return 1 if (a.gate and cnt[FAILED]) else 0


if __name__ == "__main__":
    sys.exit(main())
