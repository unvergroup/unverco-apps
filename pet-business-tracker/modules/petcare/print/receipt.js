// Randevu fisi: tarih, musteri adi, hayvan adi, hizmet, fiyat ve odeme durumu. Belge govdesi core/print.js (buildAppointmentReceipt) ile kurulur;
// burasi randevu kaydini o islevin bekledigi bicime cevirir ve yazdirma penceresini acar. Kullanici verisi yalniz metin dugumu olarak gider.
import { buildAppointmentReceipt } from "../../../core/print.js";
import { h } from "../../../core/ui.js";

// data: { appointment, client, pet, serviceLabel } -> DOM dugumu
export function buildReceipt(ctx, { appointment: a, client, pet, serviceLabel }) {
  const { t, formatDate, formatCurrency } = ctx.i18n;
  const price = Number.isSafeInteger(a.price) ? a.price : 0;
  const body = buildAppointmentReceipt({
    appointment: {
      date: a.date, time: a.time, durationMin: a.duration,
      services: [a.serviceNote ? `${serviceLabel} (${a.serviceNote})` : serviceLabel],
      priceMinor: price, paidMinor: a.paid ? price : 0, notes: a.note,
    },
    client,
    pet: pet ? { ...pet, species: t(`species.${pet.species}`) } : null,
    t, formatDate, formatCurrency,
  });
  const status = a.paid
    ? `${t("payment.paid")}${a.paymentMethod ? ` · ${t(`payment.${a.paymentMethod}`)}` : ""}`
    : t("payment.pending");
  return h("div", { class: "rc-doc" }, body, h("p", { class: "rc-total-line", text: `${t("appt.payment")}: ${status}` }));
}

export async function printReceipt(ctx, data) {
  const paper = (await ctx.pet.get()).paper;
  await ctx.print({ title: ctx.i18n.t("print.receiptTitle"), node: buildReceipt(ctx, data), paper });
}
