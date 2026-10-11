// Daily writing tracker.
// Counts NET words added per day: for every episode touched that day we remember its word count
// at the first edit of the day (b = baseline) and its latest count (c). Day total = Σ(c − b).
// Pasting a big block still counts (it is net growth), but moving text between episodes in the
// same day cancels out, and deleting text can make a day negative (shown as 0, stored as is).
import { getSetting, LOG } from './store.js';
import { readJson, writeJson, STATS_FILE } from './storage.js';

/** @type {{ days: Record<string, Record<string, Record<string, {b:number,c:number}>>> }} */
let stats = { days: {} };
let loaded = false;
let saveTimer = null;
let dirty = false;

export async function loadStats() {
    try {
        const data = await readJson(STATS_FILE, { days: {} });
        stats = data && typeof data === 'object' && data.days ? data : { days: {} };
    } catch (e) {
        console.error(LOG, e);
        toastr.error(String(e.message || e), 'Novel Workspace');
        stats = { days: {} };
    }
    loaded = true;
}

const pad = (n) => String(n).padStart(2, '0');

/** Date key for "writing day", honouring the day-start hour. */
export function dayKey(date = new Date()) {
    const shifted = new Date(date.getTime() - (Number(getSetting('dayStartHour')) || 0) * 3600_000);
    return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

function keyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
}

function addDays(key, delta) {
    const d = keyToDate(key);
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Record a change in an episode's word count.
 * @param {string} pid project id
 * @param {string} eid episode id
 * @param {number} before word count before this edit
 * @param {number} after word count after this edit
 */
export function recordWords(pid, eid, before, after) {
    if (!loaded || before === after) return;
    const key = dayKey();
    const day = (stats.days[key] ||= {});
    const proj = (day[pid] ||= {});
    if (!proj[eid]) proj[eid] = { b: before, c: after };
    else proj[eid].c = after;
    scheduleSave();
}

/** Drops an episode's entries everywhere — used when the episode is deleted on the same day. */
export function recordEpisodeDeleted(pid, eid, wordsAtDelete) {
    recordWords(pid, eid, wordsAtDelete, 0);
}

export function forgetProject(pid) {
    for (const day of Object.values(stats.days)) delete day[pid];
    scheduleSave();
}

function scheduleSave() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushStats, 3000);
}

export async function flushStats() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    try {
        await writeJson(STATS_FILE, stats);
    } catch (e) {
        dirty = true;
        console.error(LOG, 'บันทึกสถิติไม่สำเร็จ:', e);
    }
}

/** Net words for one day. `pid` = null → all projects. */
export function dayTotal(key, pid = null) {
    const day = stats.days[key];
    if (!day) return 0;
    let sum = 0;
    for (const [p, eps] of Object.entries(day)) {
        if (pid && p !== pid) continue;
        for (const e of Object.values(eps)) sum += (e.c - e.b);
    }
    return sum;
}

/** @returns {{eid:string, delta:number}[]} today's per-episode net words for a project */
export function dayByEpisode(key, pid) {
    const eps = stats.days[key]?.[pid] || {};
    return Object.entries(eps)
        .map(([eid, e]) => ({ eid, delta: e.c - e.b }))
        .filter(x => x.delta !== 0)
        .sort((a, b) => b.delta - a.delta);
}

/** Last n days, oldest first: [{key, words}] (across all projects unless pid given). */
export function lastDays(n, pid = null) {
    const today = dayKey();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
        const key = addDays(today, -i);
        out.push({ key, words: Math.max(0, dayTotal(key, pid)) });
    }
    return out;
}

/** Consecutive days reaching the goal, ending today (or yesterday if today is not done yet). */
export function streak(goal, pid = null) {
    goal = Math.max(1, Number(goal) || 1);
    let key = dayKey();
    let n = 0;
    if (dayTotal(key, pid) >= goal) n++;
    key = addDays(key, -1);
    while (dayTotal(key, pid) >= goal) {
        n++;
        key = addDays(key, -1);
        if (n > 3650) break;
    }
    return n;
}

export function bestDay(pid = null) {
    let best = { key: '', words: 0 };
    for (const key of Object.keys(stats.days)) {
        const w = dayTotal(key, pid);
        if (w > best.words) best = { key, words: w };
    }
    return best;
}
