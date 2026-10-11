// "ส่งออก" tab: pick episodes, pick format, download the manuscript or the treatment.
import { getSetting, setSetting, defaultSettings } from './store.js';
import { manuscriptModel, treatmentModel, render, downloadBlob, safeFileName, episodeHeading, toPlainText } from './export.js';
import { formatNum } from './wordcount.js';
import { statusLabel } from './project.js';

const TITLE = 'Novel Workspace';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** project id -> Set of excluded episode ids (everything is included by default, new episodes too) */
const excluded = new Map();

export const opts = () => ({ ...defaultSettings.exportOpts, ...(getSetting('exportOpts') || {}) });
function setOpt(k, v) { setSetting('exportOpts', { ...opts(), [k]: v }); }

function ex(project) {
    if (!excluded.has(project.id)) excluded.set(project.id, new Set());
    return excluded.get(project.id);
}
const selected = (project) => project.episodes.filter(e => !ex(project).has(e.id));

export function exportHtml(project) {
    const o = opts();
    const sel = selected(project);
    const words = sel.reduce((s, e) => s + (e.words || 0), 0);
    const preview = toPlainText(manuscriptModel(project, sel.slice(0, 2), o)).slice(0, 1600);
    const fmt = (id, label, icon) => `<button class="novelws-seg-btn ${o.format === id ? 'novelws-active' : ''}" data-act="ex-format" data-format="${id}"><i class="fa-solid ${icon}"></i> ${label}</button>`;
    return `<div class="novelws-export">
        <div class="novelws-card novelws-ex-pick">
            <div class="novelws-card-title">เลือกตอน <span class="novelws-muted">· ${sel.length}/${project.episodes.length} ตอน · ${formatNum(words)} คำ</span></div>
            <div class="novelws-scope">
                <button class="novelws-chip" data-act="ex-all">ทั้งหมด</button>
                <button class="novelws-chip" data-act="ex-none">ไม่เลือกเลย</button>
                <button class="novelws-chip" data-act="ex-done">เฉพาะที่เสร็จ/เผยแพร่</button>
            </div>
            <div class="novelws-ex-list">
                ${project.episodes.map((e, i) => `<label class="novelws-ex-item">
                    <input type="checkbox" data-ex-ep="${esc(e.id)}" ${ex(project).has(e.id) ? '' : 'checked'} />
                    <span class="novelws-ep-dot novelws-st-${esc(e.status)}"></span>
                    <span class="novelws-ex-name">${i + 1}. ${esc(e.title || 'ไม่มีชื่อ')}</span>
                    <span class="novelws-muted">${formatNum(e.words)} คำ · ${esc(statusLabel(e.status))}</span>
                </label>`).join('') || '<div class="novelws-muted">ยังไม่มีตอน</div>'}
            </div>
        </div>

        <div class="novelws-card novelws-ex-opts">
            <div class="novelws-card-title">รูปแบบไฟล์</div>
            <div class="novelws-seg">${fmt('docx', 'Word (.docx)', 'fa-file-word')}${fmt('md', 'Markdown', 'fa-hashtag')}${fmt('txt', 'ข้อความ (.txt)', 'fa-file-lines')}</div>

            <div class="novelws-field novelws-mt"><label for="novelws-ex-heading">หัวตอน <small class="novelws-muted">— {n} = เลขตอน, {title} = ชื่อตอน</small></label>
                <input id="novelws-ex-heading" class="text_pole" data-ex-opt="heading" value="${esc(o.heading)}" /></div>
            <label class="checkbox_label"><input type="checkbox" data-ex-opt="includeTitle" ${o.includeTitle ? 'checked' : ''} /><span>ใส่ชื่อเรื่องไว้หน้าแรก</span></label>
            ${o.format === 'docx' ? `
            <label class="checkbox_label"><input type="checkbox" data-ex-opt="pageBreak" ${o.pageBreak ? 'checked' : ''} /><span>ขึ้นหน้าใหม่ทุกตอน</span></label>
            <label class="checkbox_label"><input type="checkbox" data-ex-opt="indent" ${o.indent ? 'checked' : ''} /><span>ย่อหน้าบรรทัดแรก</span></label>
            <div class="novelws-ex-row">
                <div class="novelws-field"><label for="novelws-ex-font">ฟอนต์</label><input id="novelws-ex-font" class="text_pole" data-ex-opt="font" value="${esc(o.font)}" list="novelws-ex-fonts" /></div>
                <div class="novelws-field novelws-ex-size"><label for="novelws-ex-size">ขนาด (pt)</label><input id="novelws-ex-size" class="text_pole" type="number" min="8" max="48" data-ex-opt="size" value="${Number(o.size) || 16}" /></div>
            </div>
            <datalist id="novelws-ex-fonts"><option value="TH Sarabun New"><option value="Sarabun"><option value="Noto Serif Thai"><option value="Noto Sans Thai"><option value="Angsana New"><option value="Cordia New"></datalist>` : ''}

            <div class="novelws-ex-buttons">
                <button class="menu_button novelws-primary" data-act="ex-manuscript" ${sel.length ? '' : 'disabled'}><i class="fa-solid fa-download"></i> ดาวน์โหลดต้นฉบับ</button>
                <button class="menu_button" data-act="ex-treatment" ${sel.length ? '' : 'disabled'}><i class="fa-solid fa-list-check"></i> ดาวน์โหลด Treatment</button>
            </div>
            <small class="novelws-muted">Treatment จะใช้ตอนที่เลือกและรูปแบบไฟล์เดียวกัน</small>
        </div>

        <div class="novelws-card novelws-ex-preview">
            <div class="novelws-card-title">ตัวอย่าง <span class="novelws-muted">(ช่วงต้น)</span></div>
            <pre class="novelws-ex-pre">${esc(preview) || '<span class="novelws-muted">ยังไม่ได้เลือกตอน</span>'}</pre>
        </div>
    </div>`;
}

