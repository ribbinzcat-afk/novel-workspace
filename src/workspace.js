// The full-screen workspace overlay: header, Treatment tab, Write tab, Stats tab.
import { getContext } from '../../../../extensions.js';
import { getSetting, setSetting, LOG } from './store.js';
import * as P from './project.js';
import * as S from './stats.js';
import * as Snap from './snapshots.js';
import { makeSortable } from './sortable.js';
import { aiPanelHtml, handleAiAction, onAiInput, resetAi } from './ai-panel.js';
import { aiAllowed } from './api.js';
import { exportHtml, handleExportAction, handleExportChange } from './export-view.js';
import { openLoreImport } from './lore-import.js';
import { countWords, countChars, formatNum } from './wordcount.js';

const TITLE = 'Novel Workspace';

/** @type {HTMLElement|null} */
let root = null;
let isOpen = false;
let booted = false;
let ringTimer = null;
let recountTimer = null;
let recountEid = '';

const ui = {
    tab: 'write',
    episodeId: '',          // episode open in the editor
    treatSel: 'overview',   // 'overview' or an episode id
    rightOpen: true,
    leftOpen: false,        // mobile drawer state
    leftCollapsed: false,   // desktop: episode list hidden
    focus: false,
    statsScope: 'all',      // 'all' | 'project'
    treatView: 'form',      // 'form' | 'board' (corkboard)
    rightTab: 'treatment',  // 'treatment' | 'versions'
};

// ================================================================ helpers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $q = (sel) => root?.querySelector(sel);
const isNarrow = () => window.matchMedia('(max-width: 768px)').matches;

function popup() {
    const ctx = getContext();
    return { call: ctx.callGenericPopup, TYPE: ctx.POPUP_TYPE, RESULT: ctx.POPUP_RESULT };
}

async function askText(message, value = '') {
    const { call, TYPE } = popup();
    const res = await call(esc(message), TYPE.INPUT, value);
    if (res === null || res === false || res === undefined) return null;
    const v = String(res).trim();
    return v || null;
}

async function confirmBox(message) {
    const { call, TYPE, RESULT } = popup();
    const res = await call(message, TYPE.CONFIRM);
    return res === RESULT.AFFIRMATIVE || res === true || res === 1;
}

function ringSvg(pct, size, stroke) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct));
    return `<svg class="novelws-ring-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" class="novelws-ring-track"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" class="novelws-ring-fill ${p >= 1 ? 'novelws-done' : ''}"
            stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="round"/>
    </svg>`;
}

const todayWords = () => Math.max(0, S.dayTotal(S.dayKey()));
const goal = () => Math.max(1, Number(getSetting('dailyGoal')) || 1000);

// ================================================================ open / close

export async function openWorkspace() {
    if (!getSetting('enabled')) return;
    mount();
    root.classList.remove('novelws-hidden');
    document.body.classList.add('novelws-open');
    isOpen = true;
    ui.tab = getSetting('lastTab') || 'write';
    ui.treatView = getSetting('treatView') === 'board' ? 'board' : 'form';
    if (!booted && isNarrow()) ui.rightOpen = false;

    if (!booted) {
        renderLoading();
        try {
            await Promise.all([P.loadIndex(), S.loadStats()]);
            booted = true;
            const last = getSetting('lastProjectId');
            const target = P.index.projects.find(p => p.id === last) || P.index.projects[0];
            if (target) await switchProject(target.id, { silentRender: true });
        } catch (e) {
            console.error(LOG, e);
            toastr.error(String(e.message || e), TITLE);
        }
    }
    applyEditorPrefs();
    renderAll();
    clearInterval(ringTimer);
    ringTimer = setInterval(renderRing, 60_000);
}

export async function closeWorkspace() {
    if (!root || !isOpen) return;
    flushRecount();
    isOpen = false;
    clearInterval(ringTimer);
    root.classList.add('novelws-hidden');
    document.body.classList.remove('novelws-open');
    await Promise.all([P.flushProject(), S.flushStats(), Snap.flushSnapshots()]);
}

/** Main switch turned off: save, then remove every trace from the page. */
export async function teardown() {
    await closeWorkspace();
    resetAi();
    root?.remove();
    root = null;
    booted = false;
    P.closeProject();
}

export const isWorkspaceOpen = () => isOpen;

/** Re-apply editor settings changed from the Extensions drawer. */
export function applyEditorPrefs() {
    if (!root) return;
    const fonts = {
        theme: 'inherit',
        serif: "'Noto Serif Thai', 'Sarabun', Georgia, 'Times New Roman', serif",
        sans: "'Noto Sans Thai', 'Sarabun', 'Leelawadee UI', system-ui, sans-serif",
    };
    root.style.setProperty('--novelws-font', fonts[getSetting('editorFont')] || 'inherit');
    root.style.setProperty('--novelws-font-size', `${Number(getSetting('editorFontSize')) || 18}px`);
    root.style.setProperty('--novelws-line-height', String(Number(getSetting('editorLineHeight')) || 1.9));
    root.style.setProperty('--novelws-page-width', `${Number(getSetting('editorWidth')) || 760}px`);
    if (isOpen) renderRing();
}

/** Called from the drawer when goal / day start change. */
export function refreshStatsViews() {
    if (!root || !isOpen) return;
    renderRing();
    if (ui.tab === 'stats') renderMain();
    else updateCounters();
}

// ================================================================ mount

function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'novelws-root';
    root.className = 'novelws-root novelws-hidden';
    root.innerHTML = `
        <header class="novelws-header">
            <div class="novelws-brand"><i class="fa-solid fa-feather-pointed"></i><span>Novel Workspace</span></div>
            <div class="novelws-project">
                <select class="text_pole novelws-project-select" aria-label="เลือกโปรเจกต์"></select>
                <button class="novelws-icon-btn" data-act="project-new" title="สร้างเรื่องใหม่"><i class="fa-solid fa-plus"></i></button>
                <button class="novelws-icon-btn" data-act="project-rename" title="เปลี่ยนชื่อเรื่อง"><i class="fa-solid fa-pen"></i></button>
                <button class="novelws-icon-btn" data-act="project-delete" title="ลบเรื่องนี้"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <nav class="novelws-tabs" role="tablist">
                <button class="novelws-tab" data-tab="treatment"><i class="fa-solid fa-list-check"></i><span>Treatment</span></button>
                <button class="novelws-tab" data-tab="write"><i class="fa-solid fa-pen-nib"></i><span>เขียน</span></button>
                <button class="novelws-tab" data-tab="stats"><i class="fa-solid fa-chart-simple"></i><span>สถิติ</span></button>
                <button class="novelws-tab" data-tab="export"><i class="fa-solid fa-file-export"></i><span>ส่งออก</span></button>
            </nav>
            <div class="novelws-header-right">
                <button class="novelws-ring-btn" data-act="goto-stats" title="เป้าหมายวันนี้"></button>
                <button class="novelws-icon-btn" data-act="close" title="ปิด (กลับไปหน้าแชท)"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </header>
        <main class="novelws-main"></main>`;
    document.body.appendChild(root);

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('paste', (ev) => {
        const t = /** @type {HTMLInputElement} */ (ev.target);
        if (t.classList?.contains('novelws-beat-input')) onBeatPaste(ev, t);
    });

    P.onSaveState(renderSaveState);

    // Switching to a phone-sized viewport: drawers start closed so they never cover the page.
    window.matchMedia('(max-width: 768px)').addEventListener('change', (mq) => {
        if (!root) return;
        ui.leftOpen = false;
        ui.rightOpen = !mq.matches;
        applyLayoutClasses();
    });
}

// ================================================================ events

