// Novel Workspace — turns SillyTavern into a full-screen novel writing room.
// Bootstrap only: settings drawer, main switch, wand button. Features live in src/.
import { getContext } from '../../../extensions.js';
import { extensionName, extensionFolderUrl, getSettings, getSetting, setSetting, LOG } from './src/store.js';
import { openWorkspace, closeWorkspace, teardown, applyEditorPrefs, refreshStatsViews, isWorkspaceOpen, refreshAiViews } from './src/workspace.js';
import { PROMPT_DEFS, validatePromptTemplate } from './src/prompts.js';
import { listProfiles } from './src/api.js';
import { flushProject } from './src/project.js';
import { flushStats } from './src/stats.js';

const TITLE = 'Novel Workspace';

// ---------------------------------------------------------------- wand button

function mountWandButton() {
    if (document.getElementById('novelws-menu-button')) return;
    const btn = $(`
        <div id="novelws-menu-button" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="เปิดหน้าเขียนนิยาย">
            <div class="fa-solid fa-feather-pointed extensionsMenuExtensionButton"></div>
            <span>Novel Workspace</span>
        </div>`);
    btn.on('click', () => {
        $('#extensionsMenu').hide();
        openWorkspace();
    });
    $('#extensionsMenu').append(btn);
    updateWandButtonVisibility();
}

const updateWandButtonVisibility = () => $('#novelws-menu-button').toggle(Boolean(getSetting('enabled')));

// ---------------------------------------------------------------- settings drawer

function loadSettingsUi() {
    const s = getSettings();
    $('#novelws_enabled').prop('checked', Boolean(s.enabled));
    $('#novelws_daily_goal').val(s.dailyGoal);
    $('#novelws_day_start').html(Array.from({ length: 13 }, (_, h) =>
        `<option value="${h}">${String(h).padStart(2, '0')}:00${h === 0 ? ' (เที่ยงคืน)' : ''}</option>`).join('')).val(String(s.dayStartHour));
    $('#novelws_show_ring').prop('checked', Boolean(s.showRing));
    $('#novelws_font').val(s.editorFont);
    $('#novelws_font_size').val(s.editorFontSize);
    $('#novelws_line_height').val(s.editorLineHeight);
    $('#novelws_width').val(s.editorWidth);
    $('#novelws_open').prop('disabled', !s.enabled);
    $('#novelws_ai_enabled').prop('checked', Boolean(s.aiEnabled));
    $('#novelws_ai_max_tokens').val(s.aiMaxTokens);
    $('#novelws_ai_max_chars').val(s.aiMaxChars);
    $('.novelws-ai-settings').toggle(Boolean(s.aiEnabled));
    populateApiProfiles();
    renderPromptEditors();
    updateRangeLabels();
}

