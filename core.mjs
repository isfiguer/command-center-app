// Isomorphic data core shared by the desktop extension (Node) and the phone PWA (browser).
// State changes are expressed as deterministic operations so devices can merge op logs.

export const FILE_NAME = "command-center.json";
const COMPACT_AFTER_DAYS = 21;

export const rid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 10);

export function today(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function defaults() {
    const r = (id, title, emoji, part, essential = false, time = null) => ({ id, title, emoji, part, essential, time, active: true });
    return {
        version: 1,
        settings: { name: "", lowStim: false, textScale: 1 },
        routines: [
            r("meds", "Take meds / vitamins", "💊", "morning", true, "09:00"),
            r("water", "Drink a glass of water", "💧", "anytime", true),
            r("eat", "Eat something nourishing", "🍽️", "anytime", true, "12:30"),
            r("calendar", "Peek at today's calendar", "📅", "morning", false, "09:30"),
            r("move", "Move your body for 5 minutes", "🚶", "afternoon"),
            r("tidy", "5-minute tidy reset", "🧺", "evening"),
            r("setout", "Set out things for tomorrow", "🎒", "evening", false, "20:00"),
            r("winddown", "Start winding down", "🌙", "evening", true, "22:00"),
        ],
        checks: {}, skips: {}, checkins: {}, tasks: [], interests: [], growth: [], inbox: [], wins: [],
    };
}

export const clone = (x) => JSON.parse(JSON.stringify(x));
export const withDefaults = (d) => ({ ...defaults(), ...(d || {}) });

const KIND = [
    "Nice. That counts.",
    "Done is done — and that's enough.",
    "Look at you, doing a thing!",
    "Small steps are real steps.",
    "Your brain did a hard thing there. 💛",
    "One less thing to hold in your head.",
];
const kind = () => KIND[Math.floor(Math.random() * KIND.length)];

function find(list, itemId, label) {
    const item = list.find((x) => x.id === itemId);
    if (!item) throw new Error(`Couldn't find that ${label} (id ${itemId}).`);
    return item;
}
function pick(obj, keys) {
    const out = {};
    for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
    return out;
}

/**
 * Turn a user intent into a deterministic, replayable operation:
 * resolves date/time, generates ids for new records, and converts toggles into explicit values.
 */
export function normalize(d, op, payload = {}) {
    const p = { ...payload };
    p.at = p.at || new Date().toISOString();
    if ((op === "addTask" || op === "updateTask") && "date" in payload) { p.taskDate = payload.date || null; delete p.date; }
    p.date = p.date || today();
    if (/^add(Routine|Task|Interest|Growth)$|^dump$|^dumpToTask$/.test(op)) p.newId = p.newId || rid();
    if (op === "toggleRoutine" && p.done === undefined) p.done = !(d.checks[p.date] || {})[p.id];
    if (op === "toggleTask" && p.done === undefined) { const t = d.tasks.find((x) => x.id === p.id); p.done = t ? !t.done : true; }
    if (op === "toggleStep" && p.done === undefined) { const s = d.tasks.find((x) => x.id === p.id)?.steps[p.index]; p.done = s ? !s.done : true; }
    return { uid: rid() + rid(), at: p.at, op, p };
}

function addWin(d, text, at) {
    d.wins.unshift({ date: today(new Date(at)), at, text });
    d.wins = d.wins.slice(0, 500);
}

/** Apply one normalized operation to state `d` (mutates). Returns a kind message or null. */
export function applyOp(d, { op, p }) {
    const date = p.date;
    const at = p.at;
    let message = null;
    switch (op) {
        case "settings":
            Object.assign(d.settings, pick(p, ["name", "lowStim", "textScale"]));
            break;
        case "checkin":
            d.checkins[date] = { ...(d.checkins[date] || {}), ...pick(p, ["energy", "mood", "note"]) };
            message = p.energy === "low"
                ? "Low battery day. Essentials only — everything else can wait, and that's okay."
                : "Thanks for checking in with yourself.";
            break;
        case "toggleRoutine": {
            const r = find(d.routines, p.id, "reminder");
            d.checks[date] = d.checks[date] || {};
            if (!p.done) delete d.checks[date][r.id];
            else {
                d.checks[date][r.id] = at;
                if (d.skips[date]) delete d.skips[date][r.id];
                message = kind();
            }
            break;
        }
        case "skipRoutine": {
            const r = find(d.routines, p.id, "reminder");
            d.skips[date] = d.skips[date] || {};
            d.skips[date][r.id] = p.until || "day";
            message = p.until && p.until !== "day" ? "Okay, I'll check back a little later." : "Skipping is allowed. See you tomorrow.";
            break;
        }
        case "addRoutine":
            if (!p.title) throw new Error("A reminder needs a title.");
            d.routines.push({ id: p.newId, title: p.title, emoji: p.emoji || "✨", part: p.part || "anytime", essential: !!p.essential, time: p.time || null, active: true });
            break;
        case "updateRoutine":
            Object.assign(find(d.routines, p.id, "reminder"), pick(p, ["title", "emoji", "part", "essential", "time", "active"]));
            break;
        case "deleteRoutine":
            d.routines = d.routines.filter((x) => x.id !== p.id);
            break;

        case "addTask":
            if (!p.title) throw new Error("A task needs a title.");
            d.tasks.push({ id: p.newId, title: p.title, date: p.taskDate !== undefined ? p.taskDate : (p.dueDate || null), done: false, steps: (p.steps || []).map((t) => ({ t, done: false })), createdAt: at });
            break;
        case "toggleTask": {
            const t = find(d.tasks, p.id, "task");
            t.done = !!p.done;
            t.doneAt = t.done ? at : null;
            if (t.done) { addWin(d, `Finished: ${t.title}`, at); message = kind(); }
            break;
        }
        case "addStep":
            find(d.tasks, p.id, "task").steps.push({ t: p.text, done: false });
            break;
        case "toggleStep": {
            const s = find(d.tasks, p.id, "task").steps[p.index];
            if (s) { s.done = !!p.done; if (s.done) message = "Tiny step, real progress."; }
            break;
        }
        case "updateTask": {
            const t = find(d.tasks, p.id, "task");
            if (p.title !== undefined) t.title = p.title;
            if (p.taskDate !== undefined) t.date = p.taskDate;
            break;
        }
        case "deleteTask":
            d.tasks = d.tasks.filter((x) => x.id !== p.id);
            break;

        case "addInterest":
            if (!p.name) throw new Error("An interest needs a name.");
            d.interests.push({ id: p.newId, name: p.name, emoji: p.emoji || "🌱", status: p.status || "active", notes: p.notes || "", nextStep: p.nextStep || "", sessions: [], createdAt: at });
            break;
        case "updateInterest":
            Object.assign(find(d.interests, p.id, "interest"), pick(p, ["name", "emoji", "status", "notes", "nextStep"]));
            break;
        case "logInterest": {
            const i = find(d.interests, p.id, "interest");
            i.sessions.unshift({ date, minutes: Number(p.minutes) || 0, note: p.note || "" });
            addWin(d, `Spent time on ${i.emoji} ${i.name}${p.minutes ? ` (${p.minutes} min)` : ""}`, at);
            message = `Joy logged for ${i.name}. That matters too.`;
            break;
        }
        case "deleteInterest":
            d.interests = d.interests.filter((x) => x.id !== p.id);
            break;

        case "addGrowth":
            if (!p.title) throw new Error("A growth item needs a title.");
            d.growth.push({ id: p.newId, title: p.title, type: p.type || "course", link: p.link || "", progress: Number(p.progress) || 0, status: p.status || "exploring", nextStep: p.nextStep || "", notes: p.notes || "", targetDate: p.targetDate || "", createdAt: at });
            break;
        case "updateGrowth": {
            const g = find(d.growth, p.id, "growth item");
            const wasDone = g.status === "done";
            Object.assign(g, pick(p, ["title", "type", "link", "progress", "status", "nextStep", "notes", "targetDate"]));
            if (p.progress !== undefined) g.progress = Math.max(0, Math.min(100, Number(p.progress) || 0));
            if (g.status === "done" && !wasDone) { g.progress = 100; addWin(d, `Completed: ${g.title}`, at); message = "You finished it! 🎉"; }
            break;
        }
        case "deleteGrowth":
            d.growth = d.growth.filter((x) => x.id !== p.id);
            break;

        case "dump":
            if (!p.text) throw new Error("Nothing to capture.");
            d.inbox.unshift({ id: p.newId, text: p.text, createdAt: at });
            message = "Captured. It's safe here — you can let it go for now.";
            break;
        case "deleteDump":
            d.inbox = d.inbox.filter((x) => x.id !== p.id);
            break;
        case "dumpToTask": {
            const it = find(d.inbox, p.id, "note");
            d.inbox = d.inbox.filter((x) => x.id !== p.id);
            d.tasks.push({ id: p.newId, title: it.text, date: null, done: false, steps: [], createdAt: at });
            break;
        }
        case "addWin":
            if (!p.text) throw new Error("A win needs a few words.");
            addWin(d, p.text, at);
            message = "Win saved. 🌟";
            break;
        default:
            throw new Error(`Unknown operation: ${op}`);
    }
    return message;
}

/** Validate + apply interactively: throws on bad input, returns { entry, message }. */
export function perform(d, op, payload) {
    const entry = normalize(d, op, payload);
    const trial = clone(d);
    applyOp(trial, entry); // throws on invalid input without touching d
    const message = applyOp(d, entry);
    return { entry, message };
}

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);

