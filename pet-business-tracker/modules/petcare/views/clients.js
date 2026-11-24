// Musteriler ekrani: arama (musteri / hayvan adi, telefon), musteri kartlari (ad, telefon, hayvan sayisi), musteri ayrintisi (#/clients/<id>):
// bilgiler (duzenlenebilir), iletisim (Ara / WhatsApp / E-posta / SMS), hayvan kartlari + hayvan ayrintisi (duzenlenebilir), randevu gecmisi,
// musteri karti yazdirma. Sag altta "+" ile yeni musteri. Formlar fieldset + legend ile gruplanir.
// Hayvan formu: fotograf (cihazda kucultulur, JPEG data-URL) ve sonraki asi tarihi; asi yaklasinca / gecince rozet cikar.
import { validatePhone } from "../../../core/business.js";
import { localizeNumber, parseNumberText } from "../../../core/number-input.js";
import { guardWrite } from "../../../core/safe.js";
import { button, emptyState, field, h, nextId } from "../../../core/ui.js";
import { getPetHistory } from "../logic/appointments.js";
import { getPetsForClient } from "../logic/pets.js";
import { searchClients, searchPets, MIN_QUERY } from "../logic/search.js";
import { GENDERS, LIMITS, SPECIES, TEMPERAMENTS, cleanRecord, validateClient, validatePet } from "../logic/schema.js";
import { resizePhoto } from "./photo.js";
import { printClientCard } from "../print/client-card.js";
import { printClients } from "../print/screens.js";
import { icon as iconSvg } from "../../../core/icons.js";
import {
  ageText, appointmentCard, errText, kv, linkButton, loadAll, mailUrl, openAppointmentDetail, openAppointmentForm, openForm, openModal,
  petAvatar, selectField, serviceName, speciesEmoji, telUrl, toInternational, vaccineBadge, waUrl, smsUrl, weightText,
} from "./common.js";

// ---------- formlar ----------
// Musteri formu -> Promise<boolean>. client: duzenlenecek kayit ya da null.
export async function openClientForm(ctx, client = null) {
  const { t } = ctx.i18n;
  const name = field({ label: t("client.name"), value: client?.name ?? "", required: true, maxlength: LIMITS.name, autocomplete: "off" });
  const phone = field({ label: t("client.phone"), value: client?.phone ?? "", type: "tel", inputmode: "tel", maxlength: LIMITS.phone, autocomplete: "off" });
  const email = field({ label: t("client.email"), value: client?.email ?? "", type: "email", maxlength: LIMITS.email, autocomplete: "off" });
  const address = field({ label: t("client.address"), value: client?.address ?? "", multiline: true, maxlength: LIMITS.address });
  address.input.rows = 2;
  const note = field({ label: t("client.note"), value: client?.note ?? "", multiline: true, maxlength: LIMITS.clientNote });
  note.input.rows = 3;
  return openForm(ctx, {
    title: client ? t("client.edit") : t("client.new"),
    groups: [
      { legend: t("form.contactGroup"), nodes: [name.element, phone.element, email.element, address.element] },
      { legend: t("form.notesGroup"), nodes: [note.element] },
    ],
    onSave: async () => {
      const rec = { ...(client ?? {}), name: name.input.value, phone: phone.input.value, email: email.input.value, address: address.input.value, note: note.input.value };
      const { errors } = validateClient(rec);
      const phoneText = rec.phone.trim();
      if (!errors.phone && phoneText && !validatePhone(phoneText).ok) errors.phone = "phone";
      const maxes = { name: LIMITS.name, phone: LIMITS.phone, email: LIMITS.email, address: LIMITS.address, note: LIMITS.clientNote };
      for (const [k, f] of Object.entries({ name, phone, email, address, note })) f.setError(errors[k] ? errText(ctx, errors[k], maxes[k]) : "");
      if (Object.keys(errors).length) return false;
      const clean = cleanRecord("clients", rec, { keepMeta: false }).record;
      if (client) await ctx.store.update("clients", client.id, clean);
      else {
        if ((await ctx.store.count("clients")) >= LIMITS.clients) { ctx.notify(t("msg.limitReached", { max: LIMITS.clients }), "error"); return false; }
        await ctx.store.add("clients", clean);
      }
      ctx.notify(t(client ? "msg.saved" : "msg.created"), "success");
      return true;
    },
  });
}

