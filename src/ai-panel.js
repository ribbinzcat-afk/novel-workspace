// "AI" tab in the right panel of the Write tab. Opt-in, read-only helper: it never edits the manuscript.
import { getSetting } from './store.js';
import { PROMPT_DEFS, TOOL_IDS, buildPrompt, getTemplate } from './prompts.js';
import { measure, generate, countTokens, aiAllowed, listProfiles, lastCalls } from './api.js';
import { countWords, formatNum } from './wordcount.js';

const TITLE = 'Novel Workspace';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
    pending: null,   // { tool, vars, scope, system, prompt, measured, textTokens }
    busy: false,
    results: [],     // newest first: { id, tool, ts, epTitle, scope, text, sent, reply }
};

// ------------------------------------------------------------------ context builders

export function treatmentText(ep) {
    const t = ep?.treatment || {};
    const beats = String(t.beats || '').split('\n').map(s => s.trim()).filter(Boolean);
    const lines = [];
    if (t.summary) lines.push(`เรื่องย่อ: ${t.summary}`);
    if (beats.length) lines.push('ลำดับเหตุการณ์:', ...beats.map((b, i) => `${i + 1}. ${b}`));
    if (t.pov) lines.push(`POV: ${t.pov}`);
    if (t.location) lines.push(`สถานที่: ${t.location}`);
    if (t.characters) lines.push(`ตัวละครที่ปรากฏ: ${t.characters}`);
    if (t.hook) lines.push(`Hook ท้ายตอน: ${t.hook}`);
    if (t.notes) lines.push(`โน้ต: ${t.notes}`);
    return lines.join('\n') || '(ผู้เขียนยังไม่ได้วาง treatment ของตอนนี้)';
}

