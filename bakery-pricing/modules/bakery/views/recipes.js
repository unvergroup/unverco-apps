// Tarifler ekrani: her tarif icin parti maliyeti, birim maliyet, onerilen fiyat ve kullanicinin satis fiyatiyla kar / zarar uyarisi.
// Tarif formu: malzeme satirlari (malzeme + miktar + birim); birim malzemenin paket birimine cevrilemiyorsa satir KAYDEDILMEZ ve
// "1 cup = ? g ekleyin" hatasi gosterilir. Formun altinda maliyet canli hesaplanir.
import { add, button, field, h, put } from "../../../core/ui.js";
import { cleanRecord, LIMITS } from "../logic/schema.js";
import { recipeCost } from "../logic/costing.js";
import { convertible } from "../logic/units.js";
import { recipeCardDoc } from "../print/docs.js";
import { labels, printDoc } from "../print/screens.js";
import { emptyBox, loadAll, moneyField, numberField, openForm, openModal, printButton, qtyText, selectField, unitLabel, unitOptions, yieldText } from "./common.js";

const SALE_BADGE = { loss: "badge-danger", below: "badge-warn", ok: "badge-ok" };
export const saleBadge = (ctx, sale) => (sale.status === "none" ? null : h("span", { class: `badge ${SALE_BADGE[sale.status]}`, "data-sale": sale.status, text: ctx.i18n.t(`cost.badge.${sale.status}`) }));

/** Maliyet dokumu (ekran): ayni kalemler basili kartta da var. */
export function costBreakdown(ctx, recipe, c, prefs) {
  const { t, formatPercent } = ctx.i18n;
  const f = ctx.money.format;
  const row = (k, v, strong = false, id) => h("tr", { class: strong ? "is-total" : undefined, id }, h("td", { text: k }), h("td", { class: "num", text: v }));
  const rows = [
    row(t("cost.ingredients"), f(c.ingredientsMinor)),
    row(t("cost.packaging"), f(c.packagingMinor)),
    row(t("cost.laborLine", { min: recipe.laborMinutes ?? 0, rate: f(prefs.hourlyRateMinor) }), f(c.laborMinor)),
    row(t("cost.overheadLine", { pct: formatPercent(c.overheadPct) }), f(c.overheadMinor)),
    row(t("cost.batch"), f(c.batchMinor), true, "cost-batch"),
    row(t("cost.perUnit", { unit: recipe.yieldUnit || t("recipe.unitsDefault") }), f(c.unitMinor), true, "cost-unit"),
  ];
  if (c.suggestedUnitMinor !== null) rows.push(row(t(`cost.suggested.${prefs.pricingMode}`, { pct: formatPercent(prefs.targetPct) }), f(c.suggestedUnitMinor), true, "cost-suggested"), row(t("cost.suggestedBatch"), f(c.suggestedBatchMinor)));
  if (c.sale.status !== "none") {
    rows.push(row(t("cost.yourPrice"), f(c.sale.priceMinor), false, "cost-your"), row(t("cost.profitPerUnit"), f(c.sale.profitMinor), false, "cost-profit"));
    if (c.sale.marginPct !== null) rows.push(row(t("cost.margin"), formatPercent(c.sale.marginPct)));
  }
  const warn = [];
  if (c.missing) warn.push(h("p", { class: "banner banner-warn", id: "cost-missing", text: t("cost.missingNote", { n: c.missing }) }));
  if (c.sale.status === "loss") warn.push(h("p", { class: "banner banner-error", id: "cost-warn", role: "alert", text: t("cost.warn.loss") }));
  else if (c.sale.status === "below") warn.push(h("p", { class: "banner banner-warn", id: "cost-warn", text: t("cost.warn.below") }));
  return h("div", { class: "stack cost-box" }, ...warn, h("table", { class: "rc-totals cost-table" }, h("tbody", {}, rows)));
}

