// Per-episode version history. Kept in its own file per project (novelws-snaps-<pid>.json) so the
// main project file stays small and fast to save.
//   auto    — taken automatically before the first edit of an episode each writing day
//   manual  — taken by the writer (camera button), optional label
//   restore — the text that was replaced when an older version was restored
import { LOG } from './store.js';
import { readJson, writeJson, deleteFile } from './storage.js';
import { dayKey } from './stats.js';
import { uid } from './project.js';
import { countWords } from './wordcount.js';

export const snapFile = (pid) => `novelws-snaps-${pid}.json`;

const LIMITS = { auto: 14, manual: 50, restore: 10 };

let pid = '';
/** @type {{episodes: Record<string, {id:string, ts:number, day:string, kind:string, label:string, text:string, words:number}[]>}} */
let data = { episodes: {} };
let loading = null;
let saveTimer = null;
let dirty = false;
/** auto snapshots requested before the file finished loading */
const pending = [];

export async function loadSnapshots(projectId) {
    await flushSnapshots();
    pid = projectId;
    data = { episodes: {} };
    loading = (async () => {
        try {
            const d = await readJson(snapFile(projectId), { episodes: {} });
            if (pid !== projectId) return;
            data = d && typeof d === 'object' && d.episodes ? d : { episodes: {} };
        } catch (e) {
            console.error(LOG, 'โหลด snapshot ไม่สำเร็จ:', e);
        }
        for (const p of pending.splice(0)) if (p.pid === pid) add(p.eid, p.text, p.kind, p.label, p.ts);
    })();
    await loading;
    loading = null;
}

export const isLoaded = () => !loading && Boolean(pid);

export function list(eid) {
    return (data.episodes[eid] || []).slice().sort((a, b) => b.ts - a.ts);
}

export const get = (eid, sid) => (data.episodes[eid] || []).find(s => s.id === sid) || null;

function add(eid, text, kind, label = '', ts = Date.now()) {
    const arr = (data.episodes[eid] ||= []);
    const snap = { id: uid(), ts, day: dayKey(new Date(ts)), kind, label, text, words: countWords(text) };
    arr.push(snap);
    // Prune oldest of the same kind beyond its limit.
    const same = arr.filter(s => s.kind === kind).sort((a, b) => a.ts - b.ts);
    const extra = same.length - (LIMITS[kind] || 20);
    if (extra > 0) {
        const drop = new Set(same.slice(0, extra).map(s => s.id));
        data.episodes[eid] = arr.filter(s => !drop.has(s.id));
    }
    scheduleSave();
    return snap;
}

/** Called just before the text of an episode changes. Takes at most one auto snapshot per day. */
const seenToday = new Set();

export function beforeEdit(projectId, eid, currentText) {
    if (projectId !== pid) return;
    const today = dayKey();
    // Only the state *before the first edit* of this session/day matters.
    const seenKey = `${projectId}:${eid}:${today}`;
    if (seenToday.has(seenKey)) return;
    seenToday.add(seenKey);
    if (!currentText || !currentText.trim()) return;
    if (loading) {
        if (!pending.some(p => p.eid === eid)) pending.push({ pid: projectId, eid, text: currentText, kind: 'auto', label: '', ts: Date.now() });
        return;
    }
    const arr = data.episodes[eid] || [];
    if (arr.some(s => s.kind === 'auto' && s.day === today)) return;
    // Nothing changed since the latest snapshot of any kind → no need for a new one.
    const latest = arr.slice().sort((a, b) => b.ts - a.ts)[0];
    if (latest && latest.text === currentText && latest.day === today) return;
    add(eid, currentText, 'auto');
}

export function takeManual(eid, text, label) {
    return add(eid, text, 'manual', label || '');
}

export function takeBeforeRestore(eid, text) {
    if (!text.trim()) return null;
    return add(eid, text, 'restore', 'ก่อนกู้คืน');
}

export function remove(eid, sid) {
    data.episodes[eid] = (data.episodes[eid] || []).filter(s => s.id !== sid);
    scheduleSave();
}

export function removeEpisode(eid) {
    if (!data.episodes[eid]) return;
    delete data.episodes[eid];
    scheduleSave();
}

export async function deleteProjectSnapshots(projectId) {
    if (projectId === pid) { clearTimeout(saveTimer); dirty = false; data = { episodes: {} }; }
    await deleteFile(snapFile(projectId));
}

function scheduleSave() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSnapshots, 1500);
}

export async function flushSnapshots() {
    clearTimeout(saveTimer);
    if (!dirty || !pid) return;
    dirty = false;
    try {
        await writeJson(snapFile(pid), data);
    } catch (e) {
        dirty = true;
        console.error(LOG, 'บันทึก snapshot ไม่สำเร็จ:', e);
        toastr.warning('บันทึกประวัติเวอร์ชันไม่สำเร็จ', 'Novel Workspace', { preventDuplicates: true });
    }
}