async function onClick(ev) {
    const t = /** @type {HTMLElement} */ (ev.target);
    const tabBtn = t.closest('[data-tab]');
    if (tabBtn && tabBtn.classList.contains('novelws-tab')) return setTab(tabBtn.getAttribute('data-tab'));

    const ep = t.closest('.novelws-ep');
    const actEl = t.closest('[data-act]');
    const act = actEl?.getAttribute('data-act');

    if (ep && !act) {
        const eid = ep.getAttribute('data-eid');
        if (ep.closest('.novelws-treat')) selectTreatment(eid);
        else selectEpisode(eid);
        return;
    }
    if (!act) return;

    if (act.startsWith('ai-')) { handleAiAction(act, actEl, aiCtx()); return; }
    if (act.startsWith('ex-') && P.project) { handleExportAction(act, actEl, P.project, renderMain); return; }
    if (act === 'lore-import') return loreImportFlow(actEl.getAttribute('data-target'), actEl.getAttribute('data-label'));

    switch (act) {
        case 'close': return closeWorkspace();
        case 'goto-stats': return setTab('stats');
        case 'project-new': return newProjectFlow();
        case 'project-rename': return renameProjectFlow();
        case 'project-delete': return deleteProjectFlow();
        case 'add-episode': return addEpisodeFlow();
        case 'ep-up': ev.stopPropagation(); return moveEpisodeFlow(actEl.closest('.novelws-ep').getAttribute('data-eid'), -1);
        case 'ep-down': ev.stopPropagation(); return moveEpisodeFlow(actEl.closest('.novelws-ep').getAttribute('data-eid'), 1);
        case 'ep-delete': ev.stopPropagation(); return deleteEpisodeFlow(actEl.closest('.novelws-ep').getAttribute('data-eid'));
        case 'toggle-left': return toggleLeft();
        case 'toggle-right': ui.rightOpen = !ui.rightOpen; return applyLayoutClasses();
        case 'toggle-focus': ui.focus = !ui.focus; return applyLayoutClasses();
        case 'close-drawers': ui.leftOpen = false; if (isNarrow()) ui.rightOpen = false; return applyLayoutClasses();
        case 'treat-overview': return selectTreatment('overview');
        case 'write-this': {
            const eid = actEl.getAttribute('data-eid');
            ui.episodeId = eid;
            return setTab('write');
        }
        case 'edit-treatment': {
            ui.treatSel = ui.episodeId || 'overview';
            return setTab('treatment');
        }
        case 'scope': ui.statsScope = actEl.getAttribute('data-scope'); return renderMain();
        case 'save-now': return P.flushProject();
        case 'right-tab':
            ui.rightTab = actEl.getAttribute('data-rt');
            if (!ui.rightOpen) { ui.rightOpen = true; applyLayoutClasses(); }
            return rerenderRight();
        case 'snap-take': return snapTakeFlow();
        case 'snap-view': return snapViewFlow(actEl.closest('.novelws-snap').getAttribute('data-sid'));
        case 'snap-restore': return snapRestoreFlow(actEl.closest('.novelws-snap').getAttribute('data-sid'));
        case 'snap-delete': return snapDeleteFlow(actEl.closest('.novelws-snap').getAttribute('data-sid'));
        case 'treat-view':
            ui.treatView = actEl.getAttribute('data-view');
            setSetting('treatView', ui.treatView);
            return renderMain();
        case 'board-open': {
            ui.treatSel = actEl.getAttribute('data-eid');
            ui.treatView = 'form';
            setSetting('treatView', 'form');
            return renderMain();
        }
        case 'beat-add': return addBeat(actEl.closest('.novelws-beat'));
        case 'beat-del': return deleteBeat(actEl.closest('.novelws-beat'));
    }
}

function onInput(ev) {
    const t = /** @type {HTMLInputElement} */ (ev.target);
    if (t.classList.contains('novelws-editor')) return onEditorInput(t.value);
    if (t.classList.contains('novelws-beat-input')) return syncBeatsFromDom();
    if (t.classList.contains('novelws-ai-question')) return onAiInput(t);
    if (t.classList.contains('novelws-ep-title-input')) {
        const e = P.getEpisode(ui.episodeId);
        if (!e) return;
        e.title = t.value;
        P.markDirty();
        updateEpisodeRow(e.id);
        return;
    }
    const field = t.getAttribute('data-field');
    if (field) return onFieldInput(t, field);
}

function onChange(ev) {
    const t = /** @type {HTMLSelectElement} */ (ev.target);
    if (ui.tab === 'export' && P.project && handleExportChange(/** @type {any} */ (t), P.project, renderMain)) return;
    if (t.classList.contains('novelws-project-select')) {
        if (t.value) switchProject(t.value);
        return;
    }
    if (t.classList.contains('novelws-ep-status')) {
        const e = P.getEpisode(ui.episodeId);
        if (!e) return;
        e.status = t.value;
        P.markDirty();
        updateEpisodeRow(e.id);
        return;
    }
    const field = t.getAttribute('data-field');
    if (field && t.tagName === 'SELECT') return onFieldInput(t, field);
    if (t.id === 'novelws-goal') {
        const v = Math.max(1, Math.round(Number(t.value) || 0));
        setSetting('dailyGoal', v);
        $('#novelws_daily_goal').val(v);
        return refreshStatsViews();
    }
    if (t.id === 'novelws-daystart') {
        setSetting('dayStartHour', Number(t.value) || 0);
        $('#novelws_day_start').val(Number(t.value) || 0);
        return refreshStatsViews();
    }
}

function onKeyDown(ev) {
    const tgt = /** @type {HTMLInputElement} */ (ev.target);
    if (tgt.classList?.contains('novelws-beat-input')) { onBeatKeyDown(ev, tgt); if (ev.defaultPrevented) return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        flushRecount();
        P.flushProject();
        Snap.flushSnapshots();
        return;
    }
    if (ev.key === 'Escape') {
        if (ui.focus) { ui.focus = false; applyLayoutClasses(); ev.stopPropagation(); return; }
        if (ui.leftOpen || (isNarrow() && ui.rightOpen)) {
            ui.leftOpen = false; if (isNarrow()) ui.rightOpen = false; applyLayoutClasses(); ev.stopPropagation();
        }
    }
}

// ================================================================ projects

async function switchProject(id, { silentRender = false } = {}) {
    flushRecount();
    try {
        const { restored } = await P.openProject(id);
        Snap.loadSnapshots(P.project.id).then(() => { if (isOpen && ui.rightTab === 'versions') rerenderRight(); });
        if (restored) toastr.info(`กู้ข้อความที่ยังไม่ได้บันทึกกลับมา ${restored} ตอน`, TITLE);
    } catch (e) {
        console.error(LOG, e);
        toastr.error(String(e.message || e), TITLE);
        return;
    }
    const lastEp = getSetting('lastEpisodeId');
    ui.episodeId = P.getEpisode(lastEp) ? lastEp : (P.project.episodes[0]?.id || '');
    ui.treatSel = 'overview';
    if (!silentRender) renderAll();
}

async function newProjectFlow() {
    const title = await askText('ชื่อเรื่องใหม่', '');
    if (!title) return;
    flushRecount();
    try {
        await P.createProject(title);
        Snap.loadSnapshots(P.project.id).then(() => { if (isOpen && ui.rightTab === 'versions') rerenderRight(); });
        ui.episodeId = P.project.episodes[0].id;
        ui.treatSel = 'overview';
        setSetting('lastEpisodeId', ui.episodeId);
        renderAll();
        toastr.success(`สร้างเรื่อง "${title}" แล้ว`, TITLE);
    } catch (e) {
        toastr.error(String(e.message || e), TITLE);
    }
}