export function overviewText(project) {
    const o = project?.overview || {};
    const pairs = [['Logline', o.logline], ['แนว', o.genre], ['เรื่องย่อ', o.premise], ['ตัวละครหลัก', o.characters], ['โลก / ฉาก', o.world], ['โน้ต', o.notes]];
    return pairs.filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k}: ${v}`).join('\n') || '(ยังไม่มีข้อมูลภาพรวมเรื่อง)';
}

function selectionOf(editor) {
    if (!editor) return null;
    const s = editor.selectionStart ?? 0;
    const e = editor.selectionEnd ?? 0;
    if (e <= s) return null;
    const text = editor.value.slice(s, e);
    if (!text.trim()) return null;
    return { start: s, end: e, text };
}

// ------------------------------------------------------------------ html

const toolLabel = (id) => PROMPT_DEFS[id]?.label || id;

function fmtClock(ts) {
    return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export function aiPanelHtml(ep) {
    if (!aiAllowed()) {
        return `<div class="novelws-muted novelws-pad">ผู้ช่วย AI ปิดอยู่<br><small>เปิดได้ในหน้า Extensions → Novel Workspace → ผู้ช่วย AI</small></div>`;
    }
    const profileId = getSetting('apiProfile');
    const profile = listProfiles().find(p => p.id === profileId);
    const p = state.pending;
    return `<div class="novelws-side-subhead">
            <span class="novelws-muted"><i class="fa-solid fa-plug"></i> ${esc(profile ? profile.name : 'API หลักของ SillyTavern')}</span>
        </div>
        <div class="novelws-ai-body">
            <div class="novelws-ai-hint novelws-muted">เลือกข้อความในหน้าเขียนก่อนกด = ใช้เฉพาะส่วนนั้น · ไม่เลือก = ทั้งตอน<br>AI จะให้ความเห็นเท่านั้น ไม่แก้ต้นฉบับของคุณ</div>
            <div class="novelws-ai-tools">
                ${TOOL_IDS.map(id => `<button class="novelws-ai-tool ${p?.tool === id ? 'novelws-active' : ''}" data-act="ai-tool" data-tool="${id}" ${state.busy ? 'disabled' : ''}>
                    <i class="fa-solid ${PROMPT_DEFS[id].icon || 'fa-wand-magic-sparkles'}"></i><span>${esc(toolLabel(id))}</span></button>`).join('')}
            </div>
            ${p ? pendingHtml(p) : ''}
            ${state.busy ? `<div class="novelws-ai-busy"><i class="fa-solid fa-spinner fa-spin"></i> กำลังรอคำตอบ…</div>` : ''}
            <div class="novelws-ai-results">
                ${state.results.map(r => `<div class="novelws-ai-result" data-rid="${esc(r.id)}">
                    <div class="novelws-ai-result-head">
                        <b>${esc(toolLabel(r.tool))}</b>
                        <span class="novelws-muted">${esc(r.epTitle)} · ${fmtClock(r.ts)}</span>
                    </div>
                    ${r.question ? `<div class="novelws-ai-q">“${esc(r.question)}”</div>` : ''}
                    <div class="novelws-ai-text">${esc(r.text) || '<i class="novelws-muted">(ไม่มีคำตอบ)</i>'}</div>
                    <div class="novelws-ai-result-foot">
                        <span class="novelws-muted">${esc(r.scope)} · ส่ง ${formatNum(r.sent)} · ตอบ ${formatNum(r.reply)} tokens</span>
                        <span>
                            <button class="novelws-mini-btn" data-act="ai-copy" title="คัดลอก"><i class="fa-solid fa-copy"></i></button>
                            <button class="novelws-mini-btn" data-act="ai-remove" title="ลบ"><i class="fa-solid fa-xmark"></i></button>
                        </span>
                    </div>
                </div>`).join('')}
            </div>
        </div>`;
}

function pendingHtml(p) {
    const b = p.measured.breakdown;
    return `<div class="novelws-ai-pending">
        <div class="novelws-ai-pending-title"><i class="fa-solid ${PROMPT_DEFS[p.tool].icon}"></i> ${esc(toolLabel(p.tool))}</div>
        <div class="novelws-muted">${esc(p.scope)}</div>
        ${p.tool === 'ask' ? `<textarea class="text_pole novelws-ai-question" rows="3" placeholder="อยากถามอะไรเกี่ยวกับตอนนี้…">${esc(p.question || '')}</textarea>` : ''}
        <div class="novelws-ai-tokens">
            <div><b>${formatNum(p.measured.total)}</b> tokens ที่จะส่ง${p.tool === 'ask' ? ' (ก่อนใส่คำถาม)' : ''}</div>
            <small class="novelws-muted">System ${formatNum(b.System || 0)} · Prompt ${formatNum(b.Prompt || 0)} (ต้นฉบับ ${formatNum(p.textTokens)}) · ตอบกลับสูงสุด ${formatNum(Number(getSetting('aiMaxTokens')) || 1200)}</small>
        </div>
        <div class="novelws-ai-actions">
            <button class="menu_button novelws-primary" data-act="ai-send" ${state.busy ? 'disabled' : ''}><i class="fa-solid fa-paper-plane"></i> ส่ง</button>
            <button class="menu_button" data-act="ai-cancel">ยกเลิก</button>
        </div>
    </div>`;
}

// ------------------------------------------------------------------ actions

/**
 * @param {string} act
 * @param {HTMLElement} el
 * @param {{project:any, episode:any, editor:HTMLTextAreaElement|null, rerender:()=>void, root:HTMLElement}} ctx
 * @returns {boolean} true when handled
 */
export function handleAiAction(act, el, ctx) {
    switch (act) {
        case 'ai-tool': prepare(el.getAttribute('data-tool'), ctx); return true;
        case 'ai-cancel': state.pending = null; ctx.rerender(); return true;
        case 'ai-send': send(ctx); return true;
        case 'ai-copy': {
            const r = state.results.find(x => x.id === el.closest('.novelws-ai-result')?.getAttribute('data-rid'));
            if (r) navigator.clipboard?.writeText(r.text).then(() => toastr.success('คัดลอกแล้ว', TITLE), () => toastr.error('คัดลอกไม่ได้', TITLE));
            return true;
        }
        case 'ai-remove': {
            const id = el.closest('.novelws-ai-result')?.getAttribute('data-rid');
            state.results = state.results.filter(x => x.id !== id);
            ctx.rerender();
            return true;
        }
    }
    return false;
}

export function onAiInput(target) {
    if (target.classList.contains('novelws-ai-question') && state.pending) state.pending.question = target.value;
}

async function prepare(tool, ctx) {
    const { project, episode: ep, editor } = ctx;
    if (!ep || !PROMPT_DEFS[tool]) return;
    const sel = selectionOf(editor);
    if (tool === 'wording' && !sel) {
        toastr.info('เลือกคำหรือข้อความในหน้าเขียนก่อน แล้วค่อยกดปุ่มนี้', TITLE);
        return;
    }
    const maxChars = Math.max(2000, Number(getSetting('aiMaxChars')) || 30000);
    let text = sel ? sel.text : ep.text;
    if (!String(text).trim()) {
        toastr.info('ตอนนี้ยังไม่มีเนื้อหาให้ AI อ่าน', TITLE);
        return;
    }
    let scope = sel ? `ข้อความที่เลือก ${formatNum(countWords(text))} คำ` : `ทั้งตอน ${formatNum(ep.words)} คำ`;
    if (text.length > maxChars) {
        text = text.slice(-maxChars);
        scope += ` (ส่งเฉพาะ ${formatNum(maxChars)} ตัวอักษรท้ายสุด)`;
    }
    let context = '';
    if (tool === 'wording' && sel) {
        const full = editor.value;
        context = full.slice(Math.max(0, sel.start - 500), Math.min(full.length, sel.end + 500));
    }
    const vars = {
        title: project.title,
        scope,
        text,
        context,
        treatment: treatmentText(ep),
        overview: overviewText(project),
        question: '',
    };
    const stored = getSetting('prompts');
    const system = getTemplate('system', stored);
    const prompt = buildPrompt(tool, vars, stored);
    state.pending = { tool, vars, scope, system, prompt, measured: { breakdown: {}, total: 0 }, textTokens: 0, epId: ep.id, epTitle: ep.title, question: '' };
    ctx.rerender();
    const [measured, textTokens] = await Promise.all([measure({ System: system, Prompt: prompt }), countTokens(text)]);
    if (state.pending?.prompt !== prompt) return;
    state.pending.measured = measured;
    state.pending.textTokens = textTokens;
    ctx.rerender();
    if (tool === 'ask') setTimeout(() => ctx.root.querySelector('.novelws-ai-question')?.focus(), 30);
}

async function send(ctx) {
    const p = state.pending;
    if (!p || state.busy) return;
    if (p.tool === 'ask' && !String(p.question || '').trim()) {
        toastr.info('พิมพ์คำถามก่อนนะ', TITLE);
        return;
    }
    let prompt = p.prompt;
    let measured = p.measured;
    if (p.tool === 'ask') {
        prompt = buildPrompt('ask', { ...p.vars, question: p.question.trim() }, getSetting('prompts'));
        measured = await measure({ System: p.system, Prompt: prompt });
    }
    state.busy = true;
    ctx.rerender();
    try {
        const text = await generate(p.tool, p.system, prompt, measured);
        state.results.unshift({
            id: Date.now().toString(36),
            tool: p.tool,
            ts: Date.now(),
            epTitle: p.epTitle,
            scope: p.scope,
            question: p.tool === 'ask' ? p.question.trim() : '',
            text,
            sent: measured.total,
            reply: lastCalls[p.tool]?.replyTokens || 0,
        });
        state.results = state.results.slice(0, 10);
        state.pending = null;
        if (!text) toastr.warning('AI ไม่ได้ตอบอะไรกลับมา', TITLE);
    } catch (e) {
        console.error('[novel-workspace]', e);
        toastr.error(`เรียก AI ไม่สำเร็จ: ${e?.message || e}`, TITLE);
    } finally {
        state.busy = false;
        ctx.rerender();
    }
}

/** Main switch / AI switch turned off: forget anything half-done. */
export function resetAi() {
    state.pending = null;
}