// Hayvan formu -> Promise<boolean>. opts: { pet? (duzenle), clientId }
export async function openPetForm(ctx, { pet = null, clientId }) {
  const { t } = ctx.i18n;
  const dec = ctx.i18n.decimal;
  const name = field({ label: t("pet.name"), value: pet?.name ?? "", required: true, maxlength: LIMITS.petName, autocomplete: "off" });
  const species = selectField({ label: t("pet.species"), value: pet?.species ?? "dog", options: SPECIES.map((s) => ({ value: s, label: `${speciesEmoji(s)} ${t(`species.${s}`)}` })) });
  const breed = field({ label: t("pet.breed"), value: pet?.breed ?? "", maxlength: LIMITS.breed, autocomplete: "off" });
  const color = field({ label: t("pet.color"), value: pet?.color ?? "", maxlength: LIMITS.color, autocomplete: "off" });
  const gender = selectField({ label: t("pet.gender"), value: pet?.gender ?? "unknown", options: GENDERS.map((g) => ({ value: g, label: t(`gender.${g}`) })) });
  const birth = field({ label: t("pet.birthDate"), type: "date", value: pet?.birthDate ?? "" });
  const weight = field({ label: t("pet.weight"), value: pet?.weight ? localizeNumber(String(pet.weight / 1000), dec) : "", inputmode: "decimal", autocomplete: "off", hint: t("pet.weightHint") });
  const vaccineDue = field({ label: t("pet.vaccineDue"), type: "date", value: pet?.vaccineDue ?? "", hint: t("pet.vaccineDueHint") });
  const chip = field({ label: t("pet.microchip"), value: pet?.microchip ?? "", maxlength: LIMITS.microchip, autocomplete: "off" });
  const temperament = selectField({ label: t("pet.temperament"), value: pet?.temperament ?? "unknown", options: TEMPERAMENTS.map((x) => ({ value: x, label: t(`temperament.${x}`) })) });
  const longs = {
    vaccinations: field({ label: t("pet.vaccinations"), value: pet?.vaccinations ?? "", multiline: true, maxlength: LIMITS.vaccinations }),
    allergies: field({ label: t("pet.allergies"), value: pet?.allergies ?? "", multiline: true, maxlength: LIMITS.allergies }),
    medicalNotes: field({ label: t("pet.medicalNotes"), value: pet?.medicalNotes ?? "", multiline: true, maxlength: LIMITS.medicalNotes }),
    specialInstructions: field({ label: t("pet.specialInstructions"), value: pet?.specialInstructions ?? "", multiline: true, maxlength: LIMITS.specialInstructions }),
  };
  for (const f of Object.values(longs)) f.input.rows = 2;
  // ---- fotograf: secilen resim cihazda kucultulur; "photo" yalniz kayitta durur (dis kaynak yok) ----
  let photo = pet?.photo ?? "";
  const preview = h("div", { class: "photo-preview" });
  const photoErr = h("p", { class: "field-error", role: "alert" });
  const fileId = nextId("photo");
  const pickLabel = h("span", { class: "photo-pick-text" });
  const fileInput = h("input", { type: "file", accept: "image/*", id: fileId, class: "sr-only", "data-photo-input": "1" });
  const pick = h("label", { class: "btn photo-pick", for: fileId }, fileInput, pickLabel);
  const removeBtn = button({ id: "photo-remove", label: t("pet.photoRemove"), onClick: () => { photo = ""; photoErr.textContent = ""; fileInput.value = ""; paintPhoto(); } });
  function paintPhoto() {
    preview.replaceChildren(petAvatar({ name: name.input.value || pet?.name || "", photo }, { size: "lg" }));
    pickLabel.textContent = t(photo ? "pet.photoChange" : "pet.photoChoose");
    removeBtn.hidden = !photo;
  }
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    photoErr.textContent = "";
    try {
      photo = await resizePhoto(file);
    } catch {
      photoErr.textContent = t("pet.photoError"); // okunamayan dosya beklenen kullanici durumudur: metinle bildirilir
    }
    fileInput.value = "";
    paintPhoto();
  });
  name.input.addEventListener("input", () => { if (!photo) paintPhoto(); });
  paintPhoto();
  const photoNode = h("div", { class: "photo-field" }, preview, h("div", { class: "stack photo-actions" }, h("div", { class: "row" }, pick, removeBtn), h("p", { class: "field-hint", text: t("pet.photoHint") }), photoErr));

  return openForm(ctx, {
    title: pet ? t("pet.edit") : t("pet.new"),
    groups: [
      { legend: t("form.petGroup"), nodes: [name.element, species.element, breed.element, color.element, gender.element] },
      { legend: t("form.photoGroup"), nodes: [photoNode] },
      { legend: t("form.detailsGroup"), nodes: [birth.element, weight.element, chip.element, temperament.element] },
      { legend: t("form.healthGroup"), nodes: [longs.vaccinations.element, vaccineDue.element, longs.allergies.element, longs.medicalNotes.element, longs.specialInstructions.element] },
    ],
    onSave: async () => {
      const wText = weight.input.value.trim();
      const kg = wText === "" ? 0 : parseNumberText(wText, { decimal: dec });
      const rec = {
        ...(pet ?? {}), clientId, name: name.input.value, species: species.input.value, breed: breed.input.value, color: color.input.value,
        gender: gender.input.value, birthDate: birth.input.value, weight: Number.isNaN(kg) || kg < 0 ? -1 : Math.round(kg * 1000),
        microchip: chip.input.value, temperament: temperament.input.value, photo, vaccineDue: vaccineDue.input.value,
        ...Object.fromEntries(Object.entries(longs).map(([k, f]) => [k, f.input.value])),
      };
      const { errors } = validatePet(rec);
      const fields = { name, species, breed, color, gender, birthDate: birth, weight, microchip: chip, temperament, vaccineDue, ...longs };
      photoErr.textContent = errors.photo ? t("pet.photoError") : "";
      const maxes = { name: LIMITS.petName, breed: LIMITS.breed, color: LIMITS.color, microchip: LIMITS.microchip, vaccinations: LIMITS.vaccinations, allergies: LIMITS.allergies, medicalNotes: LIMITS.medicalNotes, specialInstructions: LIMITS.specialInstructions };
      for (const [k, f] of Object.entries(fields)) f.setError(errors[k] ? errText(ctx, errors[k], maxes[k]) : "");
      if (Object.keys(errors).length) return false;
      const clean = cleanRecord("pets", rec, { keepMeta: false }).record;
      if (pet) await ctx.store.update("pets", pet.id, clean);
      else {
        if ((await ctx.store.count("pets")) >= LIMITS.pets) { ctx.notify(t("msg.limitReached", { max: LIMITS.pets }), "error"); return false; }
        await ctx.store.add("pets", clean);
      }
      ctx.notify(t(pet ? "msg.saved" : "msg.created"), "success");
      return true;
    },
  });
}

