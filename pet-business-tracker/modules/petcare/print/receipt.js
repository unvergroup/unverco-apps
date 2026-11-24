// Randevu fisi: tarih, musteri adi, hayvan adi, hizmet, fiyat ve odeme durumu. Belge govdesi core/print.js (buildAppointmentReceipt) ile kurulur;
// burasi randevu kaydini o islevin bekledigi bicime cevirir ve yazdirma penceresini acar. Kullanici verisi yalniz metin dugumu olarak gider.
import { buildAppointmentReceipt, receiptData, requestPrint } from "../../../core/print.js";
import { h } from "../../../core/ui.js";

// Randevu kaydi -> fis girdisi (DOM fisi ve PDF modeli AYNI girdiden kurulur; ikisi ayrismaz).
function receiptInput(ctx, { appointment: a, client, pet, serviceLabel }) {
  const { t } = ctx.i18n;
  const price = Number.isSafeInteger(a.price) ? a.price : 0;
  return {
    appointment: {
      date: a.date, time: a.time, durationMin: a.duration,
      services: [a.serviceNote ? `${serviceLabel} (${a.serviceNote})` : serviceLabel],
      priceMinor: price, paidMinor: a.paid ? price : 0, notes: a.note,
    },
    client,
    pet: pet ? { ...pet, species: t(`species.${pet.species}`) } : null,
  };
}

const paymentStatus = (ctx, a) => {
  const { t } = ctx.i18n;
  return a.paid ? `${t("payment.paid")}${a.paymentMethod ? ` · ${t(`payment.${a.paymentMethod}`)}` : ""}` : t("payment.pending");
};

// data: { appointment, client, pet, serviceLabel } -> DOM dugumu
export function buildReceipt(ctx, data) {
  const { t, formatDate, formatCurrency } = ctx.i18n;
  const body = buildAppointmentReceipt({ ...receiptInput(ctx, data), t, formatDate, formatCurrency });
  return h("div", { class: "rc-doc" }, body, h("p", { class: "rc-total-line", text: `${t("appt.payment")}: ${paymentStatus(ctx, data.appointment)}` }));
}

// Ayni fisin saf belge MODELI (print/docs.js bicimi): iPhone ana ekran uygulamasinda PDF bundan uretilir. Bos alan satiri yazilmaz.
export function receiptDoc(ctx, data) {
  const { t, formatDate, formatCurrency } = ctx.i18n;
  const d = receiptData(receiptInput(ctx, data));
  const P = (k) => t(`unvercopbt.print.${k}`);
  const rows = (list) => list.filter(([, v]) => v !== "" && v !== null && v !== undefined);
  const kv = (heading, list) => (rows(list).length ? [{ kind: "kv", heading, rows: rows(list) }] : []);
  const service = [...d.services, d.durationMin !== null ? t("unvercopbt.print.duration", { min: d.durationMin }) : ""].filter(Boolean).join("\n");
  return {
    id: "receipt",
    title: P("receipt"),
    period: [d.date ? formatDate(d.date) : "", d.time].filter(Boolean).join(" "),
    sections: [
      ...kv(P("client"), [[P("name"), d.clientName], [P("phone"), d.clientPhone]]),
      ...kv(P("pet"), [[P("name"), d.petName], [P("kind"), d.petKind]]),
      ...(service ? [{ kind: "note", heading: P("services"), text: service }] : []),
      { kind: "kv", rows: [
        ...(d.priceMinor === null ? [] : [[P("price"), formatCurrency(d.priceMinor)], [P("paid"), formatCurrency(d.paidMinor)], [P("due"), formatCurrency(d.dueMinor), true]]),
        [t("appt.payment"), paymentStatus(ctx, data.appointment)],
      ] },
      ...(d.notes ? [{ kind: "note", heading: P("notes"), text: d.notes }] : []),
    ],
    notes: [],
    empty: false,
  };
}

export async function printReceipt(ctx, data) {
  await requestPrint(ctx, { title: ctx.i18n.t("print.receiptTitle"), node: buildReceipt(ctx, data), doc: receiptDoc(ctx, data) });
}