async function renameProjectFlow() {
    if (!P.project) return;
    const title = await askText('เปลี่ยนชื่อเรื่อง', P.project.title);
    if (!title) return;
    P.project.title = title;
    P.markDirty();
    renderProjectSelect();
    if (ui.tab === 'treatment' && ui.treatSel === 'overview') renderMain();
}

async function deleteProjectFlow() {
    if (!P.project) return;
    const p = P.project;
    const ok = await confirmBox(`<h3>ลบเรื่อง “${esc(p.title)}”?</h3><p>ทุกตอน (${formatNum(P.totalWords())} คำ) จะถูกลบถาวร ย้อนกลับไม่ได้</p>`);
    if (!ok) return;
    try {
        await P.deleteProject(p.id);
        await Snap.deleteProjectSnapshots(p.id);
        S.forgetProject(p.id);
        toastr.success('ลบเรื่องแล้ว', TITLE);
        const next = P.index.projects[0];
        if (next) await switchProject(next.id);
        else { ui.episodeId = ''; renderAll(); }
    } catch (e) {
        toastr.error(String(e.message || e), TITLE);
    }
}

// ================================================================ episodes

function selectEpisode(eid) {
    if (eid === ui.episodeId) { if (isNarrow()) { ui.leftOpen = false; applyLayoutClasses(); } return; }
    flushRecount();
    ui.episodeId = eid;
    setSetting('lastEpisodeId', eid);
    ui.leftOpen = false;
    renderMain();
}

function selectTreatment(sel) {
    ui.treatSel = sel;
    ui.leftOpen = false;
    renderMain();
}

function addEpisodeFlow() {
    if (!P.project) return;
    flushRecount();
    const board = ui.tab === 'treatment' && ui.treatView === 'board';
    const after = board ? '' : ui.tab === 'treatment' ? (ui.treatSel !== 'overview' ? ui.treatSel : '') : ui.episodeId;
    const ep = P.addEpisode(P.project.episodes.length ? (after || P.project.episodes.at(-1).id) : '');
    if (ui.tab === 'treatment') ui.treatSel = ep.id;
    else { ui.episodeId = ep.id; setSetting('lastEpisodeId', ep.id); }
    renderMain();
    if (ui.tab === 'write') setTimeout(() => { const i = $q('.novelws-ep-title-input'); i?.focus(); i?.select(); }, 30);
}

function moveEpisodeFlow(eid, delta) {
    if (P.moveEpisode(eid, delta)) renderMain();
}

async function deleteEpisodeFlow(eid) {
    const e = P.getEpisode(eid);
    if (!e) return;
    const ok = await confirmBox(`<h3>ลบ “${esc(e.title)}”?</h3><p>${formatNum(e.words)} คำในตอนนี้จะหายถาวร</p>`);
    if (!ok) return;
    flushRecount();
    S.recordEpisodeDeleted(P.project.id, eid, e.words);
    const idx = P.project.episodes.findIndex(x => x.id === eid);
    P.removeEpisode(eid);
    Snap.removeEpisode(eid);
    const neighbour = P.project.episodes[Math.max(0, idx - 1)]?.id || '';
    if (ui.episodeId === eid) ui.episodeId = neighbour;
    if (ui.treatSel === eid) ui.treatSel = neighbour || 'overview';
    renderMain();
    renderRing();
}

// ================================================================ editor + counting

function onEditorInput(text) {
    if (!ui.episodeId) return;
    const before = P.getEpisode(ui.episodeId);
    if (before) Snap.beforeEdit(P.project.id, before.id, before.text);
    P.setEpisodeText(ui.episodeId, text);
    recountEid = ui.episodeId;
    clearTimeout(recountTimer);
    recountTimer = setTimeout(flushRecount, 400);
}

function flushRecount() {
    clearTimeout(recountTimer);
    const eid = recountEid;
    recountEid = '';
    if (!eid || !P.project) return;
    const e = P.getEpisode(eid);
    if (!e) return;
    const w = countWords(e.text);
    if (w !== e.words) {
        S.recordWords(P.project.id, eid, e.words, w);
        e.words = w;
    }
    if (isOpen) updateCounters();
}

// ================================================================ layout

function setTab(tab) {
    flushRecount();
    ui.tab = tab;
    ui.leftOpen = false;
    setSetting('lastTab', tab);
    renderTabs();
    renderMain();
}

function toggleLeft() {
    if (isNarrow()) ui.leftOpen = !ui.leftOpen;
    else ui.leftCollapsed = !ui.leftCollapsed;
    applyLayoutClasses();
}

function applyLayoutClasses() {
    if (!root) return;
    root.classList.toggle('novelws-focus', ui.focus);
    root.classList.toggle('novelws-left-open', ui.leftOpen);
    root.classList.toggle('novelws-left-collapsed', ui.leftCollapsed);
    root.classList.toggle('novelws-right-open', ui.rightOpen);
    root.querySelector('[data-act="toggle-focus"] i')?.classList.toggle('fa-expand', !ui.focus);
    root.querySelector('[data-act="toggle-focus"] i')?.classList.toggle('fa-compress', ui.focus);
}

// ================================================================ render

function renderLoading() {
    const main = $q('.novelws-main');
    if (main) main.innerHTML = `<div class="novelws-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>กำลังโหลด…</p></div>`;
}

function renderAll() {
    if (!root) return;
    renderProjectSelect();
    renderTabs();
    renderRing();
    renderMain();
}

function renderProjectSelect() {
    const sel = $q('.novelws-project-select');
    if (!sel) return;
    const list = P.index.projects;
    sel.innerHTML = list.length
        ? list.map(p => `<option value="${esc(p.id)}">${esc(p.id === P.project?.id ? P.project.title : p.title)}</option>`).join('')
        : '<option value="">— ยังไม่มีเรื่อง —</option>';
    sel.value = P.project?.id || '';
    sel.disabled = !list.length;
    for (const a of ['project-rename', 'project-delete']) {
        const b = $q(`[data-act="${a}"]`);
        if (b) b.disabled = !P.project;
    }
}

function renderTabs() {
    root.querySelectorAll('.novelws-tab').forEach(b => b.classList.toggle('novelws-active', b.getAttribute('data-tab') === ui.tab));
    root.setAttribute('data-tab', ui.tab);
}

function renderRing() {
    const btn = $q('.novelws-ring-btn');
    if (!btn) return;
    const show = getSetting('showRing');
    btn.style.display = show ? '' : 'none';
    if (!show) return;
    const w = todayWords();
    const g = goal();
    btn.innerHTML = `${ringSvg(w / g, 34, 4)}<span class="novelws-ring-text"><b>${formatNum(w)}</b><small>/ ${formatNum(g)}</small></span>`;
    btn.title = `วันนี้เขียนได้ ${formatNum(w)} คำ จากเป้า ${formatNum(g)} คำ`;
}

function renderMain() {
    const main = $q('.novelws-main');
    if (!main) return;
    if (!P.project && ui.tab !== 'stats') {
        main.innerHTML = `<div class="novelws-empty">
            <i class="fa-solid fa-book-open"></i>
            <h3>ยังไม่มีเรื่องที่เขียน</h3>
            <p>เริ่มจากสร้างเรื่องแรก แล้วแบ่งเป็นตอน ๆ ได้เลย</p>
            <button class="menu_button novelws-primary" data-act="project-new"><i class="fa-solid fa-plus"></i> สร้างเรื่องใหม่</button>
        </div>`;
        return;
    }
    if (ui.tab === 'write') renderWrite(main);
    else if (ui.tab === 'treatment') renderTreatment(main);
    else if (ui.tab === 'export') main.innerHTML = `<div class="novelws-export-wrap">${exportHtml(P.project)}</div>`;
    else renderStats(main);
    applyLayoutClasses();
    bindSortables();
}

