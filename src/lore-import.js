// Pull text from SillyTavern's own data (character cards, World Info / Lorebooks) into the treatment.
import { getContext } from '../../../../extensions.js';
import { LOG } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n = 2000) => { s = String(s || '').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };

function characterItems() {
    const chars = getContext().characters || [];
    return chars
        .filter(c => c && c.name)
        .map((c, i) => {
            const desc = c.description || c.data?.description || '';
            const pers = c.personality || c.data?.personality || '';
            const body = [desc, pers ? `นิสัย: ${pers}` : ''].filter(Boolean).join('\n');
            return { id: `c${i}`, title: c.name, sub: clip(desc, 120), text: `■ ${c.name}\n${clip(body)}` };
        })
        .sort((a, b) => a.title.localeCompare(b.title, 'th'));
}

async function loreItems(book) {
    const data = await getContext().loadWorldInfo(book);
    const entries = Object.values(data?.entries || {});
    return entries
        .filter(e => e && String(e.content || '').trim())
        .sort((a, b) => (a.displayIndex ?? a.uid ?? 0) - (b.displayIndex ?? b.uid ?? 0))
        .map((e) => {
            const name = String(e.comment || '').trim() || (Array.isArray(e.key) ? e.key.join(', ') : '') || `entry ${e.uid}`;
            return { id: `w${e.uid}`, title: name, sub: clip(e.content, 120) + (e.disable ? ' (ปิดอยู่)' : ''), text: `■ ${name}\n${clip(e.content)}` };
        });
}

/**
 * Opens a picker. Resolves to the text to append, or null when cancelled.
 * @param {string} fieldLabel shown in the title
 */
export async function openLoreImport(fieldLabel) {
    const ctx = getContext();
    const books = typeof ctx.getWorldInfoNames === 'function' ? ctx.getWorldInfoNames() : [];

    const box = document.createElement('div');
    box.className = 'novelws-lore';
    box.innerHTML = `
        <h3>ดึงข้อมูลมาใส่ “${esc(fieldLabel)}”</h3>
        <select class="text_pole novelws-lore-src">
            <option value="__chars">การ์ดตัวละครทั้งหมด</option>
            ${books.map(b => `<option value="${esc(b)}">Lorebook: ${esc(b)}</option>`).join('')}
        </select>
        <input class="text_pole novelws-lore-filter" placeholder="ค้นหา…" />
        <div class="novelws-lore-tools"><a href="#" data-lore="all">เลือกทั้งหมด</a> · <a href="#" data-lore="none">ไม่เลือก</a> <span class="novelws-lore-count"></span></div>
        <div class="novelws-lore-list"></div>
        <small class="novelws-lore-note">ข้อความจะถูกต่อท้ายช่องเดิม แก้ไขต่อได้ตามสบาย (ยาวเกิน 2,000 ตัวอักษรต่อรายการจะถูกตัด)</small>`;

    let items = [];
    const list = box.querySelector('.novelws-lore-list');
    const count = box.querySelector('.novelws-lore-count');
    const updateCount = () => { count.textContent = `เลือก ${list.querySelectorAll('input:checked').length} รายการ`; };
    const draw = () => {
        const q = box.querySelector('.novelws-lore-filter').value.trim().toLowerCase();
        list.innerHTML = items.length
            ? items.map(it => `<label class="novelws-lore-item" ${q && !(`${it.title} ${it.sub}`.toLowerCase().includes(q)) ? 'hidden' : ''}>
                <input type="checkbox" value="${esc(it.id)}" />
                <span><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>
            </label>`).join('')
            : '<div class="novelws-lore-empty">ไม่มีรายการ</div>';
        updateCount();
    };
    const load = async (src) => {
        list.innerHTML = '<div class="novelws-lore-empty"><i class="fa-solid fa-spinner fa-spin"></i></div>';
        try {
            items = src === '__chars' ? characterItems() : await loreItems(src);
        } catch (e) {
            console.error(LOG, 'โหลด Lorebook ไม่สำเร็จ:', e);
            items = [];
        }
        draw();
    };
    box.querySelector('.novelws-lore-src').addEventListener('change', (e) => load(e.target.value));
    box.querySelector('.novelws-lore-filter').addEventListener('input', draw);
    list.addEventListener('change', updateCount);
    box.querySelector('.novelws-lore-tools').addEventListener('click', (e) => {
        const a = e.target.closest('[data-lore]');
        if (!a) return;
        e.preventDefault();
        const on = a.getAttribute('data-lore') === 'all';
        list.querySelectorAll('.novelws-lore-item:not([hidden]) input').forEach(i => { i.checked = on; });
        updateCount();
    });
    await load('__chars');

    const res = await ctx.callGenericPopup(box, ctx.POPUP_TYPE.CONFIRM, '', { okButton: 'เพิ่ม', cancelButton: 'ยกเลิก', allowVerticalScrolling: true, wide: true });
    if (!(res === ctx.POPUP_RESULT.AFFIRMATIVE || res === true || res === 1)) return null;
    const picked = new Set(Array.from(list.querySelectorAll('input:checked')).map(i => i.value));
    const text = items.filter(it => picked.has(it.id)).map(it => it.text).join('\n\n');
    return text || null;
}
