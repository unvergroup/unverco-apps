// Kayit duzenleme penceresi (Today ve Activity ortak).
import { h, btn, field, openDialog } from "../../../core/ui.js";
import { isIsoDate } from "../../../core/dates.js";
import { removeTransaction, updateTransaction } from "../logic/actions.js";
import { envIdOf, envName, plainMoney, readMoney } from "./common.js";

export function openTxEdit(ctx, state, tx, { readOnly = false } = {}) {
  const { t } = ctx.i18n;
  const d = openDialog({ title: t(readOnly ? "tx.view" : "tx.edit"), id: "tx-dlg", closeLabel: t("common.close") });
  const signed = tx.type === "adjust";
  const amt = field({ label: t("tx.amount"), id: "tx-amount", value: plainMoney(tx.amountMinor), attrs: { inputmode: "decimal", autocomplete: "off", disabled: readOnly } });
  const date = field({ label: t("tx.date"), id: "tx-date", type: "date", value: tx.date, attrs: { disabled: readOnly } });
  const note = field({ label: t("tx.note"), id: "tx-note", value: tx.note ?? "", attrs: { maxlength: 120, disabled: readOnly } });
  const envs = state.envelopes.filter((e) => !e.hidden || envIdOf(e) === tx.envelopeId);
  const env = tx.type === "expense" ? field({ label: t("tx.envelope"), id: "tx-env", value: tx.envelopeId || "", options: [{ value: "", label: t("env.uncategorized") }, ...envs.map((e) => ({ value: envIdOf(e), label: envName(ctx, e) }))], attrs: { disabled: readOnly } }) : null;
  d.body.append(h("p", { class: "field-hint", text: t(`source.${tx.source || "manual"}`) }), h("div", { class: "formgrid two" }, amt.el, date.el), env ? env.el : null, note.el);
  if (readOnly) { d.foot.append(btn({ label: t("common.close"), id: "tx-close2", onClick: () => d.close() })); return d.done; }
  d.foot.append(
    btn({ label: t("common.delete"), cls: "danger", icon: "trash", id: "tx-delete", onClick: async () => {
      if (!(await ctx.confirm({ title: t("tx.deleteTitle"), message: t("tx.deleteMsg") }))) return;
      try { await ctx.change(() => removeTransaction(ctx.store, tx.id), t("done.deleted")); d.close(true); ctx.refresh(); } catch (e) { ctx.fail(e); }
    } }),
    btn({ label: t("common.save"), cls: "primary", id: "tx-save", onClick: async () => {
      const v = readMoney(amt.input.value, { allowNegative: signed });
      let bad = false;
      if (!(Number.isInteger(v) && (signed ? v !== 0 : v > 0))) { amt.setError(t("setup.err.amount")); bad = true; } else amt.setError("");
      if (!isIsoDate(date.input.value)) { date.setError(t("setup.err.date")); bad = true; } else date.setError("");
      if (bad) return;
      try {
        await ctx.change(() => updateTransaction(ctx.store, tx.id, { amountMinor: v, date: date.input.value, note: note.input.value.slice(0, 120), ...(env ? { envelopeId: env.input.value } : {}) }));
        d.close(true); ctx.refresh();
      } catch (e) { ctx.fail(e); }
    } }));
  return d.done;
}
