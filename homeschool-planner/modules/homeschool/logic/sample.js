// Ornek veri (uydurma ama gercekci; gercek kisi / marka / yayinevi adi YOK). Bugune gore kurulur: okul yili ~7 hafta once basladi.
// buildSample(today, lang) -> { data: { koleksiyon: [kayit] }, prefs } . Metinler Ingilizce cekirdek + dile gore ders adlari.
import { addDays, startOfWeek, weekday } from "../../../core/dates.js";
import { STUDENT_COLORS } from "./schema.js";

const NAMES = {
  en: { math: "Math", read: "Reading", write: "Writing", sci: "Science", hist: "History", art: "Art", music: "Music", nature: "Nature study", spell: "Spelling", geo: "Geography", lat: "Latin", pe: "PE", grade4: "4th grade", grade2: "2nd grade", grade7: "7th grade", trip1: "Science museum", trip2: "Nature trail hike", trip3: "Library story time", place1: "City museum", place2: "State park", place3: "Public library", co: "Co-op art class", coPlace: "Community center", quiz: "Quiz", test: "Unit test", essay: "Essay", project: "Project", res4: "Grade 4 math workbook", res2: "Grade 2 math cards", res7: "Pre-algebra textbook", n1: "Fractions, page 42; needed a little help", n2: "Read two chapters aloud", n3: "Finished the volcano model", actNote: "Loved the fossil room", bookNote: "Favorite part: the storm chapter" },
  es: { math: "Matemáticas", read: "Lectura", write: "Escritura", sci: "Ciencias", hist: "Historia", art: "Arte", music: "Música", nature: "Naturaleza", spell: "Ortografía", geo: "Geografía", lat: "Latín", pe: "Educación física", grade4: "4.º grado", grade2: "2.º grado", grade7: "7.º grado", trip1: "Museo de ciencias", trip2: "Caminata por el sendero", trip3: "Cuentos en la biblioteca", place1: "Museo de la ciudad", place2: "Parque estatal", place3: "Biblioteca pública", co: "Clase de arte en grupo", coPlace: "Centro comunitario", quiz: "Prueba", test: "Examen de unidad", essay: "Redacción", project: "Proyecto", res4: "Cuaderno de matemáticas 4.º", res2: "Tarjetas de matemáticas 2.º", res7: "Libro de preálgebra", n1: "Fracciones, página 42; necesitó un poco de ayuda", n2: "Leyó dos capítulos en voz alta", n3: "Terminó la maqueta del volcán", actNote: "Le encantó la sala de fósiles", bookNote: "Su parte favorita: el capítulo de la tormenta" },
  fr: { math: "Maths", read: "Lecture", write: "Écriture", sci: "Sciences", hist: "Histoire", art: "Arts plastiques", music: "Musique", nature: "Nature", spell: "Orthographe", geo: "Géographie", lat: "Latin", pe: "Sport", grade4: "CM1", grade2: "CE1", grade7: "5e", trip1: "Musée des sciences", trip2: "Randonnée nature", trip3: "Heure du conte", place1: "Musée de la ville", place2: "Parc naturel", place3: "Médiathèque", co: "Atelier d'art en groupe", coPlace: "Maison de quartier", quiz: "Contrôle", test: "Évaluation", essay: "Rédaction", project: "Exposé", res4: "Cahier de maths CM1", res2: "Cartes de calcul CE1", res7: "Manuel de maths 5e", n1: "Fractions, page 42 ; un peu d'aide", n2: "A lu deux chapitres à voix haute", n3: "Maquette du volcan terminée", actNote: "A adoré la salle des fossiles", bookNote: "Passage préféré : le chapitre de la tempête" },
  de: { math: "Mathe", read: "Lesen", write: "Schreiben", sci: "Naturwissenschaft", hist: "Geschichte", art: "Kunst", music: "Musik", nature: "Naturkunde", spell: "Rechtschreibung", geo: "Erdkunde", lat: "Latein", pe: "Sport", grade4: "4. Klasse", grade2: "2. Klasse", grade7: "7. Klasse", trip1: "Wissenschaftsmuseum", trip2: "Naturpfad-Wanderung", trip3: "Vorlesestunde", place1: "Stadtmuseum", place2: "Naturpark", place3: "Stadtbibliothek", co: "Kunstkurs in der Gruppe", coPlace: "Gemeindezentrum", quiz: "Test", test: "Klassenarbeit", essay: "Aufsatz", project: "Projekt", res4: "Mathe-Arbeitsheft Klasse 4", res2: "Rechenkarten Klasse 2", res7: "Mathebuch Klasse 7", n1: "Brüche, Seite 42; brauchte etwas Hilfe", n2: "Zwei Kapitel laut gelesen", n3: "Vulkanmodell fertig gebaut", actNote: "Der Fossiliensaal war das Highlight", bookNote: "Lieblingsstelle: das Sturmkapitel" },
  pt: { math: "Matemática", read: "Leitura", write: "Escrita", sci: "Ciências", hist: "História", art: "Artes", music: "Música", nature: "Natureza", spell: "Ortografia", geo: "Geografia", lat: "Latim", pe: "Educação física", grade4: "4º ano", grade2: "2º ano", grade7: "7º ano", trip1: "Museu de ciências", trip2: "Trilha na natureza", trip3: "Hora do conto", place1: "Museu da cidade", place2: "Parque estadual", place3: "Biblioteca pública", co: "Aula de artes em grupo", coPlace: "Centro comunitário", quiz: "Teste", test: "Prova", essay: "Redação", project: "Projeto", res4: "Apostila de matemática 4º ano", res2: "Cartões de matemática 2º ano", res7: "Livro de pré-álgebra", n1: "Frações, página 42; precisou de uma ajudinha", n2: "Leu dois capítulos em voz alta", n3: "Terminou a maquete do vulcão", actNote: "Adorou a sala dos fósseis", bookNote: "Parte favorita: o capítulo da tempestade" },
};