function bindSortables() {
    const reorder = (from, to) => {
        flushRecount();
        if (P.reorderEpisode(from, to)) renderMain();
    };
    makeSortable($q('.novelws-ep-list'), { item: '.novelws-ep', handle: '.novelws-grip', onEnd: reorder });
    makeSortable($q('.novelws-board'), { item: '.novelws-card-ep', handle: '.novelws-grip', grid: true, onEnd: reorder });
    makeSortable($q('.novelws-beats-edit'), {
        item: '.novelws-beat', handle: '.novelws-grip', onEnd: () => { syncBeatsFromDom(); },
    });
}

// ---------------------------------------------------------------- episode list (shared)

function episodeRowHtml(e, i, selected, withActions) {
    const pct = e.target > 0 ? Math.min(100, Math.round(e.words / e.target * 100)) : 0;
    return `<div class="novelws-ep ${selected ? 'novelws-selected' : ''}" data-eid="${esc(e.id)}" tabindex="0">
        <span class="novelws-grip" title="ลากเพื่อสลับลำดับ"><i class="fa-solid fa-grip-vertical"></i></span>
        <span class="novelws-ep-dot novelws-st-${esc(e.status)}" title="${esc(P.statusLabel(e.status))}"></span>
        <div class="novelws-ep-main">
            <div class="novelws-ep-name"><span class="novelws-ep-no">${i + 1}.</span> ${esc(e.title || 'ไม่มีชื่อ')}</div>
            <div class="novelws-ep-meta">${formatNum(e.words)} คำ${e.target ? ` / ${formatNum(e.target)}` : ''} · ${esc(P.statusLabel(e.status))}</div>
            ${e.target ? `<div class="novelws-ep-bar"><i style="width:${pct}%"></i></div>` : ''}
        </div>
        ${withActions && selected ? `<div class="novelws-ep-actions">
            <button class="novelws-mini-btn" data-act="ep-delete" title="ลบตอน"><i class="fa-solid fa-trash-can"></i></button>
        </div>` : ''}
    </div>`;
}

function leftSideHtml(selectedId, { overview = false } = {}) {
    const eps = P.project.episodes;
    const total = P.totalWords();
    const avg = eps.length ? Math.round(total / eps.length) : 0;
    return `<aside class="novelws-side novelws-side-left">
        <div class="novelws-side-head">
            <span>ตอนทั้งหมด (${eps.length})</span>
            <button class="novelws-icon-btn" data-act="add-episode" title="เพิ่มตอน"><i class="fa-solid fa-plus"></i></button>
        </div>
        ${overview ? `<button class="novelws-overview-item ${selectedId === 'overview' ? 'novelws-selected' : ''}" data-act="treat-overview">
            <i class="fa-solid fa-book"></i> ภาพรวมเรื่อง</button>` : ''}
        <div class="novelws-ep-list">
            ${eps.map((e, i) => episodeRowHtml(e, i, e.id === selectedId, true)).join('') || '<div class="novelws-muted novelws-pad">ยังไม่มีตอน กด + เพื่อเพิ่ม</div>'}
        </div>
        <div class="novelws-side-foot">
            <div>รวม <b class="novelws-total-words">${formatNum(total)}</b> คำ</div>
            <div class="novelws-muted">เฉลี่ย <span class="novelws-avg-words">${formatNum(avg)}</span> คำ/ตอน</div>
        </div>
    </aside>`;
}

function updateEpisodeRow(eid) {
    const e = P.getEpisode(eid);
    if (!e) return;
    const i = P.project.episodes.indexOf(e);
    root.querySelectorAll(`.novelws-ep[data-eid="${CSS.escape(eid)}"]`).forEach(row => {
        const selected = row.classList.contains('novelws-selected');
        row.outerHTML = episodeRowHtml(e, i, selected, true);
    });
}

// ---------------------------------------------------------------- write tab

function renderWrite(main) {
    const e = P.getEpisode(ui.episodeId) || P.project.episodes[0] || null;
    ui.episodeId = e?.id || '';
    main.innerHTML = `<div class="novelws-write">
        ${leftSideHtml(ui.episodeId)}
        <div class="novelws-scrim" data-act="close-drawers"></div>
        <section class="novelws-editor-col">
            <div class="novelws-toolbar">
                <button class="novelws-icon-btn" data-act="toggle-left" title="รายชื่อตอน"><i class="fa-solid fa-bars"></i></button>
                ${e ? `
                <input class="text_pole novelws-ep-title-input" value="${esc(e.title)}" placeholder="ชื่อตอน" aria-label="ชื่อตอน" />
                <select class="text_pole novelws-ep-status" aria-label="สถานะ">
                    ${P.STATUSES.map(s => `<option value="${s.id}" ${s.id === e.status ? 'selected' : ''}>${s.label}</option>`).join('')}
                </select>` : '<div class="novelws-grow"></div>'}
                ${e ? '<button class="novelws-icon-btn" data-act="snap-take" title="บันทึกเวอร์ชันนี้ไว้ย้อนกลับ"><i class="fa-solid fa-camera"></i></button>' : ''}
                <button class="novelws-icon-btn" data-act="toggle-focus" title="โหมดโฟกัส (Esc เพื่อออก)"><i class="fa-solid fa-expand"></i></button>
                <button class="novelws-icon-btn" data-act="toggle-right" title="Treatment ของตอนนี้"><i class="fa-solid fa-clipboard-list"></i></button>
            </div>
            <div class="novelws-page">
                ${e ? `<textarea class="novelws-editor" spellcheck="false" placeholder="เริ่มเขียนตอนนี้ได้เลย…">${esc(e.text)}</textarea>`
                    : `<div class="novelws-empty"><p>ยังไม่มีตอน</p><button class="menu_button" data-act="add-episode"><i class="fa-solid fa-plus"></i> เพิ่มตอนแรก</button></div>`}
            </div>
            <footer class="novelws-statusbar">
                <span class="novelws-sb-ep"></span>
                <span class="novelws-sb-today"></span>
                <span class="novelws-grow"></span>
                <button class="novelws-save-state" data-act="save-now" title="กด Ctrl/Cmd + S เพื่อบันทึกทันที"></button>
            </footer>
        </section>
        ${rightSideHtml(e)}
    </div>`;
    updateCounters();
    renderSaveState(P.isDirty() ? 'dirty' : 'saved');
}

function rightSideHtml(e) {
    if (!e) return '<aside class="novelws-side novelws-side-right"></aside>';
    const tabs = `<div class="novelws-side-tabs">
            <button class="novelws-side-tab ${ui.rightTab === 'treatment' ? 'novelws-active' : ''}" data-act="right-tab" data-rt="treatment"><i class="fa-solid fa-clipboard-list"></i> Treatment</button>
            <button class="novelws-side-tab ${ui.rightTab === 'versions' ? 'novelws-active' : ''}" data-act="right-tab" data-rt="versions"><i class="fa-solid fa-clock-rotate-left"></i> เวอร์ชัน</button>
            ${aiAllowed() ? `<button class="novelws-side-tab ${ui.rightTab === 'ai' ? 'novelws-active' : ''}" data-act="right-tab" data-rt="ai"><i class="fa-solid fa-wand-magic-sparkles"></i> AI</button>` : ''}
        </div>`;
    return `<aside class="novelws-side novelws-side-right">${tabs}
        <div class="novelws-right-body">${rightBodyHtml(e)}</div>
    </aside>`;
}

