// Sekmeler arasi degisiklik bildirimi. BroadcastChannel varsa onu, yoksa `storage` olayini
// kullanir (yalniz bir ping anahtari yazar; veri tasimaz). Kendi sekmesine bildirim gitmez.
export function createSync({ name, env = globalThis } = {}) {
  const subs = new Set();
  const fire = () => { for (const fn of [...subs]) fn(); };

  if (typeof env.BroadcastChannel === "function") {
    const ch = new env.BroadcastChannel(`${name}:sync`);
    ch.onmessage = fire;
    return {
      kind: "broadcast",
      notify: () => ch.postMessage("changed"),
      subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
      close: () => ch.close(),
    };
  }

  const key = `${name}:sync-ping`;
  const onStorage = (e) => { if (e && e.key === key) fire(); };
  if (env.addEventListener) env.addEventListener("storage", onStorage);
  return {
    kind: "storage",
    notify: () => {
      try { env.localStorage.setItem(key, `${Date.now()}-${Math.random()}`); } catch { /* bildirim yoksa sekme kendi haline calisir */ }
    },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    close: () => { if (env.removeEventListener) env.removeEventListener("storage", onStorage); },
  };
}
