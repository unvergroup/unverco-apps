// Cihazda kalici veri: kucuk anahtar-koleksiyon deposu.
// Depolama arayuzu (adapter) disaridan verilir: { get, set, delete, keys } (hepsi async).
// Koleksiyon = kayit dizisi; adapter'da tek anahtar altinda saklanir.

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

// transact islevi bu sureden uzun surerse hata verilir ve kilit acilir (ic ice depo cagrisinda sonsuz beklemeyi onler).
export const TRANSACT_TIMEOUT_MS = 10000;

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

// ---- Adapterler -----------------------------------------------------------

export function createMemoryAdapter() {
  const map = new Map();
  return {
    kind: "memory",
    async get(k) { return map.has(k) ? structuredClone(map.get(k)) : undefined; },
    async set(k, v) { map.set(k, structuredClone(v)); },
    async delete(k) { map.delete(k); },
    async keys() { return [...map.keys()]; },
  };
}

export function createLocalStorageAdapter(storage) {
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
      return createLocalStorageAdapter(ls);
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
} = {}) {
  if (!adapter) throw new StoreError("no_adapter", "A storage adapter is required.");
  const metaKey = `${prefix}:meta`;
  const colKey = (name) => `${prefix}:c:${name}`;
  const colPrefix = `${prefix}:c:`;
  const lockName = `${prefix}:write`;

  // Islemler sirayla yurusun (es zamanli ekleme kaybi olmasin); varsa sekmeler arasi kilit.
  // transact calisirken (tx dolu) kilit tutuluyor: okumalar kilitsiz calisir (transact henuz yazmadigi icin kayitli veriyi
  // gorurler), transact islevinin ayni senkron adiminda cagrilan yazma islemleri "reentrant" hatasi verir. Islev bir await'ten
  // sonra yazma cagirirsa bunu ayirt etmenin yolu yok; transact zaman asimi (TRANSACT_TIMEOUT_MS) kilidi yine de birakir.
  let chain = Promise.resolve();
  let tx = null; // { sync: boolean } yalniz transact islevi calisirken
  const serial = (fn, { read = false } = {}) => {
    if (tx) {
      if (read) return Promise.resolve().then(fn);
      if (tx.sync) return Promise.reject(new StoreError("reentrant", "A store write was called inside transact. Use the list passed to transact instead."));
    }
    const run = () => (locks ? locks.request(lockName, { mode: "exclusive" }, fn) : fn());
    const p = chain.then(run);
    chain = p.catch(() => {});
    return p;
  };
  // Gecici bellege dusme uyarisi: store.volatile durum bayragi, store.onVolatile(fn) olay. init() bittiginde bir kez bildirilir;
  // sonradan abone olan da (bir kez) haberdar edilir.
  const volatile = adapter.volatile === true;
  let volatileFired = false;
  const volatileListeners = new Set();
  const fireVolatile = (fn) => {
    try { fn(); } catch { /* dinleyici hatasi depoyu bozmaz */ }
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
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
  const commit = async (data, completedVersion) => {
    const snap = { data: await readAll(), meta: await adapter.get(metaKey) };
    try {
      await adapter.set(metaKey, { schemaVersion: completedVersion, pending: { schemaVersion, data } });
      await writeAll(data);
      await adapter.set(metaKey, { schemaVersion });
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

    // Depolama gecici bellege dustuyse true (veri sayfa kapaninca gider); arayuz uyari gostermeli.
    volatile,
    onVolatile(fn) {
      if (typeof fn !== "function") return () => {};
      volatileListeners.add(fn);
      if (volatile && volatileFired) queueMicrotask(() => fireVolatile(fn));
      return () => volatileListeners.delete(fn);
    },

    init: async () => {
      await serial(async () => {
        let meta = await adapter.get(metaKey);
        if (meta && meta.pending) {
          // Onceki yazim / goc yarida kesilmis: kayitli veriyi yeniden yaz, gocu tekrarlama.
          if (meta.pending.schemaVersion > schemaVersion) {
            throw new StoreError("newer_schema", "The saved data was created by a newer version of this app.");
          }
          await writeAll(meta.pending.data);
          meta = { schemaVersion: meta.pending.schemaVersion };
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
          await adapter.set(metaKey, { schemaVersion });
        }
      });
      if (volatile && !volatileFired) {
        volatileFired = true;
        for (const fn of [...volatileListeners]) fireVolatile(fn);
      }
    },

    list: async (name) => {
      checkName(name);
      return serial(() => readList(name), { read: true });
    },
    get: async (name, id) => {
      checkName(name);
      return serial(async () => (await readList(name)).find((r) => r.id === id), { read: true });
    },
    count: async (name) => {
      checkName(name);
      return serial(async () => (await readList(name)).length, { read: true });
    },

    // options.check(count): kilit icinde, yazmadan once cagrilir; atarsa kayit eklenmez
    // (demo siniri gibi "say sonra ekle" kosullari yarisa girmesin).
    add: async (name, fields, { check } = {}) => {
      checkName(name);
      return serial(async () => {
        const list = await readList(name);
        if (check) check(list.length);
        const t = now();
        const rec = normalize({ ...fields, id: idGen(), createdAt: t, updatedAt: t });
        list.push(rec);
        await adapter.set(colKey(name), list);
        changed();
        return { ...rec };
      });
    },

    update: async (name, id, patch) => {
      checkName(name);
      return serial(async () => {
        const list = await readList(name);
        const i = list.findIndex((r) => r.id === id);
        if (i < 0) throw new StoreError("not_found", "Record not found.");
        const rec = normalize({ ...list[i], ...patch, id, createdAt: list[i].createdAt, updatedAt: now() });
        list[i] = rec;
        await adapter.set(colKey(name), list);
        changed();
        return { ...rec };
      });
    },

    // Bir koleksiyonu kilit icinde okuyup degistirir (okuma-degistirme-yazma tek adim; sayac gibi isler icin).
    // fn(list) -> { list: yeniKayitlar, result }. Her kaydin metin bir `id` alani olmalidir.
    // fn icinde baska depo cagrisi: okumalar (list / get / count) guvenle calisir; senkron adimda yazma "reentrant" hatasi verir;
    // fn timeoutMs (varsayilan TRANSACT_TIMEOUT_MS) icinde bitmezse "tx_timeout" hatasi verilir, hicbir sey yazilmaz, kilit acilir.
    transact: async (name, fn, { timeoutMs = TRANSACT_TIMEOUT_MS } = {}) => {
      checkName(name);
      return serial(async () => {
        const start = structuredClone(await readList(name));
        tx = { sync: true };
        let timer;
        let out;
        try {
          const running = Promise.resolve(fn(start));
          tx.sync = false;
          out = await Promise.race([
            running,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new StoreError("tx_timeout", "transact took too long; nothing was saved. Do not wait for other store writes inside transact.")), timeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(timer);
          tx = null;
        }
        const { list, result } = out;
        const next = normalize(list);
        if (!Array.isArray(next) || !next.every((r) => r && typeof r.id === "string" && r.id)) {
          throw new StoreError("bad_data", "transact: every record needs an id.");
        }
        await adapter.set(colKey(name), next);
        changed();
        return result;
      });
    },

    remove: async (name, id) => {
      checkName(name);
      return serial(async () => {
        const list = await readList(name);
        const next = list.filter((r) => r.id !== id);
        if (next.length === list.length) return false;
        await adapter.set(colKey(name), next);
        changed();
        return true;
      });
    },

    // Tum veri: { koleksiyon: [kayit] }
    exportAll: () => serial(readAll, { read: true }),

    // Tum veriyi degistirir (atomik: hata olursa eski veri aynen kalir). fromVersion eskiyse goc calisir.
    // ifUnchanged (exportAll sonucu): kilit icinde kayitli veri hala buna esitse yazar, degilse HICBIR sey yazmaz ve false doner
    // (okuma-onar-yaz sirasinda baska sekmenin yazdigi ezilmesin). Yazdiysa true doner.
    importAll: (data, { schemaVersion: from = schemaVersion, ifUnchanged } = {}) =>
      serial(async () => {
        if (from > schemaVersion) {
          throw new StoreError("newer_schema", "That data was created by a newer version of this app.");
        }
        validateData(data);
        if (ifUnchanged !== undefined && !same(await readAll(), ifUnchanged)) return false;
        const migrated = normalize(await migrateData(normalize(data), from, schemaVersion, migrations));
        validateData(migrated);
        const meta = await adapter.get(metaKey);
        await commit(migrated, meta && !meta.pending ? meta.schemaVersion : schemaVersion);
        changed();
        return true;
      }),

    // Tum veriyi siler (atomik).
    clearAll: () =>
      serial(async () => {
        await commit({}, schemaVersion);
        changed();
      }),
  };
  return api;
}

let counter = 0;
function defaultId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  counter += 1;
  return `id-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