// ---------- hayvan ayrintisi ----------
async function openPetDetail(ctx, petId, onChange) {
  const { t, formatDate } = ctx.i18n;
  const body = h("div", { class: "stack detail-body" });
  const m = openModal(ctx, { title: t("pet.detail"), children: [body], className: "detail-dialog" });
  const changed = () => { if (onChange) Promise.resolve(onChange()).catch((e) => ctx.fail(e)); };

  async function paint() {
    const data = await loadAll(ctx);
    const pet = data.pById.get(petId);
    if (!pet) { m.close(); return; }
    const history = getPetHistory(data, petId);
    body.replaceChildren(
      h("p", { class: "pet-hero" }, petAvatar(pet, { size: "lg" }), h("span", { class: "pet-hero-text" }, h("strong", { text: pet.name }), h("span", { class: "muted pet-hero-sub", text: t(`species.${pet.species}`) }))),
      kv([
        [t("pet.species"), t(`species.${pet.species}`)], [t("pet.breed"), pet.breed], [t("pet.color"), pet.color], [t("pet.gender"), t(`gender.${pet.gender}`)],
        [t("pet.birthDate"), pet.birthDate ? formatDate(pet.birthDate) : ""], [t("pet.age"), ageText(ctx, pet.birthDate)], [t("pet.weight"), weightText(ctx, pet.weight)],
        [t("pet.microchip"), pet.microchip], [t("pet.temperament"), pet.temperament === "unknown" ? "" : t(`temperament.${pet.temperament}`)],
        [t("pet.vaccinations"), pet.vaccinations],
        [t("pet.vaccineDue"), pet.vaccineDue ? h("span", { class: "vax-line" }, formatDate(pet.vaccineDue), vaccineBadge(ctx, pet)) : ""],
        [t("pet.allergies"), pet.allergies], [t("pet.medicalNotes"), pet.medicalNotes], [t("pet.specialInstructions"), pet.specialInstructions],
      ]),
      h("div", { class: "row" },
        button({ id: "pet-edit", label: t("common.edit"), onClick: async () => { if (await openPetForm(ctx, { pet, clientId: pet.clientId })) { await paint(); changed(); } } }),
        button({ id: "pet-appt", label: t("client.newAppointment"), variant: "primary", onClick: async () => { m.close(); if (await openAppointmentForm(ctx, { clientId: pet.clientId, petId: pet.id })) changed(); } }),
        button({ id: "pet-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
          if (!(await ctx.confirm({ title: t("pet.deleteTitle"), message: t("pet.deleteText", { name: pet.name, n: history.length }) }))) return;
          try {
            await ctx.store.transactMany(["pets", "appointments"], (tx) => {
              for (const a of tx.list("appointments")) if (a.petId === pet.id) tx.remove("appointments", a.id);
              tx.remove("pets", pet.id);
            });
          } catch (e) { ctx.fail(e); return; }
          ctx.notify(t("msg.deleted"), "success");
          m.close(); changed();
        } })),
      h("section", { class: "stack", "aria-label": t("pet.history") },
        h("h3", { text: t("pet.history") }),
        history.length
          ? h("div", { class: "appt-list" }, ...history.slice(0, 5).map((a) => appointmentCard(ctx, a, data, { showDate: true, wa: false, onOpen: (x) => openAppointmentDetail(ctx, x.id, async () => { await paint(); changed(); }) })))
          : h("p", { class: "muted", text: t("pet.noHistory") })));
  }
  await paint();
  return m.done;
}

