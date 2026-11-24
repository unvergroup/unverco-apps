// Belge modelini (print/docs.js) DOM'a cevirir. Kullanici verisi yalniz metin dugumu olarak girer (h() / text); innerHTML YOK.
// Letter / A4: gercek tablo (thead her sayfada tekrar eder, toplam satiri tbody'nin SON satiridir: tfoot her sayfada tekrar ederdi).
// 80 mm rulo (thermal80): tablo yok; her kayit bir blok: ust satir (primary sutunlar solda, amount sagda) + "etiket: deger" satirlari.
import { h } from "../../../core/ui.js";

const cell = (col, text, tag = "td") => h(tag, { class: col.num ? "num" : undefined, text });

function table(sec) {
  const cols = sec.columns;
  const body = sec.rows.map((r) => h("tr", {}, cols.map((c) => cell(c, r[c.key] ?? ""))));
  if (sec.total) {
    const last = cols[cols.length - 1];
    body.push(h("tr", { class: "pl-total" },
      h("th", { colspan: String(Math.max(1, cols.length - 1)), text: sec.total.label }),
      h(sec.total.value === "" ? "td" : "th", { class: last.num ? "num" : undefined, text: sec.total.value })));
  }
  return h("table", { class: "rc-table pl-table" }, h("thead", {}, h("tr", {}, cols.map((c) => cell(c, c.label, "th")))), h("tbody", {}, body));
}

function rolls(sec) {
  const cols = sec.columns;
  const items = sec.rows.map((r) => {
    const head = cols.filter((c) => c.primary).map((c) => r[c.key]).filter(Boolean).join(" · ");
    const amt = cols.find((c) => c.amount);
    const lines = cols.filter((c) => !c.primary && !c.amount && r[c.key]);
    return h("div", { class: "pl-item" },
      h("p", { class: "pl-head" }, h("span", { class: "pl-main", text: head || (amt ? "" : r[cols[0].key] ?? "") }), amt && r[amt.key] ? h("span", { class: "pl-amt", text: r[amt.key] }) : null),
      lines.map((c) => h("p", { class: "pl-line", text: `${c.label}: ${r[c.key]}` })));
  });
  if (sec.total) items.push(h("p", { class: "pl-total-line", text: [sec.total.label, sec.total.value].filter(Boolean).join(": ") }));
  return h("div", { class: "pl-list" }, items);
}

function section(sec, paper) {
  const heading = sec.heading ? h("h3", { text: sec.heading }) : null;
  if (sec.kind === "table") return h("div", { class: "rc-sec pl-sec" }, heading, paper === "thermal80" ? rolls(sec) : table(sec));
  if (sec.kind === "kv") {
    return h("div", { class: "rc-sec" }, heading, h("table", { class: "rc-totals pl-kv" }, h("tbody", {},
      sec.rows.map(([k, v, strong]) => h("tr", { class: strong ? "is-total" : undefined }, h("td", { text: k }), h("td", { class: "num", text: v }))))));
  }
  return h("div", { class: "rc-sec" }, heading, h("p", { class: sec.kind === "empty" ? "rc-text pl-empty" : "rc-note", text: sec.text }));
}

export function renderDoc(doc, paper = "letter") {
  return h("div", { class: `rc-doc pl-doc pl-${doc.id}` },
    h("section", { class: "rc-copy" },
      h("div", { class: "rc-top" }, h("h2", { class: "rc-title", text: doc.title })),
      h("p", { class: "rc-date", text: doc.period }),
      doc.sections.map((s) => section(s, paper)),
      doc.notes.map((n) => h("p", { class: "rc-note", text: n }))));
}
