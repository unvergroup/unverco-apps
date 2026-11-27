// app-tester-results.json dogrulamasi (sema 1). Saf islev: ag yok, depo yok. Bozuk dosya uygulamayi COKERTMEZ: { ok: false, code, params }.
// code degerleri locales/*.js icindeki "import.err.*" anahtarlarina eslenir (core/safe.js errorKey). Duzenlenmis (temiz) kopya doner:
// bilinmeyen alanlar atilir, metinlerden gorunmez karakterler atilir, uzunluklar sinirlanir.
import { cleanStrings } from "../../../core/sanitize.js";

export const TOOL = "unverco-app-tester";
export const SCHEMA = 1;
export const MAX_BYTES = 5 * 1024 * 1024;
export const LIMITS = Object.freeze({ failures: 500, environments: 50, notes: 50, text: 2000, prompt: 20000 });
export const VERDICTS = Object.freeze(["SHIP", "DONT_SHIP", "INCOMPLETE"]);
export const PRIORITIES = Object.freeze(["P0", "P1", "P2"]);
export const KINDS = Object.freeze(["desktop-emulation", "emulator", "simulator"]);
export const ENV_STATUS = Object.freeze(["passed", "failed", "infra"]);

class Bad extends Error {
  constructor(code, params = {}) { super(code); this.name = "ImportError"; this.code = code; this.params = params; }
}
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const bad = (path) => new Bad("bad_field", { field: path });

function str(o, key, path, { max = LIMITS.text, required = false, allowEmpty = true } = {}) {
  const v = o[key];
  if (v === undefined || v === null) { if (required) throw bad(path); return ""; }
  if (typeof v !== "string") throw bad(path);
  if (!allowEmpty && !v.trim()) throw bad(path);
  return v.length > max ? v.slice(0, max) : v;
}
function num(o, key, path) {
  const v = o[key];
  if (v === undefined || v === null) return 0;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9) throw bad(path);
  return v;
}
function oneOf(o, key, path, list) {
  const v = o[key];
  if (typeof v !== "string" || !list.includes(v)) throw bad(path);
  return v;
}

/** input: JSON metni ya da cozulmus nesne. Doner { ok: true, data } | { ok: false, code, params }. */
export function validateResults(input) {
  try {
    let raw = input;
    if (typeof input === "string") {
      if (input.length > MAX_BYTES) throw new Bad("too_large");
      const text = input.replace(/^﻿/, "");
      if (!text.trim()) throw new Bad("empty");
      try { raw = JSON.parse(text); } catch { throw new Bad("not_json"); }
    }
    if (!isObj(raw)) throw new Bad("not_object");
    if (raw.tool !== TOOL) throw new Bad("wrong_tool");
    if (typeof raw.schema !== "number" || !Number.isInteger(raw.schema) || raw.schema < 1) throw new Bad("bad_schema");
    if (raw.schema > SCHEMA) throw new Bad("newer_schema", { n: raw.schema });
    raw = cleanStrings(raw);
    if (!isObj(raw.summary)) throw bad("summary");
    if (!Array.isArray(raw.environments)) throw bad("environments");
    if (!Array.isArray(raw.failures)) throw bad("failures");
    if (raw.environments.length > LIMITS.environments) throw new Bad("too_many", { what: "environments", max: LIMITS.environments });
    if (raw.failures.length > LIMITS.failures) throw new Bad("too_many", { what: "failures", max: LIMITS.failures });
    if (raw.notes !== undefined && raw.notes !== null && !Array.isArray(raw.notes)) throw bad("notes");
    const generatedAt = str(raw, "generated_at", "generated_at", { max: 40, required: true, allowEmpty: false });
    if (Number.isNaN(Date.parse(generatedAt))) throw bad("generated_at");
    const s = raw.summary;
    const data = {
      tool: TOOL,
      schema: SCHEMA,
      kit_version: str(raw, "kit_version", "kit_version", { max: 40 }),
      generated_at: generatedAt,
      repo: str(raw, "repo", "repo", { max: 200 }),
      commit: str(raw, "commit", "commit", { max: 80 }),
      summary: {
        verdict: oneOf(s, "verdict", "summary.verdict", VERDICTS),
        passed: num(s, "passed", "summary.passed"),
        failed: num(s, "failed", "summary.failed"),
        warnings: num(s, "warnings", "summary.warnings"),
        skipped: num(s, "skipped", "summary.skipped"),
        duration_sec: num(s, "duration_sec", "summary.duration_sec"),
      },
      environments: raw.environments.map((e, i) => {
        const p = `environments[${i}]`;
        if (!isObj(e)) throw bad(p);
        return {
          id: str(e, "id", `${p}.id`, { max: 80, required: true, allowEmpty: false }),
          kind: oneOf(e, "kind", `${p}.kind`, KINDS),
          label: str(e, "label", `${p}.label`, { required: true }),
          status: oneOf(e, "status", `${p}.status`, ENV_STATUS),
          passed: num(e, "passed", `${p}.passed`),
          failed: num(e, "failed", `${p}.failed`),
          run_url: str(e, "run_url", `${p}.run_url`, { max: 500 }),
        };
      }),
      failures: raw.failures.map((f, i) => {
        const p = `failures[${i}]`;
        if (!isObj(f)) throw bad(p);
        return {
          id: str(f, "id", `${p}.id`, { max: 80, required: true, allowEmpty: false }),
          priority: oneOf(f, "priority", `${p}.priority`, PRIORITIES),
          app: str(f, "app", `${p}.app`, { max: 200 }),
          environment: str(f, "environment", `${p}.environment`, { max: 80 }),
          profile: str(f, "profile", `${p}.profile`),
          check: str(f, "check", `${p}.check`),
          message: str(f, "message", `${p}.message`),
          screenshot: str(f, "screenshot", `${p}.screenshot`, { max: 500 }),
          repro: str(f, "repro", `${p}.repro`, { max: LIMITS.prompt }),
          fix_prompt: str(f, "fix_prompt", `${p}.fix_prompt`, { max: LIMITS.prompt, required: true, allowEmpty: false }),
        };
      }),
      notes: (raw.notes ?? []).map((n, i) => { if (typeof n !== "string") throw bad(`notes[${i}]`); return n.slice(0, LIMITS.text); }),
    };
    return { ok: true, data };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, code: e.code, params: e.params };
    return { ok: false, code: "not_json", params: {} }; // beklenmeyen bicim: yine cokmez
  }
}
