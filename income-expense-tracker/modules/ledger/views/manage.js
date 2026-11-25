// Ayarlar ekranindaki iki yonetim karti: isletme profilleri (en cok 5) ve kategoriler (yeniden adlandir, gizle / goster, ekle, sil).
// Ozel kategori silinince kayitlari ayni turun "Diger" kategorisine tasinir (tek atomik islem). Hazir kategoriler silinmez, gizlenir.
import { guardWrite } from "../../../core/safe.js";
import { button, field, h } from "../../../core/ui.js";
import { MAX_BUSINESSES, OTHER_KEY, RECORD_LIMITS, TEXT_LIMITS, TYPES, categoryLabel, validateCategoryName } from "../logic/schema.js";
import { errText, loadData, openForm, withId } from "./common.js";

async function businessForm(ctx, biz) {
  const { t } = ctx.i18n;
  const name = withId(field({ label: t("biz.name"), value: biz?.name ?? "", maxlength: TEXT_LIMITS.businessName, required: true, autocomplete: "organization" }), "biz-name");
  const line1 = withId(field({ label: t("biz.line1"), value: biz?.line1 ?? "", maxlength: TEXT_LIMITS.businessLine, hint: t("biz.lineHint") }), "biz-line1");
  const line2 = withId(field({ label: t("biz.line2"), value: biz?.line2 ?? "", maxlength: TEXT_LIMITS.businessLine }), "biz-line2");
  return openForm(ctx, {
    title: biz ? t("biz.edit") : t("biz.add"),
    groups: [{ legend: "", nodes: [name.element, line1.element, line2.element] }],
    onSave: async () => {
      name.setError("");
      if (!name.input.value.trim()) { name.setError(t("msg.required")); return false; }
      const fields = { name: name.input.value, line1: line1.input.value, line2: line2.input.value };
      if (biz) await ctx.business.update(biz.id, fields);
      else { const b = await ctx.business.add(fields); await ctx.business.setActive(b.id); }
      ctx.notify(t("msg.saved"), "success");
      return true;
    },
  });
}

export async function buildBusinessCard(ctx) {
  const { t, formatNumber } = ctx.i18n;
  const data = await loadData(ctx);
  const guard = guardWrite((e) => ctx.fail(e));
  const counts = new Map();
  for (const e of data.allEntries) counts.set(e.businessId, (counts.get(e.businessId) ?? 0) + 1);
  const items = data.businesses.map((b) => {
    const active = b.id === data.business.id;
    return h("li", { class: `biz-item${active ? " is-active" : ""}`, "data-biz": b.id },
      h("div", { class: "biz-text" },
        h("p", { class: "biz-name", text: b.name }),
        h("p", { class: "muted", text: [active ? t("biz.active") : "", t("biz.entries", { n: formatNumber(counts.get(b.id) ?? 0) })].filter(Boolean).join(" · ") })),
      h("div", { class: "row" },
        active ? null : button({ label: t("biz.use"), "data-use": b.id, onClick: guard(async () => { await ctx.business.setActive(b.id); ctx.notify(t("biz.switched", { name: b.name }), "success"); await ctx.refresh(); }) }),
        button({ label: t("common.edit"), onClick: async () => { if (await businessForm(ctx, b)) await ctx.refresh(); } }),
        data.businesses.length > 1 ? button({ label: t("common.delete"), variant: "danger", onClick: guard(async () => {
          if (!(await ctx.confirm({ title: t("biz.deleteTitle", { name: b.name }), message: t("biz.deleteText", { n: formatNumber(counts.get(b.id) ?? 0) }) }))) return;
          await ctx.business.remove(b.id);
          ctx.notify(t("biz.deleted"), "success");
          await ctx.refresh();
        }) }) : null));
  });
  return h("section", { class: "card stack", id: "set-businesses" },
    h("h3", { text: t("biz.title") }),
    h("p", { class: "muted", text: t("biz.intro", { max: MAX_BUSINESSES }) }),
    h("ul", { class: "biz-list" }, ...items),
    data.businesses.length < MAX_BUSINESSES
      ? h("div", { class: "row" }, button({ id: "biz-add", label: t("biz.add"), glyph: "plus", onClick: async () => { if (await businessForm(ctx, null)) await ctx.refresh(); } }))
      : h("p", { class: "muted", text: t("biz.max") }));
}

