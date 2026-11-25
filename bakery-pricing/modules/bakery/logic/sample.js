// Ornek veri (uydurma ama gercekci; gercek kisi / marka adi yok). Tarihler bugune gore kurulur ki "yaklasan" ve "bu ay" ekranlari dolu gorunsun.
// Fiyatlar ABD market fiyatlari duzeyinde ornek degerlerdir [Varsayim]; kullanici kendi alis fiyatini yazar.
// Kayitlar source: "sample" tasir; "Ornek veriyi kaldir" yalniz bunlari siler. Ad metinleri dil dosyasindan gelir (sample.* anahtarlari).
import { addDays } from "../../../core/dates.js";

// [anahtar, paket miktari, birim, fiyat (sent), 1 cup = g]
export const SAMPLE_INGREDIENTS = Object.freeze([
  ["flour", 5, "lb", 429, 120],
  ["sugar", 4, "lb", 389, 200],
  ["butter", 1, "lb", 499, 227],
  ["eggs", 12, "pc", 349, null],
  ["milk", 1.893, "l", 329, null],
  ["vanilla", 59, "ml", 599, null],
  ["bakingPowder", 8.1, "oz", 249, 230],
  ["salt", 26, "oz", 129, 288],
  ["cocoa", 8, "oz", 399, 85],
  ["powderedSugar", 2, "lb", 279, 120],
  ["creamCheese", 8, "oz", 249, null],
  ["chocChips", 12, "oz", 329, 170],
]);
// [anahtar, verim, satirlar [malzeme, miktar, birim], ambalaj (sent), iscilik dk, satis fiyati (sent, birim basina)]
export const SAMPLE_RECIPES = Object.freeze([
  ["cupcakes", 24, [["flour", 2.5, "cup"], ["sugar", 1.5, "cup"], ["butter", 1, "cup"], ["eggs", 4, "pc"], ["milk", 1, "cup"], ["vanilla", 1, "tbsp"], ["bakingPowder", 2.5, "tsp"], ["salt", 0.5, "tsp"]], 300, 90, 350],
  ["cookies", 36, [["flour", 2.25, "cup"], ["butter", 1, "cup"], ["sugar", 0.75, "cup"], ["eggs", 2, "pc"], ["vanilla", 1, "tsp"], ["chocChips", 2, "cup"], ["salt", 1, "tsp"]], 150, 60, 125],
  ["cheesecake", 12, [["creamCheese", 32, "oz"], ["sugar", 1, "cup"], ["eggs", 4, "pc"], ["vanilla", 1, "tsp"], ["butter", 0.5, "cup"]], 250, 120, 450],
  ["layerCake", 16, [["flour", 3, "cup"], ["sugar", 2, "cup"], ["butter", 1.5, "cup"], ["eggs", 5, "pc"], ["milk", 1.25, "cup"], ["vanilla", 1, "tbsp"], ["bakingPowder", 1, "tbsp"], ["powderedSugar", 4, "cup"], ["cocoa", 0.75, "cup"]], 400, 240, 900],
]);
// Metrik ornek (es / fr / de / pt arayuzu): paketler kg / g / l / ml, tarifler gram ve mililitre. Ayni tarifler, ayni satis fiyatlari.
export const SAMPLE_INGREDIENTS_METRIC = Object.freeze([
  ["flour", 1, "kg", 129, null], ["sugar", 1, "kg", 139, null], ["butter", 250, "g", 299, null], ["eggs", 12, "pc", 359, null],
  ["milk", 1, "l", 119, null], ["vanilla", 50, "ml", 549, null], ["bakingPowder", 100, "g", 149, null], ["salt", 1, "kg", 69, null],
  ["cocoa", 250, "g", 379, null], ["powderedSugar", 500, "g", 169, null], ["creamCheese", 200, "g", 219, null], ["chocChips", 200, "g", 269, null],
]);
export const SAMPLE_RECIPES_METRIC = Object.freeze([
  ["cupcakes", 24, [["flour", 300, "g"], ["sugar", 300, "g"], ["butter", 225, "g"], ["eggs", 4, "pc"], ["milk", 240, "ml"], ["vanilla", 15, "ml"], ["bakingPowder", 12, "g"], ["salt", 3, "g"]], 300, 90, 350],
  ["cookies", 36, [["flour", 280, "g"], ["butter", 225, "g"], ["sugar", 150, "g"], ["eggs", 2, "pc"], ["vanilla", 5, "ml"], ["chocChips", 340, "g"], ["salt", 6, "g"]], 150, 60, 125],
  ["cheesecake", 12, [["creamCheese", 900, "g"], ["sugar", 200, "g"], ["eggs", 4, "pc"], ["vanilla", 5, "ml"], ["butter", 115, "g"]], 250, 120, 450],
  ["layerCake", 16, [["flour", 360, "g"], ["sugar", 400, "g"], ["butter", 340, "g"], ["eggs", 5, "pc"], ["milk", 300, "ml"], ["vanilla", 15, "ml"], ["bakingPowder", 14, "g"], ["powderedSugar", 480, "g"], ["cocoa", 65, "g"]], 400, 240, 900],
]);
// [musteri, gun farki, saat, durum, kalemler [tarif, adet, birim fiyat sent], teslimat, indirim, kapora]
export const SAMPLE_ORDERS = Object.freeze([
  ["c1", 1, "10:00", "in_progress", [["cupcakes", 24, 350]], 0, 0, 4200],
  ["c2", 2, "15:30", "confirmed", [["layerCake", 16, 900]], 1000, 0, 4500],
  ["c3", 4, "11:00", "confirmed", [["cookies", 36, 125], ["cupcakes", 12, 350]], 0, 0, 3000],
  ["c4", 8, "", "inquiry", [["cheesecake", 12, 450]], 0, 0, 0],
  ["c5", -2, "09:00", "delivered", [["cookies", 48, 125]], 0, 0, 2000],
  ["c6", -3, "16:00", "paid", [["layerCake", 16, 900], ["cookies", 24, 125]], 800, 500, 4000],
  ["c7", -6, "12:00", "paid", [["cupcakes", 36, 350]], 0, 0, 6300],
  ["c1", -9, "14:00", "paid", [["cheesecake", 12, 450]], 0, 0, 2700],
  ["c8", -5, "", "cancelled", [["cupcakes", 12, 350]], 0, 0, 0],
]);
export const SAMPLE_PHONES = Object.freeze({ c1: "(555) 010-2231", c2: "(555) 010-4410", c3: "(555) 010-7782", c4: "(555) 010-3109", c5: "(555) 010-5523", c6: "(555) 010-8846", c7: "(555) 010-1907", c8: "(555) 010-6650" });

