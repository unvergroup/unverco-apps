// Cocuklar ekrani (#/kids[/<id>|new]): cocuk ekle / duzenle / sil (ad, renk, sinif, gunluk loop sayisi) ve secili cocugun dersleri:
// ekle / duzenle / sil (ad, temel, haftalik gunler ya da loop, dakika, kaynak, maliyet, final notu). "Also add to": ayni dersi
// diger cocuklara tek seferde ekler (cok cocuklu aile). Loop sirasi Plan ekranindan degisir.
import { WEEK_DAYS } from "../../../core/settings.js";
import { localizeNumber, parseMoneyText } from "../../../core/number-input.js";
import { button, field, h } from "../../../core/ui.js";
import { LOOP_MAX, MAX, MAX_COST_MINOR, MINUTES, RECORD_LIMITS, STUDENT_COLORS, parseIntText, validate } from "../logic/schema.js";
import { loopSubjects, subjectsOf } from "../logic/calc.js";
import { checkGroup, colorIndex, dur, errText, kidDot, kidPicker, loadAll, openForm, radioGroup, selectField, fill, emptyBox } from "./common.js";

const limitCheck = (max) => (n) => { if (n >= max) throw Object.assign(new Error("limit"), { code: "limit_reached" }); };

export async function openKidForm(ctx, data, kid = null) {
  const { t } = ctx.i18n;
  const k = kid ?? { name: "", color: STUDENT_COLORS[data.students.length % STUDENT_COLORS.length], grade: "", loopPerDay: 2, notes: "" };
  const name = field({ id: "kid-name", label: t("hs.kid.name"), value: k.name, maxlength: MAX.name, required: true, autocomplete: "off" });
  const grade = field({ id: "kid-grade", label: t("hs.kid.grade"), value: k.grade, maxlength: MAX.grade, hint: t("hs.kid.gradeHint") });
  const color = radioGroup({ legend: t("hs.kid.color"), name: "kid-color", value: k.color, cls: "color-group", items: STUDENT_COLORS.map((c, i) => ({ value: c, node: h("span", { class: `swatch kid-c${i}`, title: t(`hs.color.${i}`) }, h("span", { class: "sr-only", text: t(`hs.color.${i}`) })) })) });
  const loop = field({ id: "kid-loop", label: t("hs.kid.loopPerDay"), value: String(k.loopPerDay), inputmode: "numeric", autocomplete: "off", hint: t("hs.kid.loopHint", { max: LOOP_MAX }) });
  const notes = field({ id: "kid-notes", label: t("hs.log.note"), value: k.notes, multiline: true, maxlength: MAX.notes });
  const extra = kid ? [button({ id: "kid-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
    if (!(await ctx.confirm({ title: t("hs.kid.deleteTitle"), message: t("hs.kid.deleteText", { name: k.name }) }))) return;
    await ctx.store.transactMany(["students", "subjects", "logs", "attendance", "grades", "books", "activities"], (tx) => {
      for (const c of ["subjects", "logs", "attendance", "grades"]) for (const r of tx.list(c)) if (r.studentId === kid.id) tx.remove(c, r.id);
      for (const b of tx.list("books")) if (b.studentId === kid.id) tx.remove("books", b.id);
      for (const a of tx.list("activities")) if (a.studentIds.includes(kid.id)) {
        const rest = a.studentIds.filter((x) => x !== kid.id);
        if (rest.length) tx.update("activities", a.id, { studentIds: rest }); else tx.remove("activities", a.id);
      }
      tx.remove("students", kid.id);
    });
    document.querySelector("dialog.form-dialog[open]")?.close();
    ctx.notify(t("hs.kid.deleted"), "success");
    ctx.navigate("kids");
  } })] : [];
  let savedId = null;
  const ok = await openForm(ctx, {
    title: kid ? t("hs.kid.edit") : t("hs.kids.add"), extraActions: extra,
    groups: [{ legend: t("hs.kid.legend"), nodes: [name.element, grade.element, color.element, loop.element, notes.element] }],
    onSave: async () => {
      const lp = parseIntText(loop.input.value, 0, LOOP_MAX);
      loop.setError(lp.ok ? "" : errText(ctx, lp.error, lp));
      const v = validate("students", { name: name.input.value, grade: grade.input.value, color: color.value(), loopPerDay: lp.ok ? lp.value : 0, notes: notes.input.value });
      name.setError(v.errors.name ? errText(ctx, v.errors.name, { max: MAX.name }) : "");
      grade.setError(v.errors.grade ? errText(ctx, v.errors.grade, { max: MAX.grade }) : "");
      if (!v.ok || !lp.ok) return false;
      try {
        if (kid) { await ctx.store.update("students", kid.id, v.value); savedId = kid.id; }
        else savedId = (await ctx.store.add("students", v.value, { check: limitCheck(RECORD_LIMITS.students) })).id;
      } catch (e) {
        if (e && e.code === "limit_reached") { name.setError(errText(ctx, "limit", { max: RECORD_LIMITS.students })); return false; }
        throw e;
      }
      ctx.notify(t("hs.saved"), "success");
      return true;
    },
  });
  return ok ? savedId : null;
}