// ---------- ekran ----------
export async function mountClients(ctx, root, param) {
  return param ? mountDetail(ctx, root, param) : mountList(ctx, root);
}

async function mountList(ctx, root) {
  const { t, tn } = ctx.i18n;
  let data = await loadAll(ctx);
  let query = "";
  const search = field({ label: t("client.search"), type: "search", autocomplete: "off", maxlength: 80 });
  search.input.placeholder = t("client.searchPlaceholder");
  search.element.classList.add("search-field");
  search.element.querySelector("label").classList.add("sr-only");
  const list = h("div", { class: "client-list" });
  const create = async () => { if (await openClientForm(ctx)) await reload(); };

  function visible() {
    const sorted = [...data.clients].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    if (query.trim().length < MIN_QUERY) return sorted;
    const ids = new Set(searchClients(data, query, { limit: 500 }).map((c) => c.id));
    for (const p of searchPets(data, query, { limit: 500 })) ids.add(p.clientId);
    return sorted.filter((c) => ids.has(c.id));
  }
  function paint() {
    if (!data.clients.length) {
      list.replaceChildren(emptyState({ title: t("client.empty"), text: t("client.emptyHint") }), h("p", { class: "center" }, button({ id: "client-add-first", label: t("client.new"), variant: "primary", onClick: create })));
      return;
    }
    const rows = visible();
    if (!rows.length) { list.replaceChildren(emptyState({ title: t("client.noResults") })); return; }
    const petCount = new Map();
    for (const p of data.pets) petCount.set(p.clientId, (petCount.get(p.clientId) ?? 0) + 1);
    list.replaceChildren(...rows.map((c) => {
      const n = petCount.get(c.id) ?? 0;
      const pets = data.pets.filter((p) => p.clientId === c.id).slice(0, 4);
      return h("a", { class: "client-card", href: `#/clients/${encodeURIComponent(c.id)}`, "data-client": c.id, "aria-label": `${c.name}${c.phone ? `, ${c.phone}` : ""}, ${tn("client.petCount", n)}` },
        h("span", { class: "client-main" }, h("strong", { text: c.name }), h("span", { class: "muted", text: c.phone || c.email || "" })),
        h("span", { class: "client-pets", "aria-hidden": "true" }, ...pets.slice(0, 5).map(() => iconSvg("paw", { size: 15 }))),
        h("span", { class: "badge", text: tn("client.petCount", n) }));
    }));
  }
  search.input.addEventListener("input", () => { query = search.input.value; paint(); });
  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  const printBtn = button({ id: "clients-print", glyph: "print", label: t("pl.btn.clients"), exportAction: true, onClick: () => printClients(ctx, { data, clients: visible(), query }) });
  root.replaceChildren(h("h2", { text: t("client.title") }), search.element, h("div", { class: "row print-row" }, printBtn), list, h("button", { type: "button", class: "fab", id: "fab-new", "aria-label": t("client.new"), text: "+", on: { click: create } }));
  paint();
}

