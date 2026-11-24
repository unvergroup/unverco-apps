// Musteri bilgi karti: ad, telefon, e-posta, adres, hayvanlari ve son randevulari. Belge govdesi core/print.js (buildClientCard) ile kurulur;
// son randevular bolumu burada eklenir. Kullanici verisi yalniz metin dugumu olarak gider.
import { buildClientCard, clientCardData, requestPrint } from "../../../core/print.js";
import { h } from "../../../core/ui.js";

const RECENT = 5;

// Kart girdisi ve "son randevular" satirlari: DOM karti ve PDF modeli AYNI kaynaktan kurulur; ikisi ayrismaz.
const cardInput = (ctx, { client, pets }) => ({
  client: { ...client, notes: client.note },
  pets: pets.map((p) => ({ name: p.name, species: ctx.i18n.t(`species.${p.species}`), breed: p.breed, notes: p.specialInstructions })),
});

function recentLines(ctx, { pets, appointments, serviceName }) {
  const { t, formatDate } = ctx.i18n;
  const petName = new Map(pets.map((p) => [p.id, p.name]));
  return [...appointments].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)).slice(0, RECENT)
    .map((a) => [formatDate(a.date), a.time, serviceName(a.service), petName.get(a.petId), t(`status.${a.status}`)].filter(Boolean).join(" - "));
}

// data: { client, pets, appointments, serviceName(key) } -> DOM dugumu
export function buildCard(ctx, data) {
  const { t } = ctx.i18n;
  const card = buildClientCard({ ...cardInput(ctx, data), t });
  const recent = recentLines(ctx, data);
  const section = recent.length
    ? h("div", { class: "rc-sec" }, h("h3", { text: t("print.recentAppointments") }), h("ul", { class: "rc-list" }, recent.map((line) => h("li", { text: line }))))
    : null;
  return h("div", { class: "rc-doc" }, card, section);
}

// Ayni kartin saf belge MODELI (print/docs.js bicimi): iPhone ana ekran uygulamasinda PDF bundan uretilir.
export function cardDoc(ctx, data) {
  const { t } = ctx.i18n;
  const d = clientCardData(cardInput(ctx, data));
  const P = (k) => t(`unvercopbt.print.${k}`);
  const info = [[P("name"), d.name], [P("phone"), d.phone], [P("email"), d.email], [P("address"), d.address]].filter(([, v]) => v);
  const recent = recentLines(ctx, data);
  return {
    id: "client-card",
    title: P("clientCard"),
    period: "",
    sections: [
      ...(info.length ? [{ kind: "kv", rows: info }] : []),
      ...(d.pets.length ? [{ kind: "note", heading: P("pets"), text: d.pets.map((p) => [p.name, p.kind, p.notes].filter(Boolean).join(" - ")).join("\n") }] : []),
      ...(recent.length ? [{ kind: "note", heading: t("print.recentAppointments"), text: recent.join("\n") }] : []),
      ...(d.notes ? [{ kind: "note", heading: P("notes"), text: d.notes }] : []),
    ],
    notes: [],
    empty: false,
  };
}

export async function printClientCard(ctx, data) {
  await requestPrint(ctx, { title: ctx.i18n.t("print.clientCardTitle"), node: buildCard(ctx, data), doc: cardDoc(ctx, data) });
}
