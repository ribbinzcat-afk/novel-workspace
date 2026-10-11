// The ONLY place in this extension that talks to an AI. Connection Profile first, ST main API as fallback.
import { getContext } from '../../../../extensions.js';
import { getSetting, LOG } from './store.js';

export const lastCalls = {};   // label -> { breakdown, total, ts, maxTokens, replyTokens }

export async function countTokens(text) {
    text = String(text || '');
    if (!text) return 0;
    const ctx = getContext();
    try {
        if (typeof ctx.getTokenCountAsync === 'function') {
            const n = await ctx.getTokenCountAsync(text);
            if (typeof n === 'number' && n >= 0) return n;
        } else if (typeof ctx.getTokenCount === 'function') {
            const n = ctx.getTokenCount(text);
            if (typeof n === 'number' && n >= 0) return n;
        }
    } catch (e) { console.warn(LOG, 'countTokens ล้มเหลว:', e); }
    return Math.ceil(text.length / 4);
}

/** Count every part with ST's tokenizer. Called BEFORE sending so the user sees the size first. */
export async function measure(parts) {
    const breakdown = {};
    let total = 0;
    for (const [name, text] of Object.entries(parts || {})) {
        const n = await countTokens(text);
        breakdown[name] = n;
        total += n;
    }
    return { breakdown, total };
}

export function aiAllowed() {
    return Boolean(getSetting('enabled') && getSetting('aiEnabled'));
}

/**
 * @param {string} label   tool id, for lastCalls
 * @param {string} system  system prompt
 * @param {string} prompt  user prompt
 * @param {object} measured result of measure() for this exact prompt
 */
export async function generate(label, system, prompt, measured) {
    if (!aiAllowed()) return '';
    const ctx = getContext();
    const maxTokens = Number(getSetting('aiMaxTokens')) || 1200;
    lastCalls[label] = { ...measured, ts: Date.now(), maxTokens, replyTokens: 0 };

    let content = '';
    const profileId = getSetting('apiProfile');
    if (profileId && ctx.ConnectionManagerRequestService) {
        try {
            const messages = [
                { role: 'system', content: system },
                { role: 'user', content: prompt },
            ];
            // includePreset:false keeps roleplay presets/jailbreaks out of an editing tool.
            const res = await ctx.ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens, { stream: false, includePreset: false });
            content = res && typeof res.content === 'string' ? res.content : '';
            if (!content) console.warn(LOG, 'profile ตอบว่าง — fallback API หลัก');
        } catch (e) {
            console.error(LOG, 'profile request ล้มเหลว — fallback API หลัก:', e);
        }
    }
    if (!content) {
        if (typeof ctx.generateRaw === 'function') {
            // generateRaw = no character card / chat history mixed in.
            content = await ctx.generateRaw({ prompt, systemPrompt: system, responseLength: maxTokens });
        } else if (typeof ctx.generateQuietPrompt === 'function') {
            content = await ctx.generateQuietPrompt({ quietPrompt: `${system}\n\n${prompt}`, responseLength: maxTokens });
        } else {
            throw new Error('เวอร์ชัน SillyTavern นี้ไม่รองรับการเรียก AI แบบเงียบ');
        }
    }
    const clean = stripReasoning(content);
    lastCalls[label].replyTokens = await countTokens(clean);
    return clean;
}

export const stripReasoning = (raw) =>
    String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();

export function listProfiles() {
    try {
        return (getContext().extensionSettings.connectionManager || {}).profiles || [];
    } catch (e) {
        console.warn(LOG, 'Connection Manager ไม่พร้อม:', e);
        return [];
    }
}