async function mountDetail(ctx, root, id) {
  const { t } = ctx.i18n;
  const guard = guardWrite((e) => ctx.fail(e));
  let data = await loadAll(ctx);
  const page = h("div", { class: "stack client-detail" });

  const back = () => ctx.navigate("clients");
  function paint() {
    const c = data.cById.get(id);
    if (!c) {
      page.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: t("client.notFound") }), button({ id: "client-back", label: t("btn.backToClients"), icon: "back", onClick: back }));
      return;
    }
    const pets = getPetsForClient(data, id);
    const appts = data.appointments.filter((a) => a.clientId === id).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
    const num = toInternational(c.phone, ctx.settings.locale);
    const contact = [];
    if (c.phone) contact.push(linkButton({ href: num ? telUrl(num) : `tel:${c.phone.replace(/[^\d+]/g, "")}`, label: t("client.call"), glyph: "phone" }));
    if (num) contact.push(linkButton({ href: waUrl(num), label: t("msg.whatsapp"), glyph: "chat", cls: "btn-wa", external: true }));
    if (c.email && mailUrl(c.email)) contact.push(linkButton({ href: mailUrl(c.email), label: t("client.sendEmail"), glyph: "mail" }));
    if (num) contact.push(linkButton({ href: smsUrl(num), label: t("msg.sms"), glyph: "sms" }));

    const petCards = pets.map((p) => { const vb = vaccineBadge(ctx, p); return h("button", { type: "button", class: "pet-card", "data-pet": p.id, "aria-label": `${p.name}, ${t(`species.${p.species}`)}${p.breed ? `, ${p.breed}` : ""}${vb ? `, ${vb.textContent.trim()}` : ""}`, on: { click: () => openPetDetail(ctx, p.id, reload) } },
      petAvatar(p, { size: "md" }),
      h("span", { class: "pet-info" }, h("strong", { text: p.name }), h("span", { class: "muted", text: [p.breed || t(`species.${p.species}`), ageText(ctx, p.birthDate)].filter(Boolean).join(" · ") }), vb)); });

    page.replaceChildren(
      h("div", { class: "detail-top" },
        button({ id: "client-back", label: t("btn.backToClients"), icon: "back", onClick: back }),
        h("h2", { text: c.name })),
      h("section", { class: "card stack", "aria-label": t("client.info") },
        h("h3", { text: t("client.info") }),
        kv([[t("client.phone"), c.phone], [t("client.email"), c.email], [t("client.address"), c.address], [t("client.note"), c.note]]),
        h("h4", { text: t("client.contact") }),
        contact.length ? h("div", { class: "row contact-row" }, ...contact) : h("p", { class: "muted", text: t("client.noContact") }),
        h("div", { class: "row" },
          button({ id: "client-edit", label: t("common.edit"), onClick: async () => { if (await openClientForm(ctx, c)) await reload(); } }),
          button({ id: "client-print", glyph: "print", label: t("btn.printCard"), exportAction: true, onClick: () => printClientCard(ctx, { client: c, pets, appointments: appts, serviceName: (k) => serviceName(ctx, k) }) }),
          button({ id: "client-delete", label: t("common.delete"), variant: "danger", onClick: guard(async () => {
            if (!(await ctx.confirm({ title: t("client.deleteTitle"), message: t("client.deleteText", { name: c.name, pets: pets.length, appts: appts.length }) }))) return;
            await ctx.store.transactMany(["clients", "pets", "appointments"], (tx) => {
              for (const a of tx.list("appointments")) if (a.clientId === id) tx.remove("appointments", a.id);
              for (const p of tx.list("pets")) if (p.clientId === id) tx.remove("pets", p.id);
              tx.remove("clients", id);
            });
            ctx.notify(t("msg.deleted"), "success");
            back();
          }, "client-delete") }))),
      h("section", { class: "card stack", "aria-label": t("client.pets") },
        h("div", { class: "toolbar" }, h("h3", { text: `${t("client.pets")} (${pets.length})` }), button({ id: "pet-add", label: t("pet.new"), onClick: async () => { if (await openPetForm(ctx, { clientId: id })) await reload(); } })),
        pets.length ? h("div", { class: "pet-list" }, ...petCards) : h("p", { class: "muted", text: t("client.noPets") })),
      h("section", { class: "card stack", "aria-label": t("client.appointments") },
        h("div", { class: "toolbar" }, h("h3", { text: `${t("client.appointments")} (${appts.length})` }),
          button({ id: "appt-add", label: t("client.newAppointment"), variant: "primary", onClick: async () => {
            if (!pets.length) { ctx.notify(t("client.needPet"), "warn"); return; }
            if (await openAppointmentForm(ctx, { clientId: id })) await reload();
          } })),
        appts.length ? h("div", { class: "appt-list" }, ...appts.map((a) => appointmentCard(ctx, a, data, { showDate: true, wa: false, onOpen: (x) => openAppointmentDetail(ctx, x.id, reload) }))) : h("p", { class: "muted", text: t("client.noAppointments") })));
  }
  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  root.replaceChildren(page);
  paint();
}
