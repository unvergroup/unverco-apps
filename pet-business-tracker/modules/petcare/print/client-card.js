// Musteri bilgi karti: ad, telefon, e-posta, adres, hayvanlari ve son randevulari. Belge govdesi core/print.js (buildClientCard) ile kurulur;
// son randevular bolumu burada eklenir. Kullanici verisi yalniz metin dugumu olarak gider.
import { buildClientCard } from "../../../core/print.js";
import { h } from "../../../core/ui.js";

const RECENT = 5;

// data: { client, pets, appointments, serviceName(key) } -> DOM dugumu
export function buildCard(ctx, { client, pets, appointments, serviceName }) {
  const { t, formatDate } = ctx.i18n;
  const card = buildClientCard({
    client: { ...client, notes: client.note },
    pets: pets.map((p) => ({ name: p.name, species: t(`species.${p.species}`), breed: p.breed, notes: p.specialInstructions })),
    t,
  });
  const recent = [...appointments].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)).slice(0, RECENT);
  const petName = new Map(pets.map((p) => [p.id, p.name]));
  const section = recent.length
    ? h("div", { class: "rc-sec" },
        h("h3", { text: t("print.recentAppointments") }),
        h("ul", { class: "rc-list" }, recent.map((a) => h("li", { text: [formatDate(a.date), a.time, serviceName(a.service), petName.get(a.petId), t(`status.${a.status}`)].filter(Boolean).join(" - ") }))))
    : null;
  return h("div", { class: "rc-doc" }, card, section);
}

export async function printClientCard(ctx, data) {
  const paper = (await ctx.pet.get()).paper;
  await ctx.print({ title: ctx.i18n.t("print.clientCardTitle"), node: buildCard(ctx, data), paper });
}
