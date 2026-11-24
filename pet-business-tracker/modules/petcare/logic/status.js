// Randevu durumlari ve gecis kurallari. Saf islevler: DOM yok, ag yok.
// Akis: scheduled -> confirmed -> in_progress -> completed; scheduled / confirmed -> cancelled | no_show.
// Kapali durumlar (completed, cancelled, no_show) SONRADAN duzeltilebilir: scheduled'a geri alinir (yanlis dokunus, vazgecme, yeniden planlama).
// Gelir her zaman randevu kayitlarindan yeniden hesaplanir (logic/calc.js); geri alinca toplamlar kendiliginden duzelir.

export const STATUSES = Object.freeze(["scheduled", "confirmed", "in_progress", "completed", "cancelled", "no_show"]);
/** Takvimde yer tutan (cakisma sayilan) durumlar. */
export const ACTIVE_STATUSES = Object.freeze(["scheduled", "confirmed", "in_progress"]);
export const CLOSED_STATUSES = Object.freeze(["completed", "cancelled", "no_show"]);

export const TRANSITIONS = Object.freeze({
  scheduled: Object.freeze(["confirmed", "cancelled", "no_show"]),
  confirmed: Object.freeze(["in_progress", "cancelled", "no_show"]),
  in_progress: Object.freeze(["completed"]),
  completed: Object.freeze(["scheduled"]),
  cancelled: Object.freeze(["scheduled"]),
  no_show: Object.freeze(["scheduled"]),
});

const LABELS = Object.freeze({
  en: { scheduled: "Scheduled", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" },
  tr: { scheduled: "Planlandı", confirmed: "Onaylandı", in_progress: "Devam ediyor", completed: "Tamamlandı", cancelled: "İptal", no_show: "Gelmedi" },
});

export const isStatus = (s) => typeof s === "string" && STATUSES.includes(s);
export const isActive = (s) => ACTIVE_STATUSES.includes(s);
export const isClosed = (s) => CLOSED_STATUSES.includes(s);

/** Locale anahtari: petcare.status.<durum>. */
export const statusKey = (status) => `petcare.status.${status}`;

/** Durum adi; lang "en" | "tr" (bilinmeyen -> en). Bilinmeyen durum -> "". */
export function statusLabel(status, lang = "en") {
  if (!isStatus(status)) return "";
  return (LABELS[lang] ?? LABELS.en)[status];
}

/** from -> to gecisi izinli mi? Tanimsiz durum ya da ayni durum -> false. */
export function canTransition(from, to) {
  return isStatus(from) && isStatus(to) && TRANSITIONS[from].includes(to);
}

/** Bir durumdan gidilebilecek hedefler (STATUSES sirasinda). Bilinmeyen durum -> []. */
export function nextStatuses(from) {
  return isStatus(from) ? STATUSES.filter((to) => TRANSITIONS[from].includes(to)) : [];
}

/**
 * Bir aktif durumdan "completed"a giden izinli adim zinciri (TRANSITIONS'i BOZMADAN).
 * scheduled -> ["confirmed","in_progress","completed"], confirmed -> ["in_progress","completed"],
 * in_progress -> ["completed"]. Kapali durum ya da bilinmeyen durum -> [].
 * Amac: kullanici "Tamamla"yi tek dokunusla yapabilsin; ileri akis kurali degismez.
 */
export function pathToCompleted(from) {
  const chain = ["scheduled", "confirmed", "in_progress", "completed"];
  const i = chain.indexOf(from);
  return i < 0 ? [] : chain.slice(i + 1);
}
