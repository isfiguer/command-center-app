// Phone transport for the Command Center UI: local-first storage + private-gist sync.
(() => {
  const K = { state: "cc.state", pending: "cc.pending", cfg: "cc.sync" };
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  let core, state, pending, cfg, syncing = null, listener = null;

  const ready = import("./core.mjs").then((m) => {
    core = m;
    state = m.withDefaults(read(K.state, null));
    pending = read(K.pending, []);
    cfg = read(K.cfg, {});
    const g = /gist=([0-9a-f]+)/i.exec(location.hash);
    if (g) { cfg.gistId = g[1]; write(K.cfg, cfg); history.replaceState(null, "", location.pathname); }
  });

  const save = () => { write(K.state, state); write(K.pending, pending); write(K.cfg, cfg); };
  const status = () => ({ mode: "phone", enabled: !!(cfg.gistId && cfg.token), gistId: cfg.gistId || null, hasToken: !!cfg.token, pending: pending.length, lastSync: cfg.lastSync || null, lastError: cfg.lastError || null });
  const view = () => ({ ...state, daysShowedUp: core.daysShowedUp(state), sync: status() });

  async function sync() {
    if (!cfg.gistId || !cfg.token || !navigator.onLine) return false;
    if (syncing) return syncing;
    syncing = (async () => {
      const sent = pending.slice();
      try {
        const { state: merged } = await core.syncRound(cfg.token, cfg.gistId, sent, state);
        const later = pending.slice(sent.length);
        for (const e of later) { try { core.applyOp(merged, e); } catch {} }
        state = core.withDefaults(merged); pending = later;
        cfg.lastSync = new Date().toISOString(); cfg.lastError = null;
        save(); return true;
      } catch (e) {
        cfg.lastError = e.message; save(); return false;
      } finally { syncing = null; }
    })();
    return syncing;
  }
  let t = null;
  const soon = () => { clearTimeout(t); t = setTimeout(async () => { if (await sync()) listener?.(); }, 1500); };

  window.CC_LOCAL = true;
  window.CC_API = {
    async state() { await ready; return view(); },
    async op(name, payload) {
      await ready;
      const { entry, message } = core.perform(state, name, payload);
      pending.push(entry); save(); soon();
      return { message, state: view() };
    },
    async sync({ action, gistId, token }) {
      await ready;
      if (action === "disable") { cfg = {}; save(); return { message: "Disconnected. Everything stays on this phone.", state: view() }; }
      if (action === "enable") {
        if (gistId) cfg.gistId = gistId.trim();
        if (token) cfg.token = token.trim();
        if (!cfg.gistId) throw new Error("I need the Sync ID — open the link from your desktop's Settings → Phone app.");
        if (!cfg.token) throw new Error("I need a GitHub token to reach your private sync file.");
        cfg.lastError = null; save();
      }
      const ok = await sync();
      return { message: ok ? "Synced with your desktop. ☁️" : `Sync didn't work: ${cfg.lastError || "you look offline"}. Your data is safe here.`, state: view() };
    },
    subscribe(fn) {
      listener = fn;
      const tick = async () => { if (document.visibilityState === "visible" && await sync()) fn(); };
      ready.then(tick);
      document.addEventListener("visibilitychange", tick);
      addEventListener("online", tick);
      setInterval(tick, 60000);
    },
  };

  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