export async function openRecipeForm(ctx, recipe = null, data = null) {
  const { t } = ctx.i18n;
  data = data ?? (await loadAll(ctx));
  const { ingredients, prefs } = data;
  const ingById = new Map(ingredients.map((i) => [i.id, i]));
  const name = field({ label: t("recipe.name"), value: recipe?.name ?? "", maxlength: LIMITS.name, required: true, autocomplete: "off", id: "rec-name" });
  const yieldQty = numberField(ctx, { label: t("recipe.yield"), value: recipe?.yieldQty ?? null, id: "rec-yield", required: true, hint: t("recipe.yieldHint") });
  const yieldUnit = field({ label: t("recipe.yieldUnit"), value: recipe?.yieldUnit ?? "", maxlength: LIMITS.yieldUnit, autocomplete: "off", id: "rec-yield-unit", placeholder: t("recipe.unitsDefault") });
  const packaging = moneyField(ctx, { label: t("recipe.packaging"), value: recipe?.packagingMinor ?? null, id: "rec-pack", hint: t("recipe.packagingHint") });
  const labor = numberField(ctx, { label: t("recipe.labor"), value: recipe?.laborMinutes ?? null, id: "rec-labor", hint: t("recipe.laborHint", { rate: ctx.money.format(prefs.hourlyRateMinor) }) });
  const overhead = numberField(ctx, { label: t("recipe.overhead"), value: recipe?.overheadPct ?? null, id: "rec-overhead", hint: t("recipe.overheadHint", { pct: ctx.i18n.formatPercent(prefs.overheadPct) }) });
  const sale = moneyField(ctx, { label: t("recipe.salePrice"), value: recipe?.salePriceMinor ?? null, id: "rec-sale", hint: t("recipe.salePriceHint") });
  const note = field({ label: t("common.note"), value: recipe?.note ?? "", multiline: true, maxlength: LIMITS.note, id: "rec-note" });

  // ---- malzeme satirlari ----
  const lines = [];
  const linesBox = h("div", { class: "stack rec-lines", id: "rec-lines" });
  const linesErr = h("p", { class: "field-error", role: "alert", id: "rec-lines-err" });
  const ingOptions = () => [{ value: "", label: t("recipe.pickIngredient") }, ...ingredients.map((i) => ({ value: i.id, label: i.name }))];
  const addLine = (it = null) => {
    const n = lines.length + 1;
    const ing = selectField({ id: `rec-line-ing-${n}`, label: t("recipe.ingredient"), value: it?.ingredientId ?? "", options: ingOptions() });
    const qty = numberField(ctx, { label: t("recipe.qty"), value: it?.qty ?? null, id: `rec-line-qty-${n}` });
    const unit = selectField({ id: `rec-line-unit-${n}`, label: t("recipe.unit"), value: it?.unit ?? "cup", options: unitOptions(ctx) });
    const line = { ing, qty, unit };
    const rm = button({ label: t("common.remove"), glyph: "trash", variant: "ghost", ariaLabel: t("recipe.removeLine", { n }), onClick: () => { lines.splice(lines.indexOf(line), 1); el.remove(); preview(); } });
    const el = h("div", { class: "rec-line", "data-line": String(n) }, ing.element, h("div", { class: "grid-2" }, qty.element, unit.element), h("div", { class: "row" }, rm));
    line.el = el;
    for (const x of [ing.input, qty.input, unit.input]) x.addEventListener("input", preview);
    for (const x of [ing.input, unit.input]) x.addEventListener("change", preview);
    lines.push(line);
    add(linesBox, el);
    return line;
  };
  for (const it of recipe?.items ?? []) addLine(it);
  if (!lines.length) addLine();
  const addBtn = button({ id: "rec-line-add", label: t("recipe.addLine"), glyph: "plus", onClick: () => { const l = addLine(); l.ing.input.focus(); } });
  const noIng = ingredients.length ? null : h("p", { class: "banner banner-warn", id: "rec-no-ing", text: t("recipe.noIngredients") });

  // ---- canli maliyet ----
  const previewBox = h("div", { class: "card stack rec-preview", id: "rec-preview", "aria-live": "polite" });
  const read = () => ({
    name: name.input.value, yieldQty: yieldQty.read(), yieldUnit: yieldUnit.input.value, packagingMinor: packaging.read() ?? 0, laborMinutes: labor.read() ?? 0, overheadPct: overhead.read(),
    salePriceMinor: sale.read(), note: note.input.value,
    items: lines.map((l) => ({ ingredientId: l.ing.input.value, qty: l.qty.read(), unit: l.unit.input.value })),
  });
  function preview() {
    const v = read();
    const ok = v.yieldQty > 0;
    const c = recipeCost({ ...v, yieldQty: ok ? v.yieldQty : 1, laborMinutes: Number.isInteger(v.laborMinutes) ? v.laborMinutes : 0, overheadPct: typeof v.overheadPct === "number" && Number.isFinite(v.overheadPct) ? v.overheadPct : null, packagingMinor: Number.isSafeInteger(v.packagingMinor) ? v.packagingMinor : 0, salePriceMinor: Number.isSafeInteger(v.salePriceMinor) ? v.salePriceMinor : null, items: v.items.filter((i) => i.ingredientId && i.qty > 0) }, ingById, prefs);
    put(previewBox, h("h3", { text: t("recipe.preview") }), costBreakdown(ctx, { ...v, laborMinutes: v.laborMinutes ?? 0 }, c, prefs));
  }
  preview();
  for (const f of [yieldQty, yieldUnit, packaging, labor, overhead, sale]) f.input.addEventListener("input", preview);

  let result = null;
  const saved = await openForm(ctx, {
    title: recipe ? t("recipe.edit") : t("recipe.add"),
    groups: [
      { legend: t("recipe.what"), nodes: [name.element, h("div", { class: "grid-2" }, yieldQty.element, yieldUnit.element)] },
      { legend: t("recipe.ingredients"), nodes: [noIng, linesBox, linesErr, h("div", { class: "row" }, addBtn)] },
      { legend: t("recipe.otherCosts"), nodes: [packaging.element, labor.element, overhead.element] },
      { legend: t("recipe.pricing"), nodes: [sale.element, h("p", { class: "field-hint", text: t("recipe.pricingHint") })] },
      { legend: t("common.note"), nodes: [note.element] },
    ],
    extra: [previewBox],
    onSave: async () => {
      const v = read();
      let bad = false;
      const setE = (f, msg) => { f.setError(msg); if (msg) bad = true; };
      setE(name, name.input.value.trim() ? "" : t("msg.required"));
      setE(yieldQty, v.yieldQty > 0 && v.yieldQty <= LIMITS.yieldMax ? "" : t("msg.range"));
      setE(packaging, Number.isSafeInteger(v.packagingMinor) && v.packagingMinor >= 0 ? "" : t("msg.range"));
      setE(labor, Number.isInteger(v.laborMinutes) && v.laborMinutes >= 0 && v.laborMinutes <= LIMITS.laborMax ? "" : t("msg.minutes"));
      setE(overhead, v.overheadPct === null || (Number.isFinite(v.overheadPct) && v.overheadPct >= 0 && v.overheadPct <= 100) ? "" : t("msg.range"));
      setE(sale, v.salePriceMinor === null || (Number.isSafeInteger(v.salePriceMinor) && v.salePriceMinor >= 0) ? "" : t("msg.range"));
      const items = [];
      for (const l of lines) {
        const id = l.ing.input.value; const q = l.qty.read(); const u = l.unit.input.value;
        l.ing.setError(""); l.qty.setError(""); l.unit.setError("");
        if (!id && q === null) continue; // tamamen bos satir yok sayilir
        if (!id) { l.ing.setError(t("msg.required")); bad = true; continue; }
        if (!(q > 0)) { l.qty.setError(t("msg.range")); bad = true; continue; }
        const ing = ingById.get(id);
        if (!convertible(u, ing.pkgUnit, ing.gramsPerCup)) { l.unit.setError(t("msg.convert", { from: unitLabel(ctx, u), to: unitLabel(ctx, ing.pkgUnit), name: ing.name })); bad = true; continue; }
        items.push({ ingredientId: id, qty: q, unit: u });
      }
      linesErr.textContent = !bad && !items.length ? t("recipe.needLine") : "";
      if (!items.length) bad = true;
      if (bad) return false;
      const rec = cleanRecord("recipes", { ...v, items, source: recipe?.source === "sample" ? "sample" : "manual" }).record;
      result = recipe ? await ctx.store.update("recipes", recipe.id, rec) : await ctx.store.add("recipes", rec);
      return true;
    },
  });
  if (saved) ctx.notify(t("common.saved"), "success");
  return saved ? result : null;
}