const escText = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (v) => escText(v).replace(/"/g, '&quot;');

function populateApiProfiles() {
    let html = '<option value="">ใช้ API หลักของ SillyTavern</option>';
    for (const p of listProfiles()) {
        if (!p?.id) continue;
        html += `<option value="${escAttr(p.id)}">${escText(p.name || p.id)}</option>`;
    }
    const cur = getSetting('apiProfile') || '';
    $('#novelws_api_profile').html(html).val(cur);
    if ($('#novelws_api_profile').val() !== cur) $('#novelws_api_profile').val('');
}

function renderPromptEditors() {
    const stored = getSetting('prompts') || {};
    const html = Object.entries(PROMPT_DEFS).map(([id, def]) => {
        const val = typeof stored[id] === 'string' && stored[id].trim() ? stored[id] : def.default;
        const edited = typeof stored[id] === 'string' && stored[id].trim() && stored[id] !== def.default;
        return `<div class="novelws-prompt-item" data-prompt="${id}">
            <div class="novelws-prompt-head">
                <b>${escText(def.label)}</b>${edited ? ' <small class="novelws-muted">(แก้แล้ว)</small>' : ''}
                <button class="menu_button novelws-prompt-reset" data-prompt-reset="${id}" title="คืนค่าเริ่มต้น"><i class="fa-solid fa-rotate-left"></i> ค่าเริ่มต้น</button>
            </div>
            <textarea class="text_pole novelws-prompt-ta" data-prompt-id="${id}" rows="8">${escText(val)}</textarea>
            <small class="novelws-prompt-warn"></small>
        </div>`;
    }).join('');
    $('#novelws_prompt_list').html(html);
    $('#novelws_prompt_list .novelws-prompt-ta').each(function () { validatePromptUi(this); });
}

function validatePromptUi(ta) {
    const id = $(ta).attr('data-prompt-id');
    const { ok, missing } = validatePromptTemplate(id, $(ta).val());
    $(ta).siblings('.novelws-prompt-warn').text(ok ? '' : `⚠️ ขาดตัวแปรที่จำเป็น: ${missing.map(m => `{{${m}}}`).join(' ')}`);
}

function updateRangeLabels() {
    $('#novelws_font_size_val').text(`(${getSetting('editorFontSize')}px)`);
    $('#novelws_line_height_val').text(`(${Number(getSetting('editorLineHeight')).toFixed(1)})`);
    $('#novelws_width_val').text(`(${getSetting('editorWidth')}px)`);
}

function bindSettingsHandlers() {
    $(document).on('change', '#novelws_enabled', async function () {
        const on = $(this).prop('checked');
        setSetting('enabled', on);
        $('#novelws_open').prop('disabled', !on);
        updateWandButtonVisibility();
        if (!on) await teardown();
    });
    $(document).on('click', '#novelws_open', () => openWorkspace());

    // ---- AI helper
    $(document).on('change', '#novelws_ai_enabled', function () {
        setSetting('aiEnabled', $(this).prop('checked'));
        $('.novelws-ai-settings').toggle(Boolean(getSetting('aiEnabled')));
        if (getSetting('aiEnabled')) populateApiProfiles();
        refreshAiViews();
    });
    $(document).on('focus', '#novelws_api_profile', populateApiProfiles);   // pick up profiles made after load
    $(document).on('change', '#novelws_api_profile', function () {
        setSetting('apiProfile', String($(this).val() || ''));
        refreshAiViews();
    });
    $(document).on('change', '#novelws_ai_max_tokens', function () {
        const v = Math.min(16000, Math.max(100, Math.round(Number($(this).val()) || 1200)));
        $(this).val(v);
        setSetting('aiMaxTokens', v);
    });
    $(document).on('change', '#novelws_ai_max_chars', function () {
        const v = Math.min(400000, Math.max(2000, Math.round(Number($(this).val()) || 30000)));
        $(this).val(v);
        setSetting('aiMaxChars', v);
    });
    $(document).on('input', '.novelws-prompt-ta', function () {
        const id = $(this).attr('data-prompt-id');
        const prompts = { ...(getSetting('prompts') || {}) };
        const v = String($(this).val());
        if (v === PROMPT_DEFS[id].default) delete prompts[id]; else prompts[id] = v;
        setSetting('prompts', prompts);
        validatePromptUi(this);
    });
    $(document).on('click', '.novelws-prompt-reset', function () {
        const id = $(this).attr('data-prompt-reset');
        const prompts = { ...(getSetting('prompts') || {}) };
        delete prompts[id];
        setSetting('prompts', prompts);
        const ta = $(`.novelws-prompt-ta[data-prompt-id="${id}"]`);
        ta.val(PROMPT_DEFS[id].default);
        validatePromptUi(ta[0]);
        toastr.info(`คืนค่า "${PROMPT_DEFS[id].label}" แล้ว`, TITLE);
    });

    $(document).on('change', '#novelws_daily_goal', function () {
        const v = Math.max(1, Math.round(Number($(this).val()) || 0));
        $(this).val(v);
        setSetting('dailyGoal', v);
        refreshStatsViews();
    });
    $(document).on('change', '#novelws_day_start', function () {
        setSetting('dayStartHour', Number($(this).val()) || 0);
        refreshStatsViews();
    });
    $(document).on('change', '#novelws_show_ring', function () {
        setSetting('showRing', $(this).prop('checked'));
        refreshStatsViews();
    });
    $(document).on('change', '#novelws_font', function () {
        setSetting('editorFont', String($(this).val()));
        applyEditorPrefs();
    });
    const range = (sel, key) => $(document).on('input', sel, function () {
        setSetting(key, Number($(this).val()));
        updateRangeLabels();
        applyEditorPrefs();
    });
    range('#novelws_font_size', 'editorFontSize');
    range('#novelws_line_height', 'editorLineHeight');
    range('#novelws_width', 'editorWidth');
}

// ---------------------------------------------------------------- safety

function bindLifecycle() {
    // Best effort: the local draft in localStorage covers the case where this does not finish.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { flushProject(); flushStats(); }
    });
    window.addEventListener('beforeunload', () => { flushProject(); flushStats(); });
}

function registerSlashCommand() {
    try {
        const ctx = getContext();
        const { SlashCommandParser, SlashCommand } = ctx;
        if (!SlashCommandParser || !SlashCommand) return;
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'novel',
            callback: async () => {
                if (!getSetting('enabled')) { toastr.info('Novel Workspace ปิดอยู่', TITLE); return ''; }
                if (isWorkspaceOpen()) await closeWorkspace(); else await openWorkspace();
                return '';
            },
            helpString: 'เปิด/ปิดหน้าเขียนนิยาย (Novel Workspace)',
        }));
    } catch (e) {
        console.warn(LOG, 'ลงทะเบียน /novel ไม่สำเร็จ:', e);
    }
}

// ---------------------------------------------------------------- init

jQuery(async () => {
    console.log(LOG, 'กำลังโหลด...');
    try {
        getSettings();
        const html = await $.get(`${extensionFolderUrl}/settings.html`);
        $('#extensions_settings2').append(html);
        bindSettingsHandlers();
        loadSettingsUi();
        mountWandButton();
        bindLifecycle();
        registerSlashCommand();
        console.log(LOG, `✅ โหลดสำเร็จ (${extensionName})`);
    } catch (error) {
        console.error(LOG, '❌ โหลดไม่สำเร็จ:', error);
        toastr.error('โหลดไม่สำเร็จ (ดู console)', TITLE);
    }
});