export async function openSubjectForm(ctx, data, prefs, { student, subject = null }) {
  const { t } = ctx.i18n;
  const s = subject ?? { name: "", core: true, mode: "weekly", days: [...prefs.schoolDays], minutes: prefs.defaultMinutes, resource: "", costMinor: null, finalGrade: "" };
  const name = field({ id: "sub-name", label: t("hs.subj.name"), value: s.name, maxlength: MAX.name, required: true, autocomplete: "off", hint: t("hs.subj.nameHint") });
  const coreBox = h("input", { type: "checkbox", id: "sub-core", checked: s.core === true });
  const mode = radioGroup({ legend: t("hs.subj.mode"), name: "sub-mode", value: s.mode, items: [{ value: "weekly", label: t("hs.subj.modeWeekly") }, { value: "loop", label: t("hs.subj.modeLoop") }] });
  const days = checkGroup({ legend: t("hs.subj.days"), id: "sub-days", cls: "days-group", items: WEEK_DAYS.map((d) => ({ value: String(d), label: t(`hs.day.${d}`), checked: s.days.includes(d) })) });
  const syncMode = () => { days.element.hidden = mode.value() !== "weekly"; };
  for (const r of mode.radios) r.addEventListener("change", syncMode);
  syncMode();
  const minutes = field({ id: "sub-minutes", label: t("hs.subj.minutes"), value: String(s.minutes), inputmode: "numeric", autocomplete: "off", hint: t("hs.subj.minutesHint", { min: MINUTES.subjectMin, max: MINUTES.subjectMax }) });
  const resource = field({ id: "sub-resource", label: t("hs.subj.resource"), value: s.resource, maxlength: MAX.resource, hint: t("hs.subj.resourceHint") });
  const cost = field({ id: "sub-cost", label: t("hs.subj.cost", { currency: ctx.settings.currency }), value: s.costMinor === null ? "" : localizeNumber((s.costMinor / 10 ** ctx.i18n.digits).toFixed(ctx.i18n.digits), ctx.i18n.decimal), inputmode: "decimal", autocomplete: "off", hint: t("hs.subj.costHint") });
  const final = field({ id: "sub-final", label: t("hs.subj.final"), value: s.finalGrade, maxlength: MAX.finalGrade, hint: t("hs.subj.finalHint") });
  const others = data.students.filter((x) => x.id !== student.id);
  const also = !subject && others.length ? checkGroup({ legend: t("hs.subj.alsoAdd"), id: "sub-also", items: others.map((x) => ({ value: x.id, node: h("span", { class: "kid-name" }, kidDot(x), h("span", { text: x.name })) })) }) : null;
  const extra = subject ? [button({ id: "sub-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
    const used = data.logs.filter((l) => l.subjectId === subject.id).length;
    if (!(await ctx.confirm({ title: t("hs.subj.deleteTitle"), message: t("hs.subj.deleteText", { name: s.name, n: used }) }))) return;
    await ctx.store.transactMany(["subjects", "logs", "grades"], (tx) => {
      for (const c of ["logs", "grades"]) for (const r of tx.list(c)) if (r.subjectId === subject.id) tx.remove(c, r.id);
      tx.remove("subjects", subject.id);
    });
    document.querySelector("dialog.form-dialog[open]")?.close(); ctx.refresh();
  } })] : [];
  return openForm(ctx, {
    title: subject ? t("hs.subj.edit") : t("hs.subj.add"), extraActions: extra,
    groups: [
      { legend: student.name, nodes: [name.element, h("label", { class: "check", for: coreBox.id }, coreBox, h("span", { text: t("hs.subj.coreLong") })), mode.element, days.element, minutes.element] },
      { legend: t("hs.subj.more"), nodes: [resource.element, cost.element, final.element, ...(also ? [also.element] : [])] },
    ],
    onSave: async () => {
      const m = parseIntText(minutes.input.value, MINUTES.subjectMin, MINUTES.subjectMax);
      minutes.setError(m.ok ? "" : errText(ctx, m.error, m));
      let costMinor = null;
      if (cost.input.value.trim() !== "") {
        const minor = parseMoneyText(cost.input.value, { decimal: ctx.i18n.decimal });
        if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_COST_MINOR) { cost.setError(errText(ctx, "invalid")); return false; }
        costMinor = minor;
      }
      cost.setError("");
      const lastLoop = loopSubjects(data, student.id).reduce((n, x) => Math.max(n, x.loopOrder + 1), 0);
      const rec = (sid, order) => ({ studentId: sid, name: name.input.value, core: coreBox.checked, mode: mode.value(), days: days.values().map(Number), loopOrder: order, minutes: m.ok ? m.value : 30, resource: resource.input.value, costMinor, finalGrade: final.input.value });
      const v = validate("subjects", rec(student.id, subject ? subject.loopOrder : lastLoop));
      name.setError(v.errors.name ? errText(ctx, v.errors.name, { max: MAX.name }) : "");
      days.setError(v.errors.days ? errText(ctx, "days") : "");
      if (!v.ok || !m.ok) return false;
      if (subject) await ctx.store.update("subjects", subject.id, { ...v.value, loopOrder: subject.mode === v.value.mode ? subject.loopOrder : lastLoop });
      else {
        const ids = [student.id, ...(also ? also.values() : [])];
        await ctx.store.transactMany(["subjects"], (tx) => {
          if (tx.count("subjects") + ids.length > RECORD_LIMITS.subjects) throw Object.assign(new Error("limit"), { code: "limit_reached" });
          for (const sid of ids) {
            const order = tx.list("subjects").filter((x) => x.studentId === sid && x.mode === "loop").reduce((n, x) => Math.max(n, x.loopOrder + 1), 0);
            tx.add("subjects", validate("subjects", rec(sid, order)).value);
          }
        });
      }
      ctx.notify(t("hs.saved"), "success");
      return true;
    },
  });
}