function treatmentSummaryHtml(e) {
    const t = e.treatment;
    const beats = String(t.beats || '').split('\n').map(s => s.trim()).filter(Boolean);
    const row = (label, val) => val ? `<div class="novelws-tr-row"><div class="novelws-tr-label">${label}</div><div class="novelws-tr-val">${esc(val)}</div></div>` : '';
    const empty = !t.summary && !beats.length && !t.pov && !t.characters && !t.location && !t.hook && !t.notes;
    return `<div class="novelws-side-subhead">
            <span class="novelws-muted">ของตอนที่เขียนอยู่</span>
            <button class="novelws-icon-btn" data-act="edit-treatment" title="แก้ Treatment"><i class="fa-solid fa-pen"></i></button>
        </div>
        <div class="novelws-tr-body">
            ${empty ? `<div class="novelws-muted novelws-pad">ยังไม่ได้วาง Treatment ของตอนนี้<br><button class="menu_button novelws-mt" data-act="edit-treatment">วาง Treatment</button></div>` : ''}
            ${row('เรื่องย่อ', t.summary)}
            ${beats.length ? `<div class="novelws-tr-row"><div class="novelws-tr-label">ลำดับเหตุการณ์</div><ol class="novelws-beats">${beats.map(b => `<li>${esc(b)}</li>`).join('')}</ol></div>` : ''}
            ${row('POV', t.pov)}
            ${row('ตัวละคร', t.characters)}
            ${row('สถานที่', t.location)}
            ${row('Hook ท้ายตอน', t.hook)}
            ${row('โน้ต', t.notes)}
        </div>`;
}

const KIND_LABEL = { auto: 'อัตโนมัติ', manual: 'บันทึกเอง', restore: 'ก่อนกู้คืน' };

function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return `วันนี้ ${time}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `เมื่อวาน ${time}`;
    return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${time}`;
}

function versionsHtml(e) {
    if (!Snap.isLoaded()) return '<div class="novelws-muted novelws-pad"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด…</div>';
    const snaps = Snap.list(e.id);
    return `<div class="novelws-side-subhead">
            <span class="novelws-muted">${snaps.length} เวอร์ชัน</span>
            <button class="menu_button novelws-snap-take" data-act="snap-take"><i class="fa-solid fa-camera"></i> บันทึกเวอร์ชันนี้</button>
        </div>
        <div class="novelws-snap-list">
            ${snaps.length ? snaps.map(sn => {
                const diff = e.words - sn.words;
                return `<div class="novelws-snap" data-sid="${esc(sn.id)}">
                    <div class="novelws-snap-head">
                        <span class="novelws-snap-kind novelws-k-${esc(sn.kind)}">${KIND_LABEL[sn.kind] || sn.kind}</span>
                        <span class="novelws-snap-time">${fmtTime(sn.ts)}</span>
                    </div>
                    ${sn.label && sn.kind === 'manual' ? `<div class="novelws-snap-label">${esc(sn.label)}</div>` : ''}
                    <div class="novelws-snap-meta">${formatNum(sn.words)} คำ <span class="novelws-muted">(ตอนนี้ ${diff >= 0 ? '+' : ''}${formatNum(diff)})</span></div>
                    <div class="novelws-snap-actions">
                        <button class="novelws-mini-btn" data-act="snap-view" title="ดู"><i class="fa-solid fa-eye"></i></button>
                        <button class="novelws-mini-btn" data-act="snap-restore" title="กู้คืนเวอร์ชันนี้"><i class="fa-solid fa-rotate-left"></i></button>
                        <button class="novelws-mini-btn" data-act="snap-delete" title="ลบ"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>`;
            }).join('') : `<div class="novelws-muted novelws-pad">ยังไม่มีเวอร์ชันเก่าของตอนนี้<br><small>ระบบจะเก็บให้อัตโนมัติวันละครั้งก่อนเริ่มแก้ตอนนั้น หรือกด “บันทึกเวอร์ชันนี้” เพื่อเก็บเองได้ทุกเมื่อ</small></div>`}
        </div>`;
}

function rerenderRight() {
    const body = $q('.novelws-right-body');
    const e = P.getEpisode(ui.episodeId);
    if (!body || !e) return;
    root.querySelectorAll('.novelws-side-tab').forEach(b => b.classList.toggle('novelws-active', b.getAttribute('data-rt') === ui.rightTab));
    body.innerHTML = rightBodyHtml(e);
}

function rightBodyHtml(e) {
    if (ui.rightTab === 'ai' && !aiAllowed()) ui.rightTab = 'treatment';
    if (ui.rightTab === 'versions') return versionsHtml(e);
    if (ui.rightTab === 'ai') return aiPanelHtml(e);
    return treatmentSummaryHtml(e);
}

function aiCtx() {
    return { project: P.project, episode: P.getEpisode(ui.episodeId), editor: $q('.novelws-editor'), rerender: rerenderRight, root };
}

/** AI switch changed in the drawer. */
export function refreshAiViews() {
    if (!aiAllowed()) resetAi();
    if (root && isOpen && ui.tab === 'write') {
        if (!aiAllowed() && ui.rightTab === 'ai') ui.rightTab = 'treatment';
        renderMain();
    }
}

async function loreImportFlow(path, label) {
    if (!P.project) return;
    const text = await openLoreImport(label);
    if (!text) return;
    const key = path.slice('overview.'.length);
    const cur = String(P.project.overview[key] || '').replace(/\s+$/, '');
    P.project.overview[key] = cur ? `${cur}\n\n${text}` : text;
    P.markDirty();
    renderMain();
    toastr.success('เพิ่มข้อมูลแล้ว', TITLE);
}

async function snapTakeFlow() {
    const e = P.getEpisode(ui.episodeId);
    if (!e) return;
    flushRecount();
    const { call, TYPE } = popup();
    const label = await call('ตั้งชื่อเวอร์ชันนี้ (ไม่ใส่ก็ได้)', TYPE.INPUT, '');
    if (label === null || label === false || label === undefined) return;
    Snap.takeManual(e.id, e.text, String(label).trim());
    Snap.flushSnapshots();
    toastr.success('บันทึกเวอร์ชันแล้ว', TITLE);
    rerenderRight();
}

async function snapViewFlow(sid) {
    const e = P.getEpisode(ui.episodeId);
    const sn = e && Snap.get(e.id, sid);
    if (!sn) return;
    const { call, TYPE } = popup();
    const html = `<div class="novelws-snap-view">
        <h3>${esc(e.title)} <small>· ${fmtTime(sn.ts)} · ${formatNum(sn.words)} คำ</small></h3>
        <div class="novelws-snap-text">${esc(sn.text) || '<i>(ว่าง)</i>'}</div>
    </div>`;
    await call(html, TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'ปิด' });
}

async function snapRestoreFlow(sid) {
    const e = P.getEpisode(ui.episodeId);
    const sn = e && Snap.get(e.id, sid);
    if (!sn) return;
    const ok = await confirmBox(`<h3>กู้คืนเวอร์ชัน ${esc(fmtTime(sn.ts))}?</h3><p>ข้อความปัจจุบัน (${formatNum(e.words)} คำ) จะถูกเก็บเป็นเวอร์ชัน “ก่อนกู้คืน” ไว้ให้ย้อนกลับได้</p>`);
    if (!ok) return;
    flushRecount();
    Snap.takeBeforeRestore(e.id, e.text);
    P.setEpisodeText(e.id, sn.text);
    recountEid = e.id;
    flushRecount();
    Snap.flushSnapshots();
    const ed = $q('.novelws-editor');
    if (ed) ed.value = sn.text;
    rerenderRight();
    toastr.success('กู้คืนแล้ว', TITLE);
}

function snapDeleteFlow(sid) {
    const e = P.getEpisode(ui.episodeId);
    if (!e) return;
    Snap.remove(e.id, sid);
    rerenderRight();
}