export async function openRecipeDetail(ctx, id, onChange) {
  const { t } = ctx.i18n;
  const data = await loadAll(ctx);
  const r = data.recById.get(id);
  if (!r) { ctx.notify(t("error.not_found"), "error"); return; }
  const c = data.costs.get(id);
  const lines = h("ul", { class: "rec-ing-list" }, c.lines.map((l) => h("li", {},
    h("span", { text: `${qtyText(ctx, l.qty, l.unit)} · ${l.name || t("recipe.deletedIngredient")}` }),
    h("span", { class: l.ok ? "num" : "num badge badge-warn", text: l.ok ? ctx.money.format(l.costMinor) : t("recipe.noCost") }))));
  const m = openModal(ctx, { title: r.name, className: "detail-dialog", children: [
    h("div", { class: "stack" },
      h("p", { class: "muted", id: "rec-detail-yield", text: t("recipe.makes", { yield: yieldText(ctx, r) }) }),
      lines,
      costBreakdown(ctx, r, c, data.prefs),
      r.note ? h("p", { class: "rc-text", text: r.note }) : null,
      h("div", { class: "row dialog-actions-left" },
        printButton(ctx, { id: "rec-print", label: t("recipe.printCard"), onClick: () => printDoc(ctx, recipeCardDoc(labels(ctx), r, c, data.prefs)) }),
        button({ id: "rec-edit", label: t("common.edit"), glyph: "edit", onClick: async () => { m.close(); if (await openRecipeForm(ctx, r)) await onChange?.(); } }),
        button({ id: "rec-dup", label: t("recipe.duplicate"), onClick: async () => {
          m.close();
          const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = r;
          await ctx.store.add("recipes", { ...rest, name: t("recipe.copyOf", { name: r.name }).slice(0, LIMITS.name), source: "manual" });
          ctx.notify(t("common.saved"), "success"); await onChange?.();
        } }),
        button({ id: "rec-delete", label: t("common.delete"), glyph: "trash", variant: "danger", onClick: async () => {
          const used = data.orders.filter((o) => (o.items ?? []).some((it) => it.recipeId === r.id)).length;
          if (!(await ctx.confirm({ title: t("recipe.deleteTitle"), message: used ? t("recipe.deleteUsed", { name: r.name, n: used }) : t("recipe.deleteText", { name: r.name }) }))) return;
          await ctx.store.remove("recipes", r.id); m.close(); ctx.notify(t("common.deleted"), "success"); await onChange?.();
        } }))),
  ] });
  return m.done;
}

