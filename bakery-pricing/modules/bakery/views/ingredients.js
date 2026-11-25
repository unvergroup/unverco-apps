// Malzemeler ekrani: alis paketi (miktar + birim + fiyat), "1 cup = x g" (istege bagli), birim maliyet, kac tarifte kullanildigi.
// Fiyat degisince tarif maliyetleri canli hesaplandigi icin TUM tarifler aninda guncellenir; kac tarifin etkilendigi bildirilir.
// Tarifte kullanilan malzeme silinemez (once tariften cikarilir): maliyet sessizce eksik kalmasin.
import { add, button, field, h, put, table } from "../../../core/ui.js";
import { checkIngredient, cleanRecord, LIMITS } from "../logic/schema.js";
import { recipesUsing } from "../logic/costing.js";
import { dimOf } from "../logic/units.js";
import { emptyBox, errText, loadAll, moneyField, numberField, openForm, qtyText, selectField, unitLabel, unitOptions } from "./common.js";

/** Birim maliyet metni: "$0.86 / lb" (paket birimi basina). */
export const perUnitText = (ctx, ing) => `${ctx.money.format(Math.round(ing.pkgPriceMinor / ing.pkgQty))} / ${unitLabel(ctx, ing.pkgUnit)}`;

export async function openIngredientForm(ctx, ing = null) {
  const { t } = ctx.i18n;
  const name = field({ label: t("ing.name"), value: ing?.name ?? "", maxlength: LIMITS.name, required: true, autocomplete: "off", id: "ing-name" });
  const pkgQty = numberField(ctx, { label: t("ing.pkgQty"), value: ing?.pkgQty ?? null, id: "ing-qty", required: true });
  const pkgUnit = selectField({ id: "ing-unit", label: t("ing.pkgUnit"), value: ing?.pkgUnit ?? "lb", options: unitOptions(ctx) });
  const price = moneyField(ctx, { label: t("ing.price"), value: ing?.pkgPriceMinor ?? null, id: "ing-price", required: true, hint: t("ing.priceHint") });
  const density = numberField(ctx, { label: t("ing.density"), value: ing?.gramsPerCup ?? null, id: "ing-density", hint: t("ing.densityHint") });
  const note = field({ label: t("common.note"), value: ing?.note ?? "", multiline: true, maxlength: LIMITS.note, id: "ing-note" });
  let result = null;
  const saved = await openForm(ctx, {
    title: ing ? t("ing.edit") : t("ing.add"),
    groups: [
      { legend: t("ing.what"), nodes: [name.element] },
      { legend: t("ing.package"), nodes: [h("div", { class: "grid-2" }, pkgQty.element, pkgUnit.element), price.element] },
      { legend: t("ing.convert"), nodes: [density.element] },
      { legend: t("common.note"), nodes: [note.element] },
    ],
    onSave: async () => {
      const v = { name: name.input.value, pkgQty: pkgQty.read(), pkgUnit: pkgUnit.input.value, pkgPriceMinor: price.read(), gramsPerCup: density.read(), note: note.input.value };
      const chk = checkIngredient({ ...v, pkgQty: v.pkgQty ?? NaN, pkgPriceMinor: v.pkgPriceMinor ?? NaN });
      name.setError(chk.errors.name ? errText(ctx, chk.errors.name, { max: LIMITS.name }) : "");
      pkgQty.setError(chk.errors.pkgQty ? errText(ctx, "range") : "");
      pkgUnit.setError(chk.errors.pkgUnit ? errText(ctx, "unit") : "");
      price.setError(chk.errors.pkgPriceMinor ? errText(ctx, "range") : "");
      density.setError(chk.errors.gramsPerCup ? errText(ctx, "range") : "");
      if (!chk.ok) return false;
      const rec = cleanRecord("ingredients", { ...v, source: ing?.source === "sample" ? "sample" : "manual" }).record;
      result = ing ? await ctx.store.update("ingredients", ing.id, rec) : await ctx.store.add("ingredients", rec);
      return true;
    },
  });
  if (!saved) return null;
  const recipes = await ctx.store.list("recipes");
  const used = recipesUsing(recipes, result.id).length;
  if (ing && used && (ing.pkgPriceMinor !== result.pkgPriceMinor || ing.pkgQty !== result.pkgQty || ing.pkgUnit !== result.pkgUnit || ing.gramsPerCup !== result.gramsPerCup)) ctx.notify(ctx.i18n.tn("ing.updatedRecipes", used), "success");
  else ctx.notify(t("common.saved"), "success");
  return result;
}

