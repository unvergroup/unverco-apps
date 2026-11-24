// Depoya yazilan metinlerden gorunmez / yon bicimleme karakterlerini atar (form yolu; Workbench core/sanitize.js'in kucuk kumesi).
// Denetim karakterleri (satir sonu ve sekme haric), sifir genislikli bosluk, yon gecersiz kilma / gomme / yalitim denetimleri, BOM,
// kelime birlestirici, gorunmez islemciler, etiket karakterleri. ZWJ / ZWNJ ve LRM / RLM kalir.
const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​‪-‮⁠-⁤⁦-⁩﻿᠎\u{E0000}-\u{E007F}]/gu;
export const stripInvisible = (s) => s.replace(STRIP, "");

export function cleanStrings(v) {
  if (typeof v === "string") return stripInvisible(v);
  if (Array.isArray(v)) return v.map(cleanStrings);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanStrings(x)]));
  return v;
}
