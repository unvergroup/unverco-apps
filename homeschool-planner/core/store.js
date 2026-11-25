// Homeschool Planner: cihazda kalici veri, kucuk anahtar-koleksiyon deposu. Koleksiyonlar: students, subjects, logs, attendance, grades, books, activities (+ hsPrefs, business, sequences).
// Depolama arayuzu (adapter) disaridan verilir: { get, set, delete, keys } (hepsi async).
// Koleksiyon = kayit dizisi; adapter'da tek anahtar altinda saklanir.
import { cleanStrings } from "./sanitize.js";

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
export const SEQUENCES = "sequences";

// Homeschool Planner koleksiyon adlari. Seri numarasi kullanilmaz (SERIAL_PREFIX bos; formatSerial genel yardimci olarak kalir).
export const COLLECTIONS = Object.freeze({ students: "students", subjects: "subjects", logs: "logs", attendance: "attendance", grades: "grades", books: "books", activities: "activities" });
export const SERIAL_PREFIX = Object.freeze({});
export const serialPrefixFor = (collection) => SERIAL_PREFIX[collection];

// "A-2026-0042": onek 1-6 harf, yil 4 hane, sira en az 4 hane.
export function formatSerial(prefix, year, n, pad = 4) {
  if (!/^[A-Za-z]{1,6}$/.test(String(prefix))) throw new RangeError(`Bad prefix: ${prefix}`);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new RangeError(`Bad year: ${year}`);
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Bad number: ${n}`);
  return `${prefix}-${year}-${String(n).padStart(pad, "0")}`;
}

// ---- Adapterler -----------------------------------------------------------

export function createMemoryAdapter() {
  const map = new Map();
  return {
    kind: "memory",
    async get(k) { return map.has(k) ? structuredClone(map.get(k)) : undefined; },
    async set(k, v) { map.set(k, structuredClone(v)); },
    async setMany(entries) { for (const [k, v] of entries) map.set(k, structuredClone(v)); },
    async delete(k) { map.delete(k); },
    async keys() { return [...map.keys()]; },
  };
}

export const MAX_CORRUPT_COPIES = 3;

// Bozuk kayit kopyalari `corrupt:<zaman>:<anahtar>` adiyla durur; ayni uygulamanin (onek) en cok 3 kopyasi tutulur, eskiler silinir.
function pruneCorrupt(storage, prefix) {
  const mine = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    const m = /^corrupt:(\d+):(.*)$/.exec(k ?? "");
    if (m && m[2].startsWith(prefix ? `${prefix}:` : "")) mine.push({ k, at: Number(m[1]) });
  }
  mine.sort((a, b) => b.at - a.at);
  for (const { k } of mine.slice(MAX_CORRUPT_COPIES)) storage.removeItem(k);
}

// "Tum veriyi sil": bu uygulamanin (onek) bozuk kayit kopyalari da silinir; baska onekli (demo / onizleme / baska arac) kopyalara dokunulmaz.
export function purgeCorruptCopies(storage, prefix) {
  const doomed = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    const m = /^corrupt:(\d+):(.*)$/.exec(k ?? "");
    if (m && prefix && m[2].startsWith(`${prefix}:`)) doomed.push(k);
  }
  for (const k of doomed) storage.removeItem(k);
  return doomed.length;
}

// prefix: bu uygulamanin depo oneki; verilirse yalniz onunla baslayan bozuk kopyalar budanir.
export function createLocalStorageAdapter(storage, prefix = "") {
  const corrupted = [];
  return {
    kind: "localStorage",
    async get(k) {
      const raw = storage.getItem(k);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        // Bozuk veri uygulamayi kilitlemesin: oldugu gibi ayri anahtara tasinir, bos baslanir.
        try { storage.setItem(`corrupt:${Date.now()}:${k}`, raw); } catch { /* yer yoksa yine de ayir */ }
        storage.removeItem(k);
        try { pruneCorrupt(storage, prefix); } catch { /* budama basarisizsa kopyalar kalir */ }
        corrupted.push(k);
        return undefined;
      }
    },
    async set(k, v) { storage.setItem(k, JSON.stringify(v)); },
    async delete(k) { storage.removeItem(k); },
    async keys() {
      const out = [];
      for (let i = 0; i < storage.length; i++) out.push(storage.key(i));
      return out;
    },
    // Bozuk bulunup tasinan anahtarlar (bir kez doner); arayuz kullaniciya bildirir.
    takeCorrupted() { return corrupted.splice(0); },
  };
}

function openDb(indexedDB, name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

export async function createIndexedDbAdapter(indexedDB, name) {
  const db = await openDb(indexedDB, name);
  const run = (mode, fn) =>
    new Promise((resolve, reject) => {
      const t = db.transaction("kv", mode);
      const req = fn(t.objectStore("kv"));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    kind: "indexedDB",
    get: (k) => run("readonly", (s) => s.get(k)),
    set: (k, v) => run("readwrite", (s) => s.put(v, k)),
    // Birden cok anahtar TEK IndexedDB islemiyle yazilir: hepsi ya da hicbiri (transactMany).
    setMany: (entries) => run("readwrite", (s) => { let last; for (const [k, v] of entries) last = s.put(v, k); return last; }),
    delete: (k) => run("readwrite", (s) => s.delete(k)),
    keys: () => run("readonly", (s) => s.getAllKeys()),
  };
}

// IndexedDB varsa onu, yoksa ya da acilamazsa localStorage'i kullanir. Ikisi de calismazsa (ozel gezinti, engelli
// depolama, dolu kota) uygulama KILITLENMEZ: bellekte calisan gecici depoya duser (adapter.volatile === true);
// arayuz "bu oturumda veriler kaydedilmiyor" uyarisini gosterir. Veri sayfa kapaninca gider.
export async function createDefaultAdapter(env = globalThis, name = "app") {
  if (env.indexedDB) {
    try {
      const a = await createIndexedDbAdapter(env.indexedDB, name);
      await a.get("__probe");
      return a;
    } catch {
      /* localStorage'a dus */
    }
  }
  try {
    const ls = env.localStorage; // erisim engelliyse erisimin kendisi hata verir
    if (ls) {
      const probe = `${name}:__probe`;
      ls.setItem(probe, "1"); // okuma var ama yazma yok (kota 0, bazi ozel kipler) durumunu yakalar
      ls.removeItem(probe);
      return createLocalStorageAdapter(ls, name);
    }
  } catch {
    /* gecici depoya dus */
  }
  return { ...createMemoryAdapter(), volatile: true };
}

// ---- Goc ------------------------------------------------------------------

// migrations: { 2: (data) => data, 3: ... }  -> surum N'ye geciste calisir.
// data: { koleksiyon: [kayit, ...] }
export async function migrateData(data, from, to, migrations = {}) {
  let current = data;
  for (let v = from + 1; v <= to; v++) {
    const fn = migrations[v];
    if (fn) {
      const out = await fn(current);
      if (out !== undefined) current = out;
    }
  }
  return current;
}

// Kayit JSON'a normallenir: undefined alan dusar, Date metne doner (yedek toplami tutsun).
const normalize = (v) => JSON.parse(JSON.stringify(v));
// Form yazma yolu: gorunmez / yon bicimleme karakterleri depoya hic girmez (yedek yoluyla ayni kume; bkz. core/sanitize.js).
const writeClean = (v) => cleanStrings(normalize(v));

export function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new StoreError("bad_data", "Data must be an object of collections.");
  }
  for (const [name, list] of Object.entries(data)) {
    if (!NAME_RE.test(name)) throw new StoreError("bad_name", `Bad collection name: ${name}`);
    if (!Array.isArray(list) || !list.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      throw new StoreError("bad_data", `Collection "${name}" must be a list of records.`);
    }
  }
}

// ---- Depo -----------------------------------------------------------------

// Yazma duzeni (yeniden girise dayanikli):
//   1. meta = { schemaVersion: TAMAMLANAN, pending: { schemaVersion, data } }  (tek anahtar, tek adim)
//   2. koleksiyonlar yazilir
//   3. meta = { schemaVersion }  (pending kalkar)
// Adim 2'de hata olursa anlik goruntuye geri donulur; surec adim 1-3 arasinda olurse
// sonraki init() pending verisini yeniden yazar, goc ikinci kez calismaz.
//
// Sekmeler arasi: `locks` (Web Locks, orn. navigator.locks) verilirse her okuma/yazma
// kilit altinda calisir; `sync.notify()` her degisiklikten sonra diger sekmelere haber verir.
export function createStore({
  adapter,
  prefix = "app",
  schemaVersion = 1,
  migrations = {},
  idGen = defaultId,
  now = () => new Date().toISOString(),
  locks = null,
  sync = null,
  writeGuard = null, // async (extra) -> yazmadan once kilit icinde cagrilir; atarsa yazma yapilmaz (orn. baska sekme para birimini degistirdi)
} = {}) {
  if (!adapter) throw new StoreError("no_adapter", "A storage adapter is required.");
  const metaKey = `${prefix}:meta`;
  const txKey = `${prefix}:tx`; // setMany'siz depoda (localStorage) coklu yazma gunlugu
  let inTx = false; // transactMany govdesi calisirken baska depo cagrisi KILIT BEKLEMEZ: beklerse kilitlenirdi
  const noNested = () => { if (inTx) throw new StoreError("nested_tx", "A store call was made inside a transaction."); };
  const colKey = (name) => `${prefix}:c:${name}`;
  const colPrefix = `${prefix}:c:`;
  const lockName = `${prefix}:write`;

  // Islemler sirayla yurusun (es zamanli ekleme kaybi olmasin); varsa sekmeler arasi kilit.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = () => (locks ? locks.request(lockName, { mode: "exclusive" }, fn) : fn());
    const p = chain.then(run);
    chain = p.catch(() => {});
    return p;
  };
  const changed = () => {
    try {
      if (sync) sync.notify();
    } catch {
      /* bildirim basarisizsa yazma yine gecerlidir */
    }
  };

  const checkName = (name) => {
    if (!NAME_RE.test(name)) throw new StoreError("bad_name", `Bad collection name: ${name}`);
  };
  const readList = async (name) => (await adapter.get(colKey(name))) ?? [];
  const collectionNames = async () =>
    (await adapter.keys()).filter((k) => k.startsWith(colPrefix)).map((k) => k.slice(colPrefix.length));
  const readAll = async () => {
    const out = {};
    for (const n of await collectionNames()) out[n] = await readList(n);
    return out;
  };
  const writeAll = async (data) => {
    const keep = new Set(Object.keys(data));
    for (const n of await collectionNames()) if (!keep.has(n)) await adapter.delete(colKey(n));
    for (const [n, list] of Object.entries(data)) await adapter.set(colKey(n), list);
  };
  // Birden cok koleksiyonu atomik yazar. setMany varsa tek islem; yoksa gunluk anahtari + uygula + sil (yarim kalirsa init() tamamlar);
  // hata olursa eski degerler geri yazilir.
  const writeMany = async (entries, olds) => {
    if (typeof adapter.setMany === "function") { await adapter.setMany(entries); return; }
    await adapter.set(txKey, { entries });
    try {
      for (const [k, v] of entries) await adapter.set(k, v);
    } catch (e) {
      try { for (const [k, v] of olds) await adapter.set(k, v); } catch { /* geri yazma da olmadiysa gunluk kalir; init() ilerletir */ }
      throw e;
    }
    await adapter.delete(txKey);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const metaExtra = async () => (await adapter.get(metaKey))?.extra ?? {};
  // Yazmadan once (kilit icinde): baska sekme ayarlari degistirdiyse (para birimi) bu sekmenin eski ayariyla yazilmaz.
  const guardWrite = async () => { if (writeGuard) await writeGuard(await metaExtra()); };

  // Anlik goruntuye geri don (yalniz degisenleri yazar).
  const restore = async (snap) => {
    const keep = new Set(Object.keys(snap.data));
    for (const n of await collectionNames()) if (!keep.has(n)) await adapter.delete(colKey(n));
    for (const [n, list] of Object.entries(snap.data)) {
      if (!same(await readList(n), list)) await adapter.set(colKey(n), list);
    }
    if (snap.meta === undefined) await adapter.delete(metaKey);
    else await adapter.set(metaKey, snap.meta);
  };

  // Tum veriyi tek bir mantiksal adimda degistirir (journal + geri alma).
  // extra: meta altinda tasinan kucuk ayarlar (orn. { currency }); verilmezse mevcut olan korunur. Veriyle ayni adimda yazilir.
  const commit = async (data, completedVersion, extra) => {
    const snap = { data: await readAll(), meta: await adapter.get(metaKey) };
    const keep = extra === undefined ? snap.meta?.extra : extra;
    const withExtra = (m) => (keep === undefined ? m : { ...m, extra: keep });
    try {
      await adapter.set(metaKey, withExtra({ schemaVersion: completedVersion, pending: { schemaVersion, data, extra: keep } }));
      await writeAll(data);
      await adapter.set(metaKey, withExtra({ schemaVersion }));
    } catch (e) {
      try {
        await restore(snap);
      } catch {
        /* geri yazma da olmadiysa journal kalir; sonraki init() yazimi tamamlar */
      }
      throw e;
    }
  };

  const api = {
    prefix,
    schemaVersion,

    init: () =>
      serial(async () => {
        const journal = await adapter.get(txKey);
        if (journal && Array.isArray(journal.entries)) {
          for (const [k, v] of journal.entries) await adapter.set(k, v); // yarim kalan coklu yazma tamamlanir
          await adapter.delete(txKey);
          changed();
        }
        let meta = await adapter.get(metaKey);
        if (meta && meta.pending) {
          // Onceki yazim / goc yarida kesilmis: kayitli veriyi yeniden yaz, gocu tekrarlama.
          if (meta.pending.schemaVersion > schemaVersion) {
            throw new StoreError("newer_schema", "The saved data was created by a newer version of this app.");
          }
          await writeAll(meta.pending.data);
          meta = { schemaVersion: meta.pending.schemaVersion, ...(meta.pending.extra !== undefined ? { extra: meta.pending.extra } : meta.extra !== undefined ? { extra: meta.extra } : {}) };
          await adapter.set(metaKey, meta);
          changed();
        }
        const hasData = (await collectionNames()).length > 0;
        const stored = meta ? meta.schemaVersion : hasData ? 0 : schemaVersion;
        if (stored > schemaVersion) {
          throw new StoreError("newer_schema", "The saved data was created by a newer version of this app.");
        }
        if (stored < schemaVersion) {
          const migrated = normalize(await migrateData(await readAll(), stored, schemaVersion, migrations));
          validateData(migrated);
          await commit(migrated, stored);
          changed();
        } else if (!meta || meta.schemaVersion !== schemaVersion) {
          await adapter.set(metaKey, { schemaVersion, ...(meta?.extra !== undefined ? { extra: meta.extra } : {}) });
        }
      }),

    list: async (name) => {
      noNested();
      checkName(name);
      return serial(() => readList(name));
    },
    get: async (name, id) => {
      noNested();
      checkName(name);
      return serial(async () => (await readList(name)).find((r) => r.id === id));
    },
    count: async (name) => {
      noNested();
      checkName(name);
      return serial(async () => (await readList(name)).length);
    },

    // options.check(count): kilit icinde, yazmadan once cagrilir; atarsa kayit eklenmez
    // (demo siniri gibi "say sonra ekle" kosullari yarisa girmesin).
    add: async (name, fields, { check } = {}) => {
      noNested();
      checkName(name);
      return serial(async () => {
        await guardWrite();
        const list = await readList(name);
        if (check) check(list.length);
        const t = now();
        const rec = writeClean({ ...fields, id: idGen(), createdAt: t, updatedAt: t });
        list.push(rec);
        await adapter.set(colKey(name), list);
        changed();
        return { ...rec };
      });
    },

    update: async (name, id, patch) => {
      noNested();
      checkName(name);
      return serial(async () => {
        await guardWrite();
        const list = await readList(name);
        const i = list.findIndex((r) => r.id === id);
        if (i < 0) throw new StoreError("not_found", "Record not found.");
        const rec = writeClean({ ...list[i], ...patch, id, createdAt: list[i].createdAt, updatedAt: now() });
        list[i] = rec;
        await adapter.set(colKey(name), list);
        changed();
        return { ...rec };
      });
    },

    // Bir koleksiyonu kilit icinde okuyup degistirir (okuma-degistirme-yazma tek adim; sayac gibi isler icin).
    // fn(list) -> { list: yeniKayitlar, result }. Her kaydin metin bir `id` alani olmalidir.
    transact: async (name, fn) => {
      noNested();
      checkName(name);
      return serial(async () => {
        await guardWrite();
        const { list, result } = await fn(structuredClone(await readList(name)));
        const next = normalize(list);
        if (!Array.isArray(next) || !next.every((r) => r && typeof r.id === "string" && r.id)) {
          throw new StoreError("bad_data", "transact: every record needs an id.");
        }
        await adapter.set(colKey(name), next);
        changed();
        return result;
      });
    },

    // Birden cok koleksiyonu TEK kilitte ve TEK atomik yazmada degistirir (spec 3.10). fn(tx) bellek kopyasinda calisir; hata atarsa
    // hicbir koleksiyon (ve sayac) degismez. tx: list / get / add / update / remove / nextNumber. tx.list kayitlari PAYLASIR: degistirme,
    // update kullan. fn calisirken baska depo cagrisi (ya da ic ice transactMany) beklemeden StoreError("nested_tx") atar.
    transactMany: async (names, fn) => {
      noNested();
      const list = [...new Set(names)];
      for (const n of list) checkName(n);
      return serial(async () => {
        await guardWrite();
        const all = [...new Set([...list, SEQUENCES])];
        const lists = {};
        const olds = [];
        for (const n of all) { lists[n] = structuredClone(await readList(n)); olds.push([colKey(n), structuredClone(lists[n])]); }
        const dirty = new Set();
        const own = (n) => { if (!(n in lists) || (n === SEQUENCES && !list.includes(n))) throw new StoreError("bad_name", `Collection not in this transaction: ${n}`); return lists[n]; };
        const tx = {
          list: (n) => own(n).slice(),
          get: (n, id) => own(n).find((r) => r.id === id),
          count: (n) => own(n).length,
          add: (n, fields, { check } = {}) => {
            const l = own(n);
            if (check) check(l.length);
            const t = now();
            const rec = writeClean({ ...fields, id: idGen(), createdAt: t, updatedAt: t });
            l.push(rec); dirty.add(n);
            return { ...rec };
          },
          update: (n, id, patch) => {
            const l = own(n);
            const i = l.findIndex((r) => r.id === id);
            if (i < 0) throw new StoreError("not_found", "Record not found.");
            const rec = writeClean({ ...l[i], ...patch, id, createdAt: l[i].createdAt, updatedAt: now() });
            l[i] = rec; dirty.add(n);
            return { ...rec };
          },
          remove: (n, id) => {
            const l = own(n);
            const i = l.findIndex((r) => r.id === id);
            if (i < 0) return false;
            l.splice(i, 1); dirty.add(n);
            return true;
          },
          // "A-2026-0042": her (onek, yil) cifti ayri sayar; alinan numara geri verilmez. Sayac isle birlikte yazilir.
          nextNumber: (prefix, { year = new Date().getFullYear() } = {}) => {
            const id = `${prefix}-${year}`;
            const seq = lists[SEQUENCES];
            const i = seq.findIndex((r) => r.id === id);
            const last = (i < 0 ? 0 : seq[i].last) + 1;
            const t = now();
            if (i < 0) seq.push({ id, prefix, year, last, createdAt: t, updatedAt: t }); else seq[i] = { ...seq[i], last, updatedAt: t };
            dirty.add(SEQUENCES);
            return formatSerial(prefix, year, last);
          },
        };
        let result;
        inTx = true;
        try { result = await fn(tx); } finally { inTx = false; }
        if (dirty.size) {
          const entries = [...dirty].map((n) => [colKey(n), normalize(lists[n])]);
          await writeMany(entries, olds.filter(([k]) => entries.some(([e]) => e === k)));
          changed();
        }
        return result;
      });
    },

    remove: async (name, id) => {
      noNested();
      checkName(name);
      return serial(async () => {
        await guardWrite();
        const list = await readList(name);
        const next = list.filter((r) => r.id !== id);
        if (next.length === list.length) return false;
        await adapter.set(colKey(name), next);
        changed();
        return true;
      });
    },

    // Tum veri: { koleksiyon: [kayit] }
    exportAll: () => serial(readAll),

    // Tum veriyi degistirir (atomik: hata olursa eski veri aynen kalir). fromVersion eskiyse goc calisir.
    // extra verilirse (orn. { currency }) veriyle AYNI adimda meta'ya yazilir ve para birimi korumasi uygulanmaz (stamp'i bu islem koyar).
    importAll: (data, { schemaVersion: from = schemaVersion, extra } = {}) =>
      serial(async () => {
        if (from > schemaVersion) {
          throw new StoreError("newer_schema", "That data was created by a newer version of this app.");
        }
        if (extra === undefined) await guardWrite();
        validateData(data);
        const migrated = normalize(await migrateData(normalize(data), from, schemaVersion, migrations));
        validateData(migrated);
        const meta = await adapter.get(metaKey);
        await commit(migrated, meta && !meta.pending ? meta.schemaVersion : schemaVersion, extra);
        changed();
      }),

    // Meta'daki kucuk ayarlar ({ currency } gibi). Veriyle birlikte atomik degisir (rewriteAll / importAll extra).
    getExtra: () => serial(metaExtra),
    setExtra: (patch) =>
      serial(async () => {
        const meta = (await adapter.get(metaKey)) ?? { schemaVersion };
        await adapter.set(metaKey, { ...meta, extra: { ...(meta.extra ?? {}), ...patch } });
        changed();
      }),

    // Oku-donustur-yaz TEK kilit ve tek atomik yazma icinde (baska sekme araya giremez). fn(data, extra) -> { data, extra? } ya da
    // null (hicbir sey yazma). Doner: yazildiysa true. Para birimi yeniden olcekleme gibi tum veriyi etkileyen isler icindir.
    rewriteAll: (fn) =>
      serial(async () => {
        const data = await readAll();
        const meta = await adapter.get(metaKey);
        const out = await fn(structuredClone(data), { ...(meta?.extra ?? {}) });
        if (!out) return false;
        validateData(out.data);
        const next = normalize(out.data);
        await commit(next, meta && !meta.pending ? meta.schemaVersion : schemaVersion, out.extra);
        changed();
        return true;
      }),

    // Tum veriyi siler (atomik).
    clearAll: () =>
      serial(async () => {
        await guardWrite();
        await commit({}, schemaVersion);
        changed();
      }),
  };
  return api;
}

let counter = 0;
export const newRecordId = () => defaultId();
function defaultId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  counter += 1;
  return `id-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