// Kitaplar: TAMAMEN UYDURMA baslik ve yazar adlari (gercek kitap / kisi adi yok), her dilde kendi dilinde.
const BOOKS = {
  en: [["maya", "The Lantern on Willow Hill", "Clara Fenwick", "done"], ["maya", "Seven Keys to the Garden", "Owen Marlow", "reading"], ["maya", "A Map of Paper Stars", "Iris Holloway", "toread"],
    ["leo", "Pip the Brave Snail", "Nora Quill", "done"], ["leo", "The Tractor Who Sang", "Ben Alder", "reading"],
    ["ava", "The Clockmaker's Island", "Felix Ashcombe", "done"], ["ava", "Letters from Juniper Bay", "Mara Lindqvist", "done"], ["ava", "Beyond the Silver Ridge", "Tomas Reyner", "reading"],
    ["", "Fables from the Old Orchard", "Edda Thornbury", "reading"]],
  es: [["maya", "El farol de la colina", "Clara Fenwick", "done"], ["maya", "Siete llaves para el jardín", "Owen Marlow", "reading"], ["maya", "Un mapa de estrellas de papel", "Iris Holloway", "toread"],
    ["leo", "Pip, el caracol valiente", "Nora Quill", "done"], ["leo", "El tractor que cantaba", "Ben Alder", "reading"],
    ["ava", "La isla del relojero", "Felix Ashcombe", "done"], ["ava", "Cartas desde la bahía", "Mara Lindqvist", "done"], ["ava", "Más allá de la sierra plateada", "Tomas Reyner", "reading"],
    ["", "Fábulas del viejo huerto", "Edda Thornbury", "reading"]],
  fr: [["maya", "La lanterne de la colline", "Clara Fenwick", "done"], ["maya", "Sept clés pour le jardin", "Owen Marlow", "reading"], ["maya", "Une carte d'étoiles en papier", "Iris Holloway", "toread"],
    ["leo", "Pip, l'escargot courageux", "Nora Quill", "done"], ["leo", "Le tracteur qui chantait", "Ben Alder", "reading"],
    ["ava", "L'île de l'horloger", "Felix Ashcombe", "done"], ["ava", "Lettres de la baie", "Mara Lindqvist", "done"], ["ava", "Au-delà de la crête d'argent", "Tomas Reyner", "reading"],
    ["", "Fables du vieux verger", "Edda Thornbury", "reading"]],
  de: [["maya", "Die Laterne am Weidenhügel", "Clara Fenwick", "done"], ["maya", "Sieben Schlüssel zum Garten", "Owen Marlow", "reading"], ["maya", "Eine Karte aus Papiersternen", "Iris Holloway", "toread"],
    ["leo", "Pip, die mutige Schnecke", "Nora Quill", "done"], ["leo", "Der Traktor, der sang", "Ben Alder", "reading"],
    ["ava", "Die Insel des Uhrmachers", "Felix Ashcombe", "done"], ["ava", "Briefe aus der Wacholderbucht", "Mara Lindqvist", "done"], ["ava", "Hinter dem Silbergrat", "Tomas Reyner", "reading"],
    ["", "Fabeln aus dem alten Obstgarten", "Edda Thornbury", "reading"]],
  pt: [["maya", "A lanterna da colina", "Clara Fenwick", "done"], ["maya", "Sete chaves para o jardim", "Owen Marlow", "reading"], ["maya", "Um mapa de estrelas de papel", "Iris Holloway", "toread"],
    ["leo", "Pip, o caracol corajoso", "Nora Quill", "done"], ["leo", "O trator que cantava", "Ben Alder", "reading"],
    ["ava", "A ilha do relojoeiro", "Felix Ashcombe", "done"], ["ava", "Cartas da baía", "Mara Lindqvist", "done"], ["ava", "Além da serra prateada", "Tomas Reyner", "reading"],
    ["", "Fábulas do velho pomar", "Edda Thornbury", "reading"]],
};

