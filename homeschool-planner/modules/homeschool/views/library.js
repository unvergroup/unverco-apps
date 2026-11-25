// Kutuphane ekrani (#/library): sekmeler Books | Activities.
// Books: okuma listesi (cocuk ya da tum aile), durum (okunacak / okunuyor / bitti), bitis tarihi, suzgec, "Print reading list".
// Activities: grup dersi / alan gezisi; TEK kayit secilen her cocuga sayilir (saat + okul gunu). "Temel ders" isareti temel saate girer.
import { isIsoDate, todayIso } from "../../../core/dates.js";
import { button, createTabs, field, h } from "../../../core/ui.js";
import { BOOK_STATUS, MINUTES, RECORD_LIMITS, parseIntText, validate } from "../logic/schema.js";
import { booksFor } from "../logic/calc.js";
import { printReading } from "../print/screens.js";
import { checkGroup, dur, errText, kidDot, kidPicker, loadAll, noKids, openForm, selectField, fill, emptyBox } from "./common.js";

const today = () => todayIso();

/** Grup dersi / gezi formu. data: loadAll().data. Doner: kaydedildi mi. */
export async function openActivityForm(ctx, data, { activity = null, date = today() } = {}) {
  const { t } = ctx.i18n;
  const a = activity ?? { date, title: "", place: "", studentIds: data.students.map((s) => s.id), minutes: 60, core: false, notes: "" };
  const title = field({ id: "act-title", label: t("hs.act.name"), value: a.title, maxlength: 80, required: true, hint: t("hs.act.nameHint") });
  const when = field({ id: "act-date", label: t("hs.doc.date"), type: "date", value: a.date });
  const place = field({ id: "act-place", label: t("hs.act.place"), value: a.place, maxlength: 80 });
  const minutes = field({ id: "act-minutes", label: t("hs.log.minutes"), value: String(a.minutes), inputmode: "numeric", autocomplete: "off" });
  const kids = checkGroup({ legend: t("hs.act.who"), id: "act-kids", items: data.students.map((s) => ({ value: s.id, checked: a.studentIds.includes(s.id), node: h("span", { class: "kid-name" }, kidDot(s), h("span", { text: s.name })) })) });
  const coreBox = h("input", { type: "checkbox", id: "act-core", checked: a.core === true });
  const notes = field({ id: "act-notes", label: t("hs.log.note"), value: a.notes, multiline: true, maxlength: 300 });
  const extra = activity ? [button({ id: "act-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
    if (!(await ctx.confirm({ title: t("hs.act.deleteTitle"), message: t("hs.act.deleteText", { name: a.title }) }))) return;
    await ctx.store.remove("activities", activity.id); document.querySelector("dialog.form-dialog[open]")?.close(); ctx.refresh();
  } })] : [];
  return openForm(ctx, {
    title: activity ? t("hs.act.edit") : t("hs.act.add"), extraActions: extra,
    groups: [{ legend: t("hs.act.title"), nodes: [title.element, when.element, place.element, minutes.element, kids.element, h("label", { class: "check", for: coreBox.id }, coreBox, h("span", { text: t("hs.act.core") })), notes.element] }],
    onSave: async () => {
      const m = parseIntText(minutes.input.value, 0, MINUTES.logMax);
      minutes.setError(m.ok ? "" : errText(ctx, m.error, m));
      const v = validate("activities", { title: title.input.value, date: when.input.value, place: place.input.value, studentIds: kids.values(), minutes: m.ok ? m.value : 0, core: coreBox.checked, notes: notes.input.value });
      title.setError(v.errors.title ? errText(ctx, v.errors.title, { max: 80 }) : "");
      when.setError(v.errors.date ? errText(ctx, "date") : "");
      kids.setError(v.errors.studentIds ? errText(ctx, "kids") : "");
      if (!v.ok || !m.ok) return false;
      if (activity) await ctx.store.update("activities", activity.id, v.value);
      else await ctx.store.add("activities", v.value, { check: (n) => { if (n >= RECORD_LIMITS.activities) throw Object.assign(new Error("limit"), { code: "limit_reached" }); } });
      ctx.notify(t("hs.saved"), "success");
      return true;
    },
  });
}

async function openBookForm(ctx, data, { book = null, studentId = "" } = {}) {
  const { t } = ctx.i18n;
  const b = book ?? { studentId, title: "", author: "", status: "reading", finishedOn: "", notes: "" };
  const title = field({ id: "book-title", label: t("hs.book.title"), value: b.title, maxlength: 120, required: true });
  const author = field({ id: "book-author", label: t("hs.book.author"), value: b.author, maxlength: 80 });
  const reader = selectField({ id: "book-reader", label: t("hs.book.reader"), value: b.studentId, options: [{ value: "", label: t("hs.book.family") }, ...data.students.map((s) => ({ value: s.id, label: s.name }))] });
  const status = selectField({ id: "book-status", label: t("hs.book.status"), value: b.status, options: BOOK_STATUS.map((k) => ({ value: k, label: t(`hs.book.st.${k}`) })) });
  const fin = field({ id: "book-finished", label: t("hs.book.finished"), type: "date", value: b.finishedOn });
  const notes = field({ id: "book-notes", label: t("hs.log.note"), value: b.notes, multiline: true, maxlength: 300 });
  status.input.addEventListener("change", () => { if (status.input.value === "done" && !fin.input.value) fin.input.value = today(); });
  const extra = book ? [button({ id: "book-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
    if (!(await ctx.confirm({ title: t("hs.book.deleteTitle"), message: t("hs.book.deleteText", { name: b.title }) }))) return;
    await ctx.store.remove("books", book.id); document.querySelector("dialog.form-dialog[open]")?.close(); ctx.refresh();
  } })] : [];
  return openForm(ctx, {
    title: book ? t("hs.book.edit") : t("hs.book.add"), extraActions: extra,
    groups: [{ legend: t("hs.book.legend"), nodes: [title.element, author.element, reader.element, status.element, fin.element, notes.element] }],
    onSave: async () => {
      const v = validate("books", { title: title.input.value, author: author.input.value, studentId: reader.input.value, status: status.input.value, finishedOn: status.input.value === "done" ? fin.input.value : "", notes: notes.input.value });
      title.setError(v.errors.title ? errText(ctx, v.errors.title, { max: 120 }) : "");
      fin.setError(v.errors.finishedOn ? errText(ctx, "date") : "");
      if (!v.ok) return false;
      if (book) await ctx.store.update("books", book.id, v.value);
      else await ctx.store.add("books", v.value, { check: (n) => { if (n >= RECORD_LIMITS.books) throw Object.assign(new Error("limit"), { code: "limit_reached" }); } });
      ctx.notify(t("hs.saved"), "success");
      return true;
    },
  });
}

