// deps = SillyTavern core only. Settings (small, per-user preferences).
// Novel text lives in separate JSON files (see storage.js), never in settings.json.
import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

/** Key in extension_settings. Fixed, so it does not depend on the install folder name. */
export const extensionName = 'novel_workspace';
export const LOG = '[novel-workspace]';

/**
 * Folder URL derived from this module's own location, so the extension works whether it was
 * installed as `novel-workspace` (GitHub) or `novel workspace` (manual copy).
 */
export const extensionFolderUrl = new URL('..', import.meta.url).href.replace(/\/$/, '');

export const defaultSettings = {
    enabled: true,
    dailyGoal: 1000,
    dayStartHour: 4,          // a "day" starts at this hour — writing at 2am counts for yesterday
    showRing: true,
    editorFont: 'theme',      // theme | serif | sans
    editorFontSize: 18,
    editorLineHeight: 1.9,
    editorWidth: 760,         // max px of the page column (it still shrinks on small screens)
    lastProjectId: '',
    lastEpisodeId: '',
    lastTab: 'write',
};

export function getSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    for (const k of Object.keys(defaultSettings)) {
        if (s[k] === undefined) s[k] = structuredClone(defaultSettings[k]);
    }
    return s;
}

export const getSetting = (k) => getSettings()[k];

export function setSetting(k, v) {
    getSettings()[k] = v;
    saveSettingsDebounced();
}