async function categoryForm(ctx, { cat = null, type }) {
  const { t } = ctx.i18n;
  const name = withId(field({ label: t("cat.name"), value: cat ? categoryLabel(cat, t) : "", maxlength: TEXT_LIMITS.categoryName, required: true }), "cat-name");
  return openForm(ctx, {
    title: cat ? t("cat.rename") : t(`cat.add.${type}`),
    groups: [{ legend: "", nodes: [name.element] }],
    onSave: async () => {
      const code = validateCategoryName(name.input.value);
      name.setError(code ? errText(ctx, code, TEXT_LIMITS.categoryName) : "");
      if (code) return false;
      if (cat) await ctx.store.update("categories", cat.id, { name: name.input.value.trim() });
      else await ctx.store.add("categories", { type, key: "", name: name.input.value.trim(), hidden: false }, { check: (n) => { if (n >= RECORD_LIMITS.categories) throw Object.assign(new Error("limit"), { code: "limit_reached" }); } });
      ctx.notify(t("msg.saved"), "success");
      return true;
    },
  });
}

export async function buildCategoryCard(ctx) {
  const { t, formatNumber } = ctx.i18n;
  const data = await loadData(ctx);
  const guard = guardWrite((e) => ctx.fail(e));
  const used = new Map();
  for (const e of data.allEntries) used.set(e.categoryId, (used.get(e.categoryId) ?? 0) + 1);
  const group = (type) => {
    const other = `cat-${OTHER_KEY[type]}`;
    const list = data.categories.filter((c) => c.type === type).sort((a, b) => (a.id === other ? 1 : b.id === other ? -1 : categoryLabel(a, t).localeCompare(categoryLabel(b, t))));
    return h("div", { class: "stack cat-group", id: `cat-group-${type}` },
      h("h4", { text: t(`cat.group.${type}`) }),
      h("ul", { class: "cat-list" }, ...list.map((c) => h("li", { class: `cat-item${c.hidden ? " is-hidden" : ""}`, "data-cat": c.id },
        h("span", { class: "cat-label", text: categoryLabel(c, t) }),
        h("span", { class: "muted cat-n", text: [c.hidden ? t("cat.hiddenTag") : "", formatNumber(used.get(c.id) ?? 0)].filter(Boolean).join(" · ") }),
        h("span", { class: "row cat-actions" },
          button({ label: t("cat.renameShort"), ariaLabel: t("cat.renameAria", { name: categoryLabel(c, t) }), onClick: async () => { if (await categoryForm(ctx, { cat: c, type })) await ctx.refresh(); } }),
          c.id === other ? null : button({ label: c.hidden ? t("cat.show") : t("cat.hide"), ariaLabel: t(c.hidden ? "cat.showAria" : "cat.hideAria", { name: categoryLabel(c, t) }), onClick: guard(async () => { await ctx.store.update("categories", c.id, { hidden: !c.hidden }); await ctx.refresh(); }) }),
          c.key ? null : button({ label: t("common.delete"), variant: "danger", ariaLabel: t("cat.deleteAria", { name: categoryLabel(c, t) }), onClick: guard(async () => {
            if (!(await ctx.confirm({ title: t("cat.deleteTitle"), message: t("cat.deleteText", { n: formatNumber(used.get(c.id) ?? 0), other: t(`cat.${OTHER_KEY[type]}`) }) }))) return;
            await ctx.store.transactMany(["categories", "entries"], (tx) => {
              for (const e of tx.list("entries").filter((x) => x.categoryId === c.id)) tx.update("entries", e.id, { categoryId: other });
              tx.remove("categories", c.id);
            });
            ctx.notify(t("cat.deleted"), "success");
            await ctx.refresh();
          }) }))))),
      h("div", { class: "row" }, button({ id: `cat-add-${type}`, label: t(`cat.add.${type}`), glyph: "plus", onClick: async () => { if (await categoryForm(ctx, { type })) await ctx.refresh(); } })));
  };
  return h("section", { class: "card stack", id: "set-categories" },
    h("h3", { text: t("cat.title") }),
    h("p", { class: "muted", text: t("cat.intro") }),
    ...TYPES.map(group));
}