export function replay(base, ops) {
    const d = withDefaults(clone(base));
    for (const e of [...ops].sort(byTime)) {
        try { applyOp(d, e); } catch { /* op targets something deleted elsewhere — skip */ }
    }
    return d;
}

export function mergeOps(...lists) {
    const seen = new Map();
    for (const list of lists) for (const e of list || []) if (e && e.uid && !seen.has(e.uid)) seen.set(e.uid, e);
    return [...seen.values()].sort(byTime);
}

/** Fold ops older than the compaction window into the base snapshot to keep the sync file small. */
export function compact(doc) {
    const cutoff = new Date(Date.now() - COMPACT_AFTER_DAYS * 86400000).toISOString();
    const old = doc.ops.filter((e) => e.at < cutoff);
    if (!old.length) return doc;
    return { ...doc, base: replay(doc.base, old), baseAt: cutoff, ops: doc.ops.filter((e) => e.at >= cutoff) };
}

/**
 * Pure sync step. remote = parsed gist doc (or null), pending = local unpushed ops, localState used to seed a brand-new doc.
 * Returns { doc, state, needsPush }.
 */
export function reconcile(remote, pending, localState) {
    const base = remote?.base || localState;
    const ops = mergeOps(remote?.ops, pending);
    const missing = pending.some((e) => !(remote?.ops || []).some((r) => r.uid === e.uid));
    let doc = { app: "command-center", version: 2, base, baseAt: remote?.baseAt || null, ops, updatedAt: new Date().toISOString() };
    if (!remote || missing) doc = compact(doc);
    return { doc, state: replay(doc.base, doc.ops), needsPush: !remote || missing };
}