export async function mountLibrary(ctx, root) {
  const { t, formatDate } = ctx.i18n;
  let { data } = await loadAll(ctx);
  let tab = "books";
  let who = "";
  let st = "all";
  const body = h("div", { class: "stack" });
  const reload = async () => { ({ data } = await loadAll(ctx)); paint(); };
  ctx.onExternalChange(reload);
  const names = () => new Map(data.students.map((s) => [s.id, s]));

  function paintBooks() {
    const all = booksFor(data, who);
    const list = st === "all" ? all : all.filter((b) => b.status === st);
    const N = names();
    fill(body, 
      kidPicker(ctx, { students: data.students, selected: who, allLabel: t("hs.allKids"), onPick: (id) => { who = id; paint(); }, id: "book-kids" }),
      h("div", { class: "chips", id: "book-status-filter", role: "group", "aria-label": t("hs.book.status") },
        ...["all", ...BOOK_STATUS].map((k) => h("button", { type: "button", class: "chip", "aria-pressed": String(st === k), "data-st": k, text: k === "all" ? t("hs.book.st.all") : t(`hs.book.st.${k}`), on: { click: () => { st = k; paint(); } } }))),
      h("div", { class: "row toolbar" },
        button({ id: "book-add", label: t("hs.book.add"), glyph: "plus", variant: "primary", onClick: async () => { if (await openBookForm(ctx, data, { studentId: who })) await reload(); } }),
        button({ id: "book-print", label: t("hs.book.print"), glyph: "print", exportAction: true, onClick: () => printReading(ctx, { data, students: data.students, studentId: who }) })),
      list.length
        ? h("ul", { class: "item-list", id: "book-list" }, ...list.map((b) => h("li", {},
          h("button", { type: "button", class: "item-row", "data-book": b.id, on: { click: async () => { if (await openBookForm(ctx, data, { book: b })) await reload(); } } },
            h("span", { class: "item-main" }, h("strong", { text: b.title }), h("span", { class: "muted", text: [b.author, b.studentId ? N.get(b.studentId)?.name : t("hs.book.family")].filter(Boolean).join(" · ") })),
            h("span", { class: `badge book-${b.status}`, text: b.status === "done" && b.finishedOn ? `${t("hs.book.st.done")} · ${formatDate(b.finishedOn)}` : t(`hs.book.st.${b.status}`) })))))
        : emptyBox({ icon: "book", title: t("hs.book.emptyTitle"), text: t("hs.book.emptyText") }));
  }

  function paintActs() {
    const N = names();
    const list = data.activities.filter((a) => !who || a.studentIds.includes(who)).sort((a, b) => b.date.localeCompare(a.date));
    fill(body, 
      kidPicker(ctx, { students: data.students, selected: who, allLabel: t("hs.allKids"), onPick: (id) => { who = id; paint(); }, id: "act-kids-filter" }),
      h("p", { class: "muted", id: "act-intro", text: t("hs.act.intro") }),
      h("div", { class: "row toolbar" }, button({ id: "act-add", label: t("hs.act.add"), glyph: "plus", variant: "primary", onClick: async () => { if (await openActivityForm(ctx, data)) await reload(); } })),
      list.length
        ? h("ul", { class: "item-list", id: "act-list" }, ...list.map((a) => h("li", {},
          h("button", { type: "button", class: "item-row", "data-act": a.id, on: { click: async () => { if (await openActivityForm(ctx, data, { activity: a })) await reload(); } } },
            h("span", { class: "item-main" }, h("strong", { text: a.title }), h("span", { class: "muted", text: [formatDate(a.date), a.place, a.studentIds.map((id) => N.get(id)?.name).filter(Boolean).join(", ")].filter(Boolean).join(" · ") })),
            h("span", { class: "badge", text: dur(ctx, a.minutes) })))))
        : emptyBox({ icon: "kids", title: t("hs.act.emptyTitle"), text: t("hs.act.emptyText") }));
  }

  function paint() {
    if (!data.students.length) { fill(root, h("h2", { text: t("hs.nav.library") }), noKids(ctx)); return; }
    const tabs = createTabs({ label: t("hs.nav.library"), selected: tab, items: [{ id: "books", label: t("hs.book.tab") }, { id: "acts", label: t("hs.act.tab") }], onSelect: (id) => { tab = id; paint(); } });
    fill(root, h("div", { class: "page-head" }, h("h2", { text: t("hs.nav.library") })), tabs.element, body);
    if (tab === "books") paintBooks(); else paintActs();
  }
  paint();
}