export async function mountRecipes(ctx, root, param) {
  const { t, tn } = ctx.i18n;
  let data = await loadAll(ctx);
  const head = h("div", { class: "page-head" });
  const body = h("div", { class: "card-list", id: "rec-list" });
  const add = async () => { if (await openRecipeForm(ctx, null, data)) await reload(); };
  function paint() {
    put(head, h("div", {}, h("h2", { text: t("nav.recipes") }), h("p", { class: "muted", text: t("recipe.intro") })),
      h("p", { class: "count-pill", role: "status", text: tn("recipe.count", data.recipes.length) }));
    if (!data.recipes.length) {
      put(body, emptyBox(t("recipe.empty"), data.ingredients.length ? t("recipe.emptyHint") : t("recipe.emptyHintNoIng"),
        button({ id: "rec-add-first", label: t("recipe.add"), variant: "primary", onClick: add }), button({ id: "sample-load-rec", label: t("sample.load"), onClick: () => ctx.sample.load() })));
      return;
    }
    put(body, ...data.recipes.map((r) => {
      const c = data.costs.get(r.id);
      const f = ctx.money.format;
      return h("button", { type: "button", class: "item-card rec-card", "data-recipe": r.id, on: { click: () => openRecipeDetail(ctx, r.id, reload) } },
        h("span", { class: "item-top" }, h("strong", { class: "item-title", text: r.name }), saleBadge(ctx, c.sale), c.missing ? h("span", { class: "badge badge-warn", text: t("cost.badge.missing") }) : null),
        h("span", { class: "muted", text: t("recipe.makes", { yield: yieldText(ctx, r) }) }),
        h("span", { class: "item-stats" },
          h("span", {}, h("span", { class: "stat-k", text: t("cost.batchShort") }), h("span", { class: "stat-v", text: f(c.batchMinor) })),
          h("span", {}, h("span", { class: "stat-k", text: t("cost.unitShort") }), h("span", { class: "stat-v", text: f(c.unitMinor) })),
          h("span", {}, h("span", { class: "stat-k", text: t("cost.suggestedShort") }), h("span", { class: "stat-v", text: c.suggestedUnitMinor === null ? "—" : f(c.suggestedUnitMinor) })),
          h("span", {}, h("span", { class: "stat-k", text: t("cost.yourShort") }), h("span", { class: "stat-v", text: c.sale.priceMinor === null ? "—" : f(c.sale.priceMinor) }))));
    }));
  }
  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  put(root, head, h("div", { class: "row toolbar-row" }, button({ id: "rec-add", label: t("recipe.add"), variant: "primary", glyph: "plus", onClick: add })), body);
  paint();
  if (param && data.recById.has(param)) openRecipeDetail(ctx, param, reload);
}