export async function deleteIngredient(ctx, ing) {
  const { t } = ctx.i18n;
  const used = recipesUsing(await ctx.store.list("recipes"), ing.id);
  if (used.length) { ctx.notify(t("ing.inUse", { n: used.length, list: used.slice(0, 3).map((r) => r.name).join(", ") }), "warn"); return false; }
  if (!(await ctx.confirm({ title: t("ing.deleteTitle"), message: t("ing.deleteText", { name: ing.name }) }))) return false;
  await ctx.store.remove("ingredients", ing.id);
  ctx.notify(t("common.deleted"), "success");
  return true;
}

export async function mountIngredients(ctx, root) {
  const { t, tn } = ctx.i18n;
  let data = await loadAll(ctx);
  let q = "";
  const head = h("div", { class: "page-head" });
  const body = h("div", { class: "stack" });
  const add = async () => { if (await openIngredientForm(ctx)) await reload(); };
  const search = h("input", { type: "search", id: "ing-search", class: "search", placeholder: t("common.search"), "aria-label": t("common.search"), autocomplete: "off" });
  search.addEventListener("input", () => { q = search.value.trim().toLocaleLowerCase(); paint(); });

  function paint() {
    put(head, h("div", {}, h("h2", { text: t("nav.ingredients") }), h("p", { class: "muted", text: t("ing.intro") })),
      h("p", { class: "count-pill", role: "status", text: tn("ing.count", data.ingredients.length) }));
    if (!data.ingredients.length) {
      put(body, emptyBox(t("ing.empty"), t("ing.emptyHint"), button({ id: "ing-add-first", label: t("ing.add"), variant: "primary", onClick: add }), button({ id: "sample-load-ing", label: t("sample.load"), onClick: () => ctx.sample.load() })));
      return;
    }
    const list = data.ingredients.filter((i) => !q || i.name.toLocaleLowerCase().includes(q));
    const uses = (id) => recipesUsing(data.recipes, id).length;
    put(body, table({
      caption: t("nav.ingredients"),
      columns: [
        { key: "name", label: t("ing.name"), render: (i) => h("button", { type: "button", class: "link-btn", "data-ing": i.id, text: i.name, on: { click: async () => { if (await openIngredientForm(ctx, i)) await reload(); } } }) },
        { key: "pkg", label: t("ing.package"), render: (i) => `${qtyText(ctx, i.pkgQty, i.pkgUnit)} · ${ctx.money.format(i.pkgPriceMinor)}` },
        { key: "unit", label: t("ing.perUnit"), align: "num", render: (i) => perUnitText(ctx, i) },
        { key: "density", label: t("ing.densityShort"), narrowHide: !list.some((i) => i.gramsPerCup), render: (i) => (i.gramsPerCup ? t("ing.densityValue", { g: ctx.i18n.formatNumber(i.gramsPerCup, { maximumFractionDigits: 1 }) }) : dimOf(i.pkgUnit) === "count" ? "" : "—") },
        { key: "used", label: t("ing.usedIn"), align: "num", render: (i) => String(uses(i.id)) },
        { key: "act", label: t("common.actions"), actions: true, render: (i) => button({ label: t("common.delete"), glyph: "trash", variant: "ghost", ariaLabel: `${t("common.delete")}: ${i.name}`, onClick: async () => { if (await deleteIngredient(ctx, i)) await reload(); } }) },
      ],
      rows: list,
    }), list.length ? null : h("p", { class: "muted", text: t("common.noMatch") }));
  }
  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  put(root, head, h("div", { class: "row toolbar-row" }, search, button({ id: "ing-add", label: t("ing.add"), variant: "primary", glyph: "plus", onClick: add })), body);
  paint();
}