function updateCounters() {
    if (!root || !P.project) { renderRing(); return; }
    if (ui.tab === 'write' && ui.rightOpen && ui.rightTab === 'versions') rerenderRight();
    const e = P.getEpisode(ui.episodeId);
    const sbEp = $q('.novelws-sb-ep');
    if (sbEp && e) {
        const tgt = e.target ? ` / ${formatNum(e.target)}` : '';
        sbEp.innerHTML = `<i class="fa-solid fa-file-lines"></i> ${formatNum(e.words)}${tgt} คำ <span class="novelws-muted">· ${formatNum(countChars(e.text))} ตัวอักษร</span>`;
    }
    const sbToday = $q('.novelws-sb-today');
    if (sbToday) {
        const w = todayWords();
        sbToday.innerHTML = `<i class="fa-solid fa-calendar-day"></i> วันนี้ ${formatNum(w)} / ${formatNum(goal())}`;
        sbToday.classList.toggle('novelws-goal-hit', w >= goal());
    }
    const total = P.totalWords();
    const eps = P.project.episodes.length;
    root.querySelectorAll('.novelws-total-words').forEach(n => { n.textContent = formatNum(total); });
    root.querySelectorAll('.novelws-avg-words').forEach(n => { n.textContent = formatNum(eps ? Math.round(total / eps) : 0); });
    if (e) {
        root.querySelectorAll(`.novelws-ep[data-eid="${CSS.escape(e.id)}"] .novelws-ep-meta`).forEach(m => {
            m.textContent = `${formatNum(e.words)} คำ${e.target ? ` / ${formatNum(e.target)}` : ''} · ${P.statusLabel(e.status)}`;
        });
        root.querySelectorAll(`.novelws-ep[data-eid="${CSS.escape(e.id)}"] .novelws-ep-bar i`).forEach(b => {
            b.style.width = `${e.target ? Math.min(100, Math.round(e.words / e.target * 100)) : 0}%`;
        });
    }
    renderRing();
}