export function buildSample(today, lang = "en") {
  const N = NAMES[lang] ?? NAMES.en;
  const T = `${today}T08:00:00.000Z`;
  let seq = 0;
  const rec = (prefix, fields, at = T) => ({ id: `${prefix}-${String(++seq).padStart(4, "0")}`, createdAt: at, updatedAt: at, ...fields });
  const monday = startOfWeek(today, 0);
  const yearStart = addDays(monday, -7 * 7); // 7 hafta once, pazartesi
  const yearEnd = addDays(yearStart, 7 * 40 - 3); // ~40 hafta, cuma
  const kids = [
    rec("kid", { name: "Maya", color: STUDENT_COLORS[0], grade: N.grade4, loopPerDay: 2, notes: "" }, `${yearStart}T08:00:00.001Z`),
    rec("kid", { name: "Leo", color: STUDENT_COLORS[1], grade: N.grade2, loopPerDay: 1, notes: "" }, `${yearStart}T08:00:00.002Z`),
    rec("kid", { name: "Ava", color: STUDENT_COLORS[2], grade: N.grade7, loopPerDay: 2, notes: "" }, `${yearStart}T08:00:00.003Z`),
  ];
  const [maya, leo, ava] = kids;
  const W = [0, 1, 2, 3, 4];
  const sub = (kid, name, o) => rec("sub", { studentId: kid.id, name, core: o.core ?? true, mode: o.loop !== undefined ? "loop" : "weekly", days: o.days ?? (o.loop !== undefined ? [] : W), loopOrder: o.loop ?? 0, minutes: o.min ?? 30, resource: o.res ?? "", costMinor: o.cost ?? null, finalGrade: o.final ?? "" });
  const subjects = [
    sub(maya, N.math, { min: 45, res: N.res4 }), sub(maya, N.read, { min: 30 }), sub(maya, N.write, { days: [0, 2, 4], min: 30 }),
    sub(maya, N.sci, { loop: 0, min: 40 }), sub(maya, N.hist, { loop: 1, min: 40 }), sub(maya, N.art, { loop: 2, min: 30, core: false }), sub(maya, N.music, { loop: 3, min: 30, core: false }),
    sub(leo, N.math, { min: 30, res: N.res2 }), sub(leo, N.read, { min: 25 }), sub(leo, N.spell, { days: [1, 3], min: 15 }),
    sub(leo, N.nature, { loop: 0, min: 30 }), sub(leo, N.art, { loop: 1, min: 25, core: false }), sub(leo, N.pe, { loop: 2, min: 30, core: false }),
    sub(ava, N.math, { min: 60, res: N.res7 }), sub(ava, N.write, { min: 45 }), sub(ava, N.sci, { days: [0, 2, 4], min: 50 }),
    sub(ava, N.hist, { loop: 0, min: 45 }), sub(ava, N.geo, { loop: 1, min: 40 }), sub(ava, N.lat, { loop: 2, min: 30 }), sub(ava, N.music, { loop: 3, min: 30, core: false }),
  ];
  const logs = [];
  const attendance = [];
  const grades = [];
  // Gecmis okul gunleri: her gun planin hepsi yapilir (bazi gunler eksik / hasta / tatil), bugun yalniz Maya'nin matematigi.
  const loops = new Map(kids.map((k) => [k.id, 0]));
  let dayNo = 0;
  for (let d = yearStart; d < today; d = addDays(d, 1)) {
    if (!W.includes(weekday(d))) continue;
    dayNo++;
    for (const k of kids) {
      if (dayNo === 9 && k === leo) { attendance.push(rec("att", { date: d, studentId: k.id, kind: "sick" })); continue; }
      if (dayNo === 17) { attendance.push(rec("att", { date: d, studentId: k.id, kind: "break" })); continue; }
      const mine = subjects.filter((s) => s.studentId === k.id);
      const weekly = mine.filter((s) => s.mode === "weekly" && s.days.includes(weekday(d)));
      const loop = mine.filter((s) => s.mode === "loop").sort((a, b) => a.loopOrder - b.loopOrder);
      const todays = [...weekly];
      for (let i = 0; i < k.loopPerDay; i++) todays.push(loop[(loops.get(k.id) + i) % loop.length]);
      loops.set(k.id, (loops.get(k.id) + k.loopPerDay) % loop.length);
      todays.forEach((s, i) => {
        if (dayNo % 11 === 0 && i === todays.length - 1) return; // ara sira eksik ders
        const note = i === 0 && dayNo % 9 === 4 ? [N.n1, N.n2, N.n3][(dayNo + kids.indexOf(k)) % 3] : "";
        logs.push(rec("log", { date: d, studentId: k.id, subjectId: s.id, minutes: s.minutes + ((dayNo + i) % 3) * 5, note }, `${d}T${String(9 + i).padStart(2, "0")}:00:00.000Z`));
      });
      if (dayNo % 5 === 0) attendance.push(rec("att", { date: d, studentId: k.id, kind: "school" }));
    }
    if (dayNo % 3 === 0) {
      // Not: her 3 okul gununde cocuk basina bir ders (sirayla), 78-98 arasi yuzde; arada harf notu.
      for (const [ki, k] of kids.entries()) {
        const core = subjects.filter((x) => x.studentId === k.id && x.core);
        const n = dayNo / 3;
        const sj = core[(n + ki) % core.length];
        const pct = 78 + ((n * 7 + ki * 5 + sj.name.length * 3) % 21);
        const letter = (n + ki) % 3 === 0;
        grades.push(rec("grd", { studentId: k.id, subjectId: sj.id, date: d, title: `${letter ? N.project : n % 2 ? N.quiz : N.test} ${n}`, type: letter ? "letter" : "percent", percent: letter ? null : pct, letter: letter ? ["A", "A-", "B+", "B", "A+"][(n + ki) % 5] : "" }));
      }
    }
  }
  const w = subjects.find((s) => s.studentId === ava.id && s.name === N.write);
  grades.push(rec("grd", { studentId: ava.id, subjectId: w.id, date: addDays(today, -10), title: N.essay, type: "letter", percent: null, letter: "A-" }));
  const mMath = subjects.find((s) => s.studentId === maya.id && s.name === N.math);
  logs.push(rec("log", { date: today, studentId: maya.id, subjectId: mMath.id, minutes: 45, note: N.n1 }, `${today}T09:00:00.000Z`));
  const books = (BOOKS[lang] ?? BOOKS.en).map(([who, title, author, status], i) => rec("book", { studentId: who ? { maya, leo, ava }[who].id : "", title, author, status, finishedOn: status === "done" ? addDays(today, -5 - i * 6) : "", notes: i === 0 ? N.bookNote : "" }));
  const activities = [
    rec("act", { date: addDays(yearStart, 18), title: N.trip1, place: N.place1, studentIds: kids.map((k) => k.id), minutes: 150, core: true, notes: N.actNote }),
    rec("act", { date: addDays(yearStart, 32), title: N.trip2, place: N.place2, studentIds: [maya.id, leo.id], minutes: 120, core: false, notes: "" }),
    rec("act", { date: addDays(monday, -3), title: N.co, place: N.coPlace, studentIds: kids.map((k) => k.id), minutes: 90, core: false, notes: "" }),
    rec("act", { date: addDays(yearStart, 10), title: N.trip3, place: N.place3, studentIds: [leo.id], minutes: 45, core: true, notes: "" }),
  ];
  const prefs = { yearName: `${yearStart.slice(0, 4)}–${Number(yearStart.slice(0, 4)) + 1}`, yearStart, yearEnd, targetDays: 180, targetHours: 720, targetCoreHours: 432, schoolDays: W, defaultMinutes: 30, autoAttendance: true };
  return { data: { students: kids, subjects, logs, attendance, grades, books, activities }, prefs };
}