/** @returns {boolean} handled */
export function handleExportAction(act, el, project, rerender) {
    const set = ex(project);
    switch (act) {
        case 'ex-format': setOpt('format', el.getAttribute('data-format')); rerender(); return true;
        case 'ex-all': set.clear(); rerender(); return true;
        case 'ex-none': project.episodes.forEach(e => set.add(e.id)); rerender(); return true;
        case 'ex-done':
            set.clear();
            project.episodes.forEach(e => { if (!['done', 'published'].includes(e.status)) set.add(e.id); });
            rerender();
            return true;
        case 'ex-manuscript': return doExport(project, 'manuscript'), true;
        case 'ex-treatment': return doExport(project, 'treatment'), true;
    }
    return false;
}

/** checkbox / input changes inside the export tab */
export function handleExportChange(el, project, rerender) {
    const epId = el.getAttribute('data-ex-ep');
    if (epId) {
        const set = ex(project);
        if (el.checked) set.delete(epId); else set.add(epId);
        rerender();
        return true;
    }
    const k = el.getAttribute('data-ex-opt');
    if (k) {
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (k === 'size') v = Math.min(48, Math.max(8, Number(v) || 16));
        setOpt(k, v);
        if (el.type === 'checkbox' || k === 'heading') rerender();
        return true;
    }
    return false;
}

function doExport(project, kind) {
    const o = opts();
    const sel = selected(project);
    if (!sel.length) return;
    try {
        const model = kind === 'treatment' ? treatmentModel(project, sel) : manuscriptModel(project, sel, o);
        const { blob, ext } = render(model, o.format, o);
        const range = sel.length === project.episodes.length ? '' : sel.length === 1
            ? ` - ${episodeHeading('ตอนที่ {n}', sel[0], project.episodes.indexOf(sel[0]) + 1)}`
            : ` - ${sel.length} ตอน`;
        const name = `${safeFileName(project.title)}${kind === 'treatment' ? ' - Treatment' : ''}${range}.${ext}`;
        downloadBlob(blob, name);
        toastr.success(`ส่งออก ${name} แล้ว`, TITLE);
    } catch (e) {
        console.error('[novel-workspace]', e);
        toastr.error(`ส่งออกไม่สำเร็จ: ${e?.message || e}`, TITLE);
    }
}