function renderSaveState(state) {
    const el = $q('.novelws-save-state');
    if (!el) return;
    const map = {
        dirty: ['fa-circle', 'ยังไม่บันทึก'],
        saving: ['fa-spinner fa-spin', 'กำลังบันทึก…'],
        saved: ['fa-check', 'บันทึกแล้ว'],
        error: ['fa-triangle-exclamation', 'บันทึกไม่สำเร็จ — กดเพื่อลองใหม่'],
    };
    const [icon, label] = map[state] || map.saved;
    el.className = `novelws-save-state novelws-ss-${state}`;
    el.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${label}</span>`;
    if (state === 'error') toastr.warning('บันทึกลงเซิร์ฟเวอร์ไม่สำเร็จ ข้อความยังถูกเก็บสำรองไว้ในเบราว์เซอร์', TITLE, { preventDuplicates: true });
}

// ---------------------------------------------------------------- treatment tab

const OVERVIEW_FIELDS = [
    { key: 'logline', label: 'Logline', hint: 'เรื่องนี้ในประโยคเดียว', rows: 2 },
    { key: 'genre', label: 'แนว / กลุ่มผู้อ่าน', hint: 'เช่น แฟนตาซีโรแมนซ์ วัยรุ่น', input: true },
    { key: 'premise', label: 'เรื่องย่อ / Premise', hint: 'ภาพรวมของทั้งเรื่อง ต้น กลาง จบ', rows: 8 },
    { key: 'characters', label: 'ตัวละครหลัก', hint: 'ชื่อ บทบาท เป้าหมาย ปม', rows: 6, lore: true },
    { key: 'world', label: 'โลก / ฉาก', hint: 'สถานที่ กฎของโลก ยุคสมัย', rows: 4, lore: true },
    { key: 'notes', label: 'โน้ต', hint: '', rows: 4 },
];

const EPISODE_FIELDS = [
    { key: 'summary', label: 'เรื่องย่อของตอน', hint: 'ตอนนี้เกิดอะไรขึ้น', rows: 4 },
    { key: 'beats', label: 'ลำดับเหตุการณ์', hint: 'บรรทัดละหนึ่งเหตุการณ์ เรียงตามลำดับ', rows: 7 },
    { key: 'pov', label: 'POV', hint: 'มุมมองของใคร', input: true, half: true },
    { key: 'location', label: 'สถานที่', hint: '', input: true, half: true },
    { key: 'characters', label: 'ตัวละครที่ปรากฏ', hint: '', input: true },
    { key: 'hook', label: 'Hook ท้ายตอน', hint: 'สิ่งที่อยากให้คนอ่านค้างไว้', rows: 2 },
    { key: 'notes', label: 'โน้ต', hint: '', rows: 3 },
];

function fieldHtml(f, path, value) {
    const id = `novelws-f-${path.replace(/\W/g, '-')}`;
    const ctl = f.input
        ? `<input id="${id}" class="text_pole" data-field="${path}" value="${esc(value)}" placeholder="${esc(f.hint)}" />`
        : `<textarea id="${id}" class="text_pole novelws-ta" data-field="${path}" rows="${f.rows || 3}" placeholder="${esc(f.hint)}">${esc(value)}</textarea>`;
    const lore = f.lore ? `<button class="novelws-link-btn" data-act="lore-import" data-target="${path}" data-label="${esc(f.label)}" title="ดึงจากการ์ดตัวละครหรือ Lorebook ของ SillyTavern"><i class="fa-solid fa-book-atlas"></i> ดึงจาก ST</button>` : '';
    return `<div class="novelws-field ${f.half ? 'novelws-half' : ''}"><div class="novelws-label-row"><label for="${id}">${f.label}</label>${lore}</div>${ctl}</div>`;
}

function renderTreatment(main) {
    if (ui.treatSel !== 'overview' && !P.getEpisode(ui.treatSel)) ui.treatSel = 'overview';
    const board = ui.treatView === 'board';
    const viewToggle = `<div class="novelws-seg">
            <button class="novelws-seg-btn ${!board ? 'novelws-active' : ''}" data-act="treat-view" data-view="form"><i class="fa-solid fa-align-left"></i> ฟอร์ม</button>
            <button class="novelws-seg-btn ${board ? 'novelws-active' : ''}" data-act="treat-view" data-view="board"><i class="fa-solid fa-table-cells-large"></i> Corkboard</button>
        </div>`;
    main.innerHTML = `<div class="novelws-treat ${board ? 'novelws-board-mode' : ''}">
        ${leftSideHtml(ui.treatSel, { overview: true })}
        <div class="novelws-scrim" data-act="close-drawers"></div>
        <section class="novelws-form-col">
            <div class="novelws-toolbar">
                <button class="novelws-icon-btn novelws-only-narrow" data-act="toggle-left" title="รายชื่อตอน"><i class="fa-solid fa-bars"></i></button>
                ${viewToggle}
                <span class="novelws-grow"></span>
                ${board ? `<button class="menu_button" data-act="add-episode"><i class="fa-solid fa-plus"></i> เพิ่มตอน</button>` : ''}
            </div>
            ${board ? boardHtml() : `<div class="novelws-form">${treatmentFormHtml()}</div>`}
        </section>
    </div>`;
}

function treatmentFormHtml() {
    if (ui.treatSel === 'overview') {
        const o = P.project.overview;
        return `<h2 class="novelws-form-title"><i class="fa-solid fa-book"></i> ภาพรวมเรื่อง</h2>
            <div class="novelws-field"><label for="novelws-f-ptitle">ชื่อเรื่อง</label>
                <input id="novelws-f-ptitle" class="text_pole" data-field="project.title" value="${esc(P.project.title)}" /></div>
            ${OVERVIEW_FIELDS.map(f => fieldHtml(f, `overview.${f.key}`, o[f.key])).join('')}`;
    }
    const e = P.getEpisode(ui.treatSel);
    const i = P.project.episodes.indexOf(e);
    return `<h2 class="novelws-form-title"><span class="novelws-muted">ตอนที่ ${i + 1}</span></h2>
        <div class="novelws-field"><label for="novelws-f-etitle">ชื่อตอน</label>
            <input id="novelws-f-etitle" class="text_pole" data-field="episode.title" value="${esc(e.title)}" /></div>
        <div class="novelws-field novelws-half"><label for="novelws-f-estatus">สถานะ</label>
            <select id="novelws-f-estatus" class="text_pole" data-field="episode.status">
                ${P.STATUSES.map(s => `<option value="${s.id}" ${s.id === e.status ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select></div>
        <div class="novelws-field novelws-half"><label for="novelws-f-etarget">เป้าจำนวนคำของตอน</label>
            <input id="novelws-f-etarget" class="text_pole" type="number" min="0" step="100" data-field="episode.target" value="${e.target || ''}" placeholder="ไม่ตั้งก็ได้" /></div>
        ${EPISODE_FIELDS.map(f => f.key === 'beats' ? beatsEditorHtml(f, e.treatment.beats) : fieldHtml(f, `episode.treatment.${f.key}`, e.treatment[f.key])).join('')}
        <div class="novelws-form-foot">
            <span class="novelws-muted">เขียนไปแล้ว ${formatNum(e.words)} คำ</span>
            <button class="menu_button novelws-primary" data-act="write-this" data-eid="${esc(e.id)}"><i class="fa-solid fa-pen-nib"></i> ไปเขียนตอนนี้</button>
        </div>`;
}

// ---------------------------------------------------------------- beats editor (drag to reorder)

const beatRowHtml = (text) => `<div class="novelws-beat">
        <span class="novelws-grip" title="ลากเพื่อสลับลำดับ"><i class="fa-solid fa-grip-vertical"></i></span>
        <input class="text_pole novelws-beat-input" value="${esc(text)}" placeholder="เหตุการณ์…" />
        <button class="novelws-mini-btn" data-act="beat-del" title="ลบเหตุการณ์นี้"><i class="fa-solid fa-xmark"></i></button>
    </div>`;

function beatsEditorHtml(f, value) {
    const lines = String(value || '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return `<div class="novelws-field">
        <label>${f.label} <small class="novelws-muted">— ลาก <i class="fa-solid fa-grip-vertical"></i> เพื่อสลับ · Enter = เพิ่มข้อถัดไป</small></label>
        <div class="novelws-beats-edit">${lines.map(beatRowHtml).join('')}</div>
        <button class="menu_button novelws-beat-addbtn" data-act="beat-add"><i class="fa-solid fa-plus"></i> เพิ่มเหตุการณ์</button>
    </div>`;
}

function syncBeatsFromDom() {
    const e = P.getEpisode(ui.treatSel);
    const box = $q('.novelws-beats-edit');
    if (!e || !box) return;
    e.treatment.beats = Array.from(box.querySelectorAll('.novelws-beat-input')).map(i => i.value.replace(/\n/g, ' ')).join('\n');
    P.markDirty();
}

function addBeat(afterRow, text = '', focus = true) {
    const box = $q('.novelws-beats-edit');
    if (!box) return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = beatRowHtml(text);
    const row = tmp.firstElementChild;
    if (afterRow && afterRow.parentElement === box) box.insertBefore(row, afterRow.nextElementSibling);
    else box.appendChild(row);
    syncBeatsFromDom();
    if (focus) row.querySelector('input')?.focus();
    return row;
}

function deleteBeat(row, focusPrev = false) {
    if (!row) return;
    const prev = row.previousElementSibling;
    row.remove();
    syncBeatsFromDom();
    if (focusPrev && prev) {
        const i = prev.querySelector('input');
        i?.focus();
        i?.setSelectionRange(i.value.length, i.value.length);
    }
}

function onBeatKeyDown(ev, input) {
    const row = input.closest('.novelws-beat');
    if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        addBeat(row);
    } else if (ev.key === 'Backspace' && !input.value && !ev.isComposing) {
        ev.preventDefault();
        deleteBeat(row, true);
    }
}

function onBeatPaste(ev, input) {
    const text = ev.clipboardData?.getData('text') || '';
    if (!text.includes('\n')) return;
    ev.preventDefault();
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + lines[0] + input.value.slice(end);
    let row = input.closest('.novelws-beat');
    for (const line of lines.slice(1)) row = addBeat(row, line, false);
    syncBeatsFromDom();
    row?.querySelector('input')?.focus();
}

// ---------------------------------------------------------------- corkboard

function boardHtml() {
    const eps = P.project.episodes;
    return `<div class="novelws-board-wrap">
        <div class="novelws-board">
            ${eps.map((e, i) => {
                const t = e.treatment;
                const beats = String(t.beats || '').split('\n').filter(x => x.trim()).length;
                const pct = e.target > 0 ? Math.min(100, Math.round(e.words / e.target * 100)) : 0;
                return `<div class="novelws-card-ep novelws-cs-${esc(e.status)}" data-eid="${esc(e.id)}" data-act="board-open" tabindex="0">
                    <div class="novelws-card-ep-head">
                        <span class="novelws-grip" title="ลากเพื่อสลับลำดับ"><i class="fa-solid fa-grip-vertical"></i></span>
                        <span class="novelws-muted">ตอนที่ ${i + 1}</span>
                        <span class="novelws-grow"></span>
                        <span class="novelws-ep-dot novelws-st-${esc(e.status)}"></span>
                        <span class="novelws-card-ep-status">${esc(P.statusLabel(e.status))}</span>
                    </div>
                    <div class="novelws-card-ep-title">${esc(e.title || 'ไม่มีชื่อ')}</div>
                    <div class="novelws-card-ep-sum ${t.summary ? '' : 'novelws-muted'}">${t.summary ? esc(t.summary) : 'ยังไม่มีเรื่องย่อ'}</div>
                    ${t.hook ? `<div class="novelws-card-ep-hook"><i class="fa-solid fa-anchor"></i> ${esc(t.hook)}</div>` : ''}
                    <div class="novelws-card-ep-foot">
                        <span>${formatNum(e.words)}${e.target ? ` / ${formatNum(e.target)}` : ''} คำ</span>
                        ${beats ? `<span class="novelws-muted"><i class="fa-solid fa-list-ol"></i> ${beats}</span>` : ''}
                    </div>
                    ${e.target ? `<div class="novelws-ep-bar"><i style="width:${pct}%"></i></div>` : ''}
                </div>`;
            }).join('')}
            <button class="novelws-card-add" data-act="add-episode"><i class="fa-solid fa-plus"></i><span>เพิ่มตอน</span></button>
        </div>
    </div>`;
}

function onFieldInput(el, path) {
    const value = el.value;
    if (path === 'project.title') {
        P.project.title = value;
        P.markDirty();
        const opt = $q(`.novelws-project-select option[value="${CSS.escape(P.project.id)}"]`);
        if (opt) opt.textContent = value;
        return;
    }
    if (path.startsWith('overview.')) {
        P.project.overview[path.slice(9)] = value;
        P.markDirty();
        return;
    }
    if (path.startsWith('episode.')) {
        const e = P.getEpisode(ui.treatSel);
        if (!e) return;
        const key = path.slice(8);
        if (key.startsWith('treatment.')) e.treatment[key.slice(10)] = value;
        else if (key === 'target') e.target = Math.max(0, Math.round(Number(value) || 0));
        else e[key] = value;
        P.markDirty();
        if (['title', 'status', 'target'].includes(key)) updateEpisodeRow(e.id);
    }
}

// ---------------------------------------------------------------- stats tab

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const shortDate = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${TH_MONTHS[m - 1]}`; };

function renderStats(main) {
    const scopePid = ui.statsScope === 'project' && P.project ? P.project.id : null;
    const g = goal();
    const today = S.dayKey();
    const todayAll = todayWords();
    const todayScope = Math.max(0, S.dayTotal(today, scopePid));
    const days = S.lastDays(30, scopePid);
    const max = Math.max(g, ...days.map(d => d.words), 1);
    const st = S.streak(g, scopePid);
    const best = S.bestDay(scopePid);
    const sum7 = days.slice(-7).reduce((s, d) => s + d.words, 0);
    const sum30 = days.reduce((s, d) => s + d.words, 0);
    const hit30 = days.filter(d => d.words >= g).length;
    const byEp = P.project ? S.dayByEpisode(today, P.project.id) : [];

    const hours = Array.from({ length: 13 }, (_, h) => h);
    main.innerHTML = `<div class="novelws-stats">
        <div class="novelws-stats-top">
            <div class="novelws-card novelws-today-card">
                <div class="novelws-big-ring">${ringSvg(todayAll / g, 140, 12)}
                    <div class="novelws-big-ring-text"><b>${formatNum(todayAll)}</b><span>จาก ${formatNum(g)} คำ</span></div>
                </div>
                <div class="novelws-today-msg">${todayAll >= g ? '🎉 ถึงเป้าวันนี้แล้ว!' : `อีก ${formatNum(g - todayAll)} คำจะถึงเป้า`}</div>
            </div>
            <div class="novelws-card novelws-goal-card">
                <div class="novelws-field"><label for="novelws-goal">เป้าหมายรายวัน (คำ)</label>
                    <input id="novelws-goal" class="text_pole" type="number" min="1" step="100" value="${g}" /></div>
                <div class="novelws-field"><label for="novelws-daystart">วันใหม่เริ่มเวลา</label>
                    <select id="novelws-daystart" class="text_pole">
                        ${hours.map(h => `<option value="${h}" ${h === Number(getSetting('dayStartHour')) ? 'selected' : ''}>${String(h).padStart(2, '0')}:00${h === 0 ? ' (เที่ยงคืน)' : ''}</option>`).join('')}
                    </select>
                    <small class="novelws-muted">เขียนก่อนเวลานี้จะนับเป็นของเมื่อวาน</small></div>
                <small class="novelws-muted">นับเฉพาะคำที่เพิ่มขึ้นสุทธิในวันนั้น (เขียนเพิ่ม − ลบออก) จากทุกเรื่องรวมกัน</small>
            </div>
        </div>

        <div class="novelws-scope">
            <button class="novelws-chip ${!scopePid ? 'novelws-active' : ''}" data-act="scope" data-scope="all">ทุกเรื่อง</button>
            <button class="novelws-chip ${scopePid ? 'novelws-active' : ''}" data-act="scope" data-scope="project" ${P.project ? '' : 'disabled'}>เฉพาะเรื่องนี้</button>
        </div>

        <div class="novelws-kpis">
            <div class="novelws-card novelws-kpi"><span>วันนี้</span><b>${formatNum(todayScope)}</b></div>
            <div class="novelws-card novelws-kpi"><span>ต่อเนื่อง</span><b>${st} <small>วัน</small></b></div>
            <div class="novelws-card novelws-kpi"><span>7 วันล่าสุด</span><b>${formatNum(sum7)}</b></div>
            <div class="novelws-card novelws-kpi"><span>30 วันล่าสุด</span><b>${formatNum(sum30)}</b></div>
            <div class="novelws-card novelws-kpi"><span>ถึงเป้า (30 วัน)</span><b>${hit30} <small>วัน</small></b></div>
            <div class="novelws-card novelws-kpi"><span>วันที่เขียนเยอะสุด</span><b>${formatNum(best.words)}</b><small class="novelws-muted">${best.key ? shortDate(best.key) : '–'}</small></div>
        </div>

        ${heatmapHtml(scopePid, g)}

        <div class="novelws-card">
            <div class="novelws-card-title">30 วันล่าสุด</div>
            <div class="novelws-chart" style="--novelws-goal-pos:${(g / max) * 100}%">
                <div class="novelws-goal-line" title="เป้า ${formatNum(g)} คำ"></div>
                ${days.map(d => `<div class="novelws-bar-col" title="${shortDate(d.key)}: ${formatNum(d.words)} คำ">
                    <div class="novelws-bar ${d.words >= g ? 'novelws-hit' : ''} ${d.key === today ? 'novelws-today' : ''}" style="height:${(d.words / max) * 100}%"></div>
                </div>`).join('')}
            </div>
            <div class="novelws-chart-axis"><span>${shortDate(days[0].key)}</span><span>วันนี้</span></div>
        </div>

        ${P.project ? `<div class="novelws-card">
            <div class="novelws-card-title">วันนี้เขียนตอนไหนไปบ้าง — ${esc(P.project.title)}</div>
            ${byEp.length ? `<ul class="novelws-today-list">${byEp.map(x => {
                const e = P.getEpisode(x.eid);
                return `<li><span>${esc(e ? e.title : '(ตอนที่ลบไปแล้ว)')}</span><b class="${x.delta < 0 ? 'novelws-neg' : ''}">${x.delta > 0 ? '+' : ''}${formatNum(x.delta)}</b></li>`;
            }).join('')}</ul>` : '<div class="novelws-muted">วันนี้ยังไม่ได้เขียนเรื่องนี้</div>'}
        </div>` : ''}
    </div>`;
}

function heatmapHtml(scopePid, g) {
    const WEEKS = isNarrow() ? 17 : 26;
    const days = S.heatmapDays(WEEKS, scopePid);
    const level = (w) => w <= 0 ? 0 : w < g * 0.25 ? 1 : w < g * 0.5 ? 2 : w < g ? 3 : 4;
    // Month label above the first column that contains the 1st–7th of a month.
    const months = [];
    for (let c = 0; c < WEEKS; c++) {
        const first = days[c * 7];
        const hit = days.slice(c * 7, c * 7 + 7).find(d => d.date === 1);
        const soonNew = days.slice(7, 21).some(d => d.date === 1); // a label in col 1–2 would collide
        months.push(c === 0 ? (soonNew ? '' : TH_MONTHS[first.month]) : hit ? TH_MONTHS[hit.month] : '');
    }
    const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    return `<div class="novelws-card">
        <div class="novelws-card-title">ปฏิทินการเขียน <span class="novelws-muted">· ${WEEKS} สัปดาห์ · เขียน ${S.activeDays(scopePid)} วัน</span></div>
        <div class="novelws-heat" style="--novelws-weeks:${WEEKS}">
            <div class="novelws-heat-months">${months.map(m => `<span>${m}</span>`).join('')}</div>
            <div class="novelws-heat-dow">${DOW.map((d, i) => `<span>${i % 2 ? d : ''}</span>`).join('')}</div>
            <div class="novelws-heat-grid">
                ${days.map(d => `<i class="novelws-hl-${d.future ? 'x' : level(d.words)}" title="${shortDate(d.key)}: ${formatNum(d.words)} คำ"></i>`).join('')}
            </div>
        </div>
        <div class="novelws-heat-legend"><span>น้อย</span><i class="novelws-hl-0"></i><i class="novelws-hl-1"></i><i class="novelws-hl-2"></i><i class="novelws-hl-3"></i><i class="novelws-hl-4"></i><span>ถึงเป้า</span></div>
    </div>`;
}
