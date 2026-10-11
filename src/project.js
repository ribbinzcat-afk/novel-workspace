// Project model + persistence. One JSON file per project, plus a small index file.
import { LOG, getSetting, setSetting } from './store.js';
import {
    readJson, writeJson, deleteFile, INDEX_FILE, projectFile,
    saveDraft, loadDraft, clearDraft,
} from './storage.js';
import { countWords } from './wordcount.js';

export const STATUSES = [
    { id: 'plan', label: 'วางโครง' },
    { id: 'writing', label: 'กำลังเขียน' },
    { id: 'revising', label: 'แก้ไข' },
    { id: 'done', label: 'เสร็จ' },
    { id: 'published', label: 'เผยแพร่แล้ว' },
];
export const statusLabel = (id) => STATUSES.find(s => s.id === id)?.label || 'วางโครง';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** @type {{projects: {id:string,title:string,updatedAt:number,words:number,episodes:number}[]}} */
export let index = { projects: [] };
/** @type {any} the project that is open right now */
export let project = null;

let saveTimer = null;
let firstDirtyAt = 0;
let dirty = false;
let saving = null;
const listeners = new Set();

/** UI subscribes to save-state changes: 'dirty' | 'saving' | 'saved' | 'error' */
export function onSaveState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(state, err) { for (const fn of listeners) { try { fn(state, err); } catch { /* ui */ } } }

// ------------------------------------------------------------------ shapes

export function newEpisode(title) {
    const now = Date.now();
    return {
        id: uid(),
        title: title || 'ตอนใหม่',
        text: '',
        words: 0,
        status: 'plan',
        target: 0,
        treatment: { summary: '', beats: '', pov: '', characters: '', location: '', hook: '', notes: '' },
        createdAt: now,
        updatedAt: now,
    };
}

function newProject(title) {
    const now = Date.now();
    return {
        id: uid(),
        version: 1,
        title: title || 'เรื่องใหม่',
        overview: { logline: '', premise: '', genre: '', audience: '', characters: '', world: '', notes: '' },
        episodes: [newEpisode('ตอนที่ 1')],
        createdAt: now,
        updatedAt: now,
    };
}

/** Fill missing keys so files written by older versions keep working. */
function normalize(p) {
    const base = newProject(p.title);
    p.overview = { ...base.overview, ...(p.overview || {}) };
    p.episodes = Array.isArray(p.episodes) ? p.episodes : [];
    for (const e of p.episodes) {
        const b = newEpisode(e.title);
        e.id ||= uid();
        e.text = String(e.text ?? '');
        e.treatment = { ...b.treatment, ...(e.treatment || {}) };
        e.status ||= 'plan';
        e.target = Number(e.target) || 0;
        if (typeof e.words !== 'number') e.words = countWords(e.text);
        e.updatedAt ||= Date.now();
    }
    return p;
}

// ------------------------------------------------------------------ index

export async function loadIndex() {
    const data = await readJson(INDEX_FILE, { projects: [] });
    index = data && Array.isArray(data.projects) ? data : { projects: [] };
    return index;
}

async function saveIndex() {
    await writeJson(INDEX_FILE, index);
}

function syncIndexEntry() {
    if (!project) return;
    const entry = {
        id: project.id,
        title: project.title,
        updatedAt: project.updatedAt,
        words: totalWords(),
        episodes: project.episodes.length,
    };
    const i = index.projects.findIndex(x => x.id === project.id);
    if (i >= 0) index.projects[i] = entry; else index.projects.push(entry);
}

// ------------------------------------------------------------------ project lifecycle

export async function createProject(title) {
    await flushProject();
    project = newProject(title);
    syncIndexEntry();
    await writeJson(projectFile(project.id), project);
    await saveIndex();
    setSetting('lastProjectId', project.id);
    return project;
}

/** @returns {Promise<{restored:number}>} number of episodes restored from local drafts */
export async function openProject(id) {
    await flushProject();
    const data = await readJson(projectFile(id), null);
    if (!data) throw new Error('ไม่พบไฟล์ของโปรเจกต์นี้ (อาจถูกลบไปแล้ว)');
    project = normalize(data);
    setSetting('lastProjectId', project.id);

    // Restore any local draft that is newer than what the server has.
    let restored = 0;
    for (const e of project.episodes) {
        const d = loadDraft(project.id, e.id);
        if (!d) continue;
        if (d.ts > (e.updatedAt || 0) && d.text !== e.text) {
            e.text = d.text;
            e.words = countWords(e.text);
            e.updatedAt = d.ts;
            restored++;
        } else {
            clearDraft(project.id, e.id);
        }
    }
    if (restored) markDirty();
    return { restored };
}

export function closeProject() {
    project = null;
}

export async function deleteProject(id) {
    if (project?.id === id) {
        clearTimeout(saveTimer);
        dirty = false;
        for (const e of project.episodes) clearDraft(id, e.id);
        project = null;
    }
    index.projects = index.projects.filter(p => p.id !== id);
    await deleteFile(projectFile(id));
    await saveIndex();
    if (getSetting('lastProjectId') === id) setSetting('lastProjectId', '');
}

// ------------------------------------------------------------------ saving

export function markDirty() {
    if (!project) return;
    project.updatedAt = Date.now();
    if (!dirty) firstDirtyAt = Date.now();
    dirty = true;
    emit('dirty');
    clearTimeout(saveTimer);
    // Save 1.5s after typing stops, but never wait more than 15s while typing continuously.
    const wait = Date.now() - firstDirtyAt > 15000 ? 0 : 1500;
    saveTimer = setTimeout(() => { flushProject(); }, wait);
}

export function isDirty() { return dirty; }

export async function flushProject() {
    clearTimeout(saveTimer);
    if (saving) await saving;
    if (!dirty || !project) return;
    const p = project;
    dirty = false;
    emit('saving');
    saving = (async () => {
        try {
            syncIndexEntry();
            await writeJson(projectFile(p.id), p);
            await saveIndex();
            for (const e of p.episodes) clearDraft(p.id, e.id);
            emit('saved');
        } catch (e) {
            console.error(LOG, e);
            dirty = true;
            emit('error', e);
        }
    })();
    await saving;
    saving = null;
}

// ------------------------------------------------------------------ episodes

export const getEpisode = (eid) => project?.episodes.find(e => e.id === eid) || null;

export function addEpisode(afterId) {
    const n = project.episodes.length + 1;
    const ep = newEpisode(`ตอนที่ ${n}`);
    const i = project.episodes.findIndex(e => e.id === afterId);
    if (i >= 0) project.episodes.splice(i + 1, 0, ep); else project.episodes.push(ep);
    markDirty();
    return ep;
}

export function removeEpisode(eid) {
    project.episodes = project.episodes.filter(e => e.id !== eid);
    clearDraft(project.id, eid);
    markDirty();
}

export function moveEpisode(eid, delta) {
    const arr = project.episodes;
    const i = arr.findIndex(e => e.id === eid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    markDirty();
    return true;
}

/** Drag-and-drop reorder by index. */
export function reorderEpisode(from, to) {
    const arr = project.episodes;
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return false;
    const [ep] = arr.splice(from, 1);
    arr.splice(to, 0, ep);
    markDirty();
    return true;
}

/** Called on every keystroke in the editor. Word counting is done separately (debounced). */
export function setEpisodeText(eid, text) {
    const e = getEpisode(eid);
    if (!e) return;
    e.text = text;
    e.updatedAt = Date.now();
    saveDraft(project.id, eid, text);
    markDirty();
}

export function totalWords() {
    return project ? project.episodes.reduce((s, e) => s + (e.words || 0), 0) : 0;
}