/**
 * Ornek kayitlari depoya TEK islemde ekler (mevcut veriye dokunmaz). t: sozluk islevi (ad metinleri); metric: kg/g/l/ml ornegi.
 * Donus: eklenen kayit sayisi.
 */
export async function addSampleData(store, { t, today, metric = false }) {
  const INGS = metric ? SAMPLE_INGREDIENTS_METRIC : SAMPLE_INGREDIENTS;
  const RECS = metric ? SAMPLE_RECIPES_METRIC : SAMPLE_RECIPES;
  return store.transactMany(["ingredients", "recipes", "orders"], (tx) => {
    const ing = new Map();
    for (const [k, q, u, p, d] of INGS) {
      const r = tx.add("ingredients", { name: t(`sample.ing.${k}`), pkgQty: q, pkgUnit: u, pkgPriceMinor: p, gramsPerCup: d, note: "", source: "sample" });
      ing.set(k, r.id);
    }
    const rec = new Map();
    for (const [k, y, lines, pack, labor, sale] of RECS) {
      const r = tx.add("recipes", {
        name: t(`sample.rec.${k}`), items: lines.map(([i, qty, unit]) => ({ ingredientId: ing.get(i), qty, unit })), yieldQty: y, yieldUnit: t(`sample.yield.${k}`),
        packagingMinor: pack, laborMinutes: labor, overheadPct: null, salePriceMinor: sale, note: "", source: "sample",
      });
      rec.set(k, { id: r.id, name: r.name });
    }
    let n = INGS.length + RECS.length;
    for (const [c, dd, time, status, items, fee, disc, dep] of SAMPLE_ORDERS) {
      tx.add("orders", {
        serial: tx.nextNumber("O"), customerName: t(`sample.cust.${c}`), phone: SAMPLE_PHONES[c], email: "", date: addDays(today, dd), time,
        items: items.map(([k, qty, price]) => ({ recipeId: rec.get(k).id, name: rec.get(k).name, qty, unitPriceMinor: price })),
        deliveryFeeMinor: fee, discountMinor: disc, depositMinor: dep, status, note: dd === 2 ? t("sample.note.cake") : "", source: "sample",
      });
      n += 1;
    }
    return n;
  });
}

/** Ornek kayitlari siler (source === "sample"). Kullanicinin kendi kayitlarina dokunmaz. Donus: silinen sayi. */
export async function removeSampleData(store) {
  return store.transactMany(["ingredients", "recipes", "orders"], (tx) => {
    let n = 0;
    for (const c of ["orders", "recipes", "ingredients"]) for (const r of tx.list(c)) if (r.source === "sample") { tx.remove(c, r.id); n += 1; }
    return n;
  });
}
