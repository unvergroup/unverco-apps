// Karar gosterimi. Dosyadaki karar korunur; yalniz iki durumda KATI tarafa cekilir (panel "SHIP" diyerek yanlis guven vermesin):
//   P0/P1 hata listede varsa -> DONT_SHIP;  ortam altyapi hatasiyla kosamadiysa -> INCOMPLETE.  Oncelik: DONT_SHIP > INCOMPLETE > SHIP.
export const PRIORITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2 });

export function effectiveVerdict(data) {
  const file = data.summary.verdict;
  if (file === "DONT_SHIP") return { verdict: "DONT_SHIP", adjusted: false, reason: null };
  if (data.failures.some((f) => f.priority === "P0" || f.priority === "P1")) {
    return { verdict: "DONT_SHIP", adjusted: file !== "DONT_SHIP", reason: "failures" };
  }
  if (file === "INCOMPLETE") return { verdict: "INCOMPLETE", adjusted: false, reason: null };
  if (data.environments.some((e) => e.status === "infra")) return { verdict: "INCOMPLETE", adjusted: true, reason: "infra" };
  return { verdict: "SHIP", adjusted: false, reason: null };
}

export const VERDICT_KEY = Object.freeze({ SHIP: "verdict.ship", DONT_SHIP: "verdict.dontship", INCOMPLETE: "verdict.incomplete" });
export const VERDICT_CLASS = Object.freeze({ SHIP: "ship", DONT_SHIP: "dont", INCOMPLETE: "incomplete" });
export const VERDICT_ICON = Object.freeze({ SHIP: "circle-check", DONT_SHIP: "circle-alert", INCOMPLETE: "triangle-alert" });

// Hata listesi: P0 -> P1 -> P2, sonra kimlik (F2 < F10, dogal sira).
export function sortFailures(list) {
  const num = (id) => { const m = /(\d+)\s*$/.exec(id); return m ? Number(m[1]) : Infinity; };
  return [...list].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || num(a.id) - num(b.id) || a.id.localeCompare(b.id));
}

export function filterFailures(list, { environment = "all", priority = "all" } = {}) {
  return list.filter((f) => (environment === "all" || f.environment === environment) && (priority === "all" || f.priority === priority));
}

export const failureEnvironments = (data) => [...new Set(data.failures.map((f) => f.environment).filter(Boolean))];

// run_url yalniz github.com (https) ise baglanti olur; baska her sey duz metin kalir.
export function safeRunUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" && (x.hostname === "github.com" || x.hostname.endsWith(".github.com")) ? x.href : null; } catch { return null; }
}