/** Plain-language snapshot for the agent. */
export function summary(d, date = today()) {
    const checks = d.checks[date] || {};
    const skips = d.skips[date] || {};
    const active = d.routines.filter((r) => r.active);
    return {
        date,
        checkin: d.checkins[date] || null,
        reminders: active.map((r) => ({ id: r.id, title: r.title, time: r.time, part: r.part, essential: r.essential, done: !!checks[r.id], skipped: !!skips[r.id] })),
        tasks: d.tasks.filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, date: t.date, steps: t.steps })),
        interests: d.interests.map((i) => ({ id: i.id, name: i.name, status: i.status, nextStep: i.nextStep, lastTouched: i.sessions[0]?.date || null })),
        growth: d.growth.map((g) => ({ id: g.id, title: g.title, type: g.type, status: g.status, progress: g.progress, nextStep: g.nextStep, targetDate: g.targetDate })),
        inbox: d.inbox.map((x) => ({ id: x.id, text: x.text })),
        recentWins: d.wins.slice(0, 10),
        daysShowedUp: daysShowedUp(d),
        tone: "Be kind and non-judgmental. Never shame missed items; frame gaps as rest.",
    };
}

export function daysShowedUp(d) {
    return new Set([...Object.keys(d.checks).filter((k) => Object.keys(d.checks[k]).length), ...Object.keys(d.checkins)]).size;
}

/* ---------- GitHub Gist transport (fetch-based; works in Node 18+ and browsers) ---------- */
const GH = "https://api.github.com";
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

async function ghFail(res, what) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch {}
    const hint = res.status === 401 ? " (token invalid or expired)" : res.status === 404 ? " (gist not found, or token can't see it)" : res.status === 403 ? " (token lacks Gists permission or rate-limited)" : "";
    throw new Error(`${what} failed: ${res.status}${hint}${detail ? " — " + detail : ""}`);
}

export async function gistRead(token, gistId) {
    const res = await fetch(`${GH}/gists/${gistId}`, { headers: ghHeaders(token), cache: "no-store" });
    if (!res.ok) await ghFail(res, "Reading sync gist");
    const g = await res.json();
    const f = g.files?.[FILE_NAME];
    if (!f) return null;
    let content = f.content;
    if (f.truncated) content = await (await fetch(f.raw_url, { cache: "no-store" })).text();
    try { return JSON.parse(content); } catch { return null; }
}

export async function gistWrite(token, gistId, doc) {
    const res = await fetch(`${GH}/gists/${gistId}`, { method: "PATCH", headers: { ...ghHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ files: { [FILE_NAME]: { content: JSON.stringify(doc) } } }) });
    if (!res.ok) await ghFail(res, "Saving sync gist");
}

export async function gistCreate(token, doc) {
    const res = await fetch(`${GH}/gists`, { method: "POST", headers: { ...ghHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ public: false, description: "💛 Command Center sync (personal, private)", files: { [FILE_NAME]: { content: JSON.stringify(doc) } } }) });
    if (!res.ok) await ghFail(res, "Creating sync gist");
    return (await res.json()).id;
}

/** Full sync round: pull, merge, push if needed, verify our ops landed (retry once on a write race). */
export async function syncRound(token, gistId, pending, localState) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await gistRead(token, gistId);
        const { doc, state, needsPush } = reconcile(remote, pending, localState);
        if (!needsPush) return { state, doc };
        await gistWrite(token, gistId, doc);
        const check = await gistRead(token, gistId);
        const ids = new Set((check?.ops || []).map((e) => e.uid));
        const compactedAway = (e) => check?.baseAt && e.at < check.baseAt;
        if (pending.every((e) => ids.has(e.uid) || compactedAway(e))) return { state: replay(check.base, check.ops), doc: check };
    }
    throw new Error("Sync collided with another device a few times — will retry shortly.");
}
