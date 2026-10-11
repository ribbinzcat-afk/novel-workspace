// File storage in the user's data folder: data/<user>/user/files/novelws-*.json
// Uses ST's own endpoints: POST /api/files/upload (base64), GET /user/files/<name>, POST /api/files/delete
import { getContext } from '../../../../extensions.js';
import { LOG } from './store.js';

const PREFIX = 'novelws-';
export const INDEX_FILE = `${PREFIX}index.json`;
export const STATS_FILE = `${PREFIX}stats.json`;
export const projectFile = (id) => `${PREFIX}project-${id}.json`;

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

function headers() {
    const ctx = getContext();
    return typeof ctx.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };
}

/**
 * @param {string} name file name inside user/files
 * @param {any} fallback returned when the file does not exist yet
 * @returns {Promise<any>}
 */
export async function readJson(name, fallback) {
    let res;
    try {
        res = await fetch(`/user/files/${encodeURIComponent(name)}?t=${Date.now()}`, { cache: 'no-store' });
    } catch (e) {
        throw new Error(`อ่านไฟล์ ${name} ไม่ได้ (เชื่อมต่อเซิร์ฟเวอร์ไม่ได้)`);
    }
    if (res.status === 404) return fallback;
    if (!res.ok) throw new Error(`อ่านไฟล์ ${name} ไม่ได้ (${res.status})`);
    const text = await res.text();
    if (!text.trim()) return fallback;
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error(LOG, 'ไฟล์เสีย:', name, e);
        throw new Error(`ไฟล์ ${name} อ่านไม่ออก (JSON เสีย)`);
    }
}

export async function writeJson(name, obj) {
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name, data: toBase64(JSON.stringify(obj)) }),
    });
    if (!res.ok) throw new Error(`บันทึก ${name} ไม่สำเร็จ (${res.status})`);
}

export async function deleteFile(name) {
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ path: `user/files/${name}` }),
        });
    } catch (e) {
        console.warn(LOG, 'ลบไฟล์ไม่สำเร็จ:', name, e);
    }
}

// ---------------------------------------------------------- local safety net
// The episode text is also mirrored to localStorage on every edit, so a failed server save
// (network drop, ST restarted) never loses what was just typed.

const draftKey = (pid, eid) => `novelws_draft_${pid}_${eid}`;

export function saveDraft(pid, eid, text) {
    try { localStorage.setItem(draftKey(pid, eid), JSON.stringify({ text, ts: Date.now() })); } catch { /* full or blocked */ }
}

export function loadDraft(pid, eid) {
    try {
        const raw = localStorage.getItem(draftKey(pid, eid));
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function clearDraft(pid, eid) {
    try { localStorage.removeItem(draftKey(pid, eid)); } catch { /* ignore */ }
}
