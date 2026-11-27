// E5a Habit editor (yerel <dialog>): ad, simge (24), renk (10), tur (Check / Count), hedef + birim, siklik, hatirlatma saati (yalniz .ics).
import { h, nextId } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { COLORS, ICONS, validateHabit } from "../logic/schema.js";

export function openHabitEditor(ctx, habit, onSaved) {
  const { t, i18n } = ctx;
  const v = habit ?? { name: "", icon: "star", color: "cyan", kind: "check", target: 8, unit: "", schedule: { type: "daily" }, reminder: "" };
  const tid = nextId("he");
  const err = {};
  const errEl = (k) => (err[k] = h("p", { class: "field-error", id: `he-err-${k}`, role: "alert" }));
  const name = h("input", { id: "he-name", type: "text", maxlength: "60", autocomplete: "off", "aria-describedby": "he-err-name", value: v.name });
  const radios = (group, values, cur, render) => h("div", { class: `swatches swatches-${group}`, role: "radiogroup", "aria-label": t(`habit.${group}`) },
    values.map((x) => h("label", { class: `swatch swatch-${group}${group === "color" ? ` hc-${x}` : ""}`, title: t(`${group}.${x}`) },
      h("input", { type: "radio", name: `he-${group}`, id: `he-${group}-${x}`, value: x, checked: x === cur, "aria-label": t(`${group}.${x}`) }), render(x))));
  const iconPick = radios("icon", ICONS, v.icon, (x) => h("span", { class: "swatch-face" }, icon(x, { size: 22 })));
  const colorPick = radios("color", COLORS, v.color, () => h("span", { class: "swatch-face swatch-dot" }));
  const kindSeg = h("div", { class: "seg", role: "radiogroup", "aria-label": t("habit.kind") }, ["check", "count"].map((k) =>
    h("label", { class: "seg-opt" }, h("input", { type: "radio", name: "he-kind", id: `he-kind-${k}`, value: k, checked: v.kind === k }), h("span", { text: t(`habit.${k}`) }))));
  const target = h("input", { id: "he-target", type: "number", inputmode: "numeric", min: "1", max: "99", value: String(v.kind === "count" ? v.target : 8), "aria-describedby": "he-err-target" });
  const unit = h("input", { id: "he-unit", type: "text", maxlength: "12", value: v.unit ?? "", placeholder: t("habit.unitHint"), "aria-describedby": "he-err-unit" });
  const countBox = h("div", { class: "field-row", id: "he-count-box" },
    h("div", { class: "field" }, h("label", { for: "he-target", text: t("habit.target") }), target, errEl("target")),
    h("div", { class: "field" }, h("label", { for: "he-unit", text: t("habit.unit") }), unit, errEl("unit")));
  const s = v.schedule ?? { type: "daily" };
  const freq = h("select", { id: "he-freq" }, ["daily", "days", "weekly", "monthly"].map((x) => h("option", { value: x, text: t(`habit.freq.${x}`) })));
  freq.value = s.type;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const dayBox = h("div", { class: "days", id: "he-days", role: "group", "aria-label": t("habit.daysLabel") }, order.map((d) =>
    h("label", { class: "day-opt" }, h("input", { type: "checkbox", id: `he-day-${d}`, value: String(d), checked: (s.days ?? []).includes(d) }), h("span", { text: i18n.weekdayShort[d] }))));
  const times = h("input", { id: "he-times", type: "number", inputmode: "numeric", min: "1", max: "31", value: String(s.times ?? 3), "aria-describedby": "he-err-times" });
  const timesBox = h("div", { class: "field", id: "he-times-box" }, h("label", { for: "he-times", id: "he-times-label" }), times, errEl("times"));
  const reminder = h("input", { id: "he-reminder", type: "time", value: v.reminder ?? "", "aria-describedby": "he-reminder-hint" });
  const sync = () => {
    const kind = kindSeg.querySelector("input:checked").value;
    countBox.hidden = kind !== "count";
    dayBox.hidden = freq.value !== "days";
    timesBox.hidden = !["weekly", "monthly"].includes(freq.value);
    timesBox.querySelector("label").textContent = t(freq.value === "monthly" ? "habit.timesMonth" : "habit.timesWeek");
  };
  kindSeg.addEventListener("change", sync);
  freq.addEventListener("change", sync);

  const dlg = h("dialog", { class: "dialog editor", "aria-labelledby": tid },
    h("form", { method: "dialog", id: "he-form", novalidate: true },
      h("h2", { id: tid, text: t(habit ? "habit.editTitle" : "habit.newTitle") }),
      h("div", { class: "field" }, h("label", { for: "he-name", text: t("habit.name") }), name, errEl("name")),
      h("fieldset", { class: "fs" }, h("legend", { text: t("habit.icon") }), iconPick),
      h("fieldset", { class: "fs" }, h("legend", { text: t("habit.color") }), colorPick),
      h("fieldset", { class: "fs" }, h("legend", { text: t("habit.kind") }), kindSeg),
      countBox,
      h("div", { class: "field" }, h("label", { for: "he-freq", text: t("habit.freq") }), freq),
      dayBox, h("p", { class: "field-error", id: "he-err-days", role: "alert" }), timesBox,
      h("div", { class: "field" }, h("label", { for: "he-reminder", text: t("habit.reminder") }), reminder, h("p", { class: "field-hint", id: "he-reminder-hint", text: t("habit.reminderHint") })),
      h("div", { class: "dialog-actions" },
        h("button", { type: "button", class: "btn", id: "he-cancel", text: t("common.cancel"), on: { click: () => dlg.close() } }),
        h("button", { type: "submit", class: "btn btn--gold", id: "he-save", text: t("common.save") }))));
  err.days = dlg.querySelector("#he-err-days");
  sync();

  dlg.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const kind = kindSeg.querySelector("input:checked").value;
    const input = {
      name: name.value, icon: iconPick.querySelector("input:checked")?.value, color: colorPick.querySelector("input:checked")?.value,
      kind, target: Number(target.value), unit: unit.value,
      schedule: { type: freq.value, days: [...dayBox.querySelectorAll("input:checked")].map((x) => Number(x.value)), times: Number(times.value) },
      reminder: reminder.value,
    };
    const res = validateHabit(input);
    for (const k of Object.keys(err)) err[k].textContent = "";
    for (const el of [name, target, unit, times]) el.setAttribute("aria-invalid", "false");
    if (!res.ok) {
      for (const [k, key] of Object.entries(res.errors)) { if (err[k]) err[k].textContent = t(key); }
      const first = { name, target, unit, times }[Object.keys(res.errors)[0]] ?? dayBox.querySelector("input");
      first?.setAttribute("aria-invalid", "true");
      first?.focus();
      return;
    }
    try {
      if (habit) await ctx.repo.updateHabit(habit.id, res.value);
      else await ctx.repo.addHabit(res.value, ctx.today());
      dlg.close();
      ctx.undoToast(t("habit.saved"), onSaved);
      await onSaved?.();
    } catch (ex) { ctx.fail(ex); }
  });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  name.focus();
  return dlg;
}