export async function mountKids(ctx, root, param) {
  const { t, formatCurrency } = ctx.i18n;
  let { data, prefs } = await loadAll(ctx);
  let sel = data.students.some((s) => s.id === param) ? param : data.students[0]?.id ?? "";
  const reload = async () => { ({ data, prefs } = await loadAll(ctx)); if (!data.students.some((s) => s.id === sel)) sel = data.students[0]?.id ?? ""; paint(); };
  ctx.onExternalChange(reload);
  const addKid = async () => { const id = await openKidForm(ctx, data); if (id) { sel = id; await reload(); } };

  function paint() {
    const head = h("div", { class: "page-head" },
      h("div", {}, h("h2", { text: t("hs.nav.kids") }), h("p", { class: "muted", id: "kids-count", text: t("hs.kids.count", { n: data.students.length, max: RECORD_LIMITS.students }) })),
      button({ id: "kid-add", label: t("hs.kids.add"), glyph: "plus", variant: "primary", disabled: data.students.length >= RECORD_LIMITS.students, onClick: addKid }));
    if (!data.students.length) {
      fill(root, head, emptyBox({ icon: "kids", id: "kids-empty", title: t("hs.kids.emptyTitle"), text: t("hs.kids.emptyText") }));
      return;
    }
    const kid = data.students.find((s) => s.id === sel);
    const subs = subjectsOf(data, kid.id);
    const weekly = subs.filter((s) => s.mode === "weekly");
    const loop = subs.filter((s) => s.mode === "loop");
    const row = (s) => h("li", {}, h("button", { type: "button", class: "item-row", "data-subject": s.id, on: { click: async () => { if (await openSubjectForm(ctx, data, prefs, { student: kid, subject: s })) await reload(); } } },
      h("span", { class: "item-main" }, h("strong", { text: s.name }),
        h("span", { class: "muted", text: [s.mode === "weekly" ? s.days.map((d) => t(`hs.day.${d}`)).join(" ") : t("hs.plan.loopTag"), dur(ctx, s.minutes), s.resource, s.costMinor !== null ? formatCurrency(s.costMinor) : ""].filter(Boolean).join(" · ") })),
      s.core ? h("span", { class: "tag tag-core", text: t("hs.subj.coreShort") }) : null));
    fill(root, head,
      kidPicker(ctx, { students: data.students, selected: sel, onPick: (id) => { sel = id; paint(); } }),
      h("section", { class: `card kid-card kid-c${colorIndex(kid.color)}`, id: "kid-detail", "data-kid": kid.id },
        h("div", { class: "kid-head" },
          h("h3", {}, h("span", { class: "kid-name" }, kidDot(kid), h("span", { text: kid.name })), kid.grade ? h("span", { class: "muted kid-grade", text: kid.grade }) : null),
          button({ id: "kid-edit", label: t("hs.kid.editShort"), glyph: "edit", onClick: async () => { if (await openKidForm(ctx, data, kid)) await reload(); } })),
        h("p", { class: "muted", text: t("hs.kid.loopLine", { n: kid.loopPerDay }) })),
      h("section", { class: "card stack", id: "subject-card" },
        h("div", { class: "kid-head" }, h("h3", { text: t("hs.subj.title") }),
          button({ id: "sub-add", label: t("hs.subj.add"), glyph: "plus", variant: "primary", onClick: async () => { if (await openSubjectForm(ctx, data, prefs, { student: kid })) await reload(); } })),
        subs.length ? null : h("p", { class: "muted", id: "sub-empty", text: t("hs.subj.emptyText") }),
        weekly.length ? h("h4", { text: t("hs.plan.weekly") }) : null,
        weekly.length ? h("ul", { class: "item-list", id: "sub-weekly" }, ...weekly.map(row)) : null,
        loop.length ? h("h4", { text: t("hs.plan.loop") }) : null,
        loop.length ? h("ul", { class: "item-list", id: "sub-loop" }, ...loop.map(row)) : null));
  }
  paint();
  if (param === "new") {
    ctx.replaceRoute("kids"); // pencere acilmadan once adres liste rotasina: kaydet / Iptal / Esc sonrasi yenilemede pencere acilmaz
    await addKid();
  }
}
