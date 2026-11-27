// E5 Habits: liste (sira), Move up / Move down / Edit / Archive; Add habit; Archived bolumu (Restore, onayli Delete forever); bos durum.
import { h } from "../../../core/ui.js";
import { iconBtn, scheduleText, sectionH, textBtn, tile, topbar } from "./common.js";
import { openHabitEditor } from "./habit-editor.js";

export async function mountHabits(ctx, root) {
  const render = async () => {
    const { t, i18n } = ctx;
    const { habits, active } = await ctx.data();
    const archived = habits.filter((x) => x.archived);
    const focusId = document.activeElement?.id;
    const undo = ctx.repo.undoSize() ? textBtn("undo", t("common.undo"), async () => { await ctx.repo.undo(); ctx.notify(t("toast.undone"), "success"); await render(); }, { id: "undo-btn" }) : null;
    const add = textBtn("plus", t("habits.add"), () => openHabitEditor(ctx, null, render), { id: "habit-add", cls: "btn--gold" });
    const head = topbar(t("habits.eyebrow"), t("habits.title"), ...[undo, add].filter(Boolean));
    const sub = (x) => [scheduleText(i18n, x), x.kind === "count" ? t(x.unit ? "row.targetUnit" : "row.target", { target: x.target, unit: x.unit }) : null, x.reminder ? `${t("habits.reminderAt")} ${x.reminder}` : null].filter(Boolean).join(" · ");
    const row = (x) => h("div", { class: "hrow-item glass", id: `h-${x.id}` }, tile(x),
      h("div", { class: "habit-body" }, h("div", { class: "habit-name", text: x.name }), h("div", { class: "habit-sub", text: sub(x) })),
      h("div", { class: "row-actions" },
        iconBtn("up", t("habits.up", { name: x.name }), async () => { await ctx.repo.move(x.id, -1); await render(); }, { id: `up-${x.id}` }),
        iconBtn("down", t("habits.down", { name: x.name }), async () => { await ctx.repo.move(x.id, 1); await render(); }, { id: `down-${x.id}` }),
        iconBtn("edit", t("habits.edit", { name: x.name }), () => openHabitEditor(ctx, x, render), { id: `edit-${x.id}` }),
        iconBtn("archive", t("habits.archive", { name: x.name }), async () => {
          try {
            await ctx.repo.setArchived(x.id, true);
            ctx.undoToast(t("habits.archivedToast", { name: x.name }), render);
            await render();
          } catch (e) { ctx.fail(e); }
        }, { id: `arch-${x.id}` })));
    const list = active.length ? h("div", { class: "row-gap", id: "habit-list" }, active.map(row)) : h("section", { class: "empty glass", id: "habits-empty" }, h("h2", { text: t("today.empty") }));
    const arch = archived.length ? [sectionH(t("habits.archived"), String(archived.length), "h-archived"), h("div", { class: "row-gap", id: "archived-list" }, archived.map((x) => h("div", { class: "hrow-item glass is-archived", id: `h-${x.id}` }, tile(x),
      h("div", { class: "habit-body" }, h("div", { class: "habit-name", text: x.name }), h("div", { class: "habit-sub", text: scheduleText(i18n, x) })),
      h("div", { class: "row-actions" },
        textBtn("restore", t("habits.restore"), async () => { await ctx.repo.setArchived(x.id, false); ctx.undoToast(t("habits.restoredToast", { name: x.name }), render); await render(); }, { id: `restore-${x.id}` }),
        textBtn("trash", t("habits.deleteForever"), async () => {
          if (!(await ctx.confirm({ title: t("habits.deleteTitle", { name: x.name }), message: t("habits.deleteText"), confirmLabel: t("habits.deleteForever") }))) return;
          try { await ctx.repo.deleteForever(x.id); ctx.undoToast(t("habits.deleted"), render); await render(); } catch (e) { ctx.fail(e); }
        }, { id: `del-${x.id}`, cls: "btn--danger" })))))] : [];
    root.replaceChildren(head, h("p", { class: "muted count-line", id: "habit-count", text: i18n.tn("habits.count", active.length) }), list, ...arch);
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  };
  await render();
  ctx.onExternalChange(render);
  return null;
}
