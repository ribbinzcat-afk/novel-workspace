// Novel Workspace — turns SillyTavern into a full-screen novel writing room.
// Bootstrap only: settings drawer, main switch, wand button. Features live in src/.
import { getContext } from '../../../extensions.js';
import { extensionName, extensionFolderUrl, getSettings, getSetting, setSetting, LOG } from './src/store.js';
import { openWorkspace, closeWorkspace, teardown, applyEditorPrefs, refreshStatsViews, isWorkspaceOpen } from './src/workspace.js';
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
    updateRangeLabels();
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
