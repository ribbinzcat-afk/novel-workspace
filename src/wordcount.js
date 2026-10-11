// deps = 0. Rough word counting that works for Thai (no spaces between words).

let segmenter = null;
try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    }
} catch { segmenter = null; }

/**
 * Counts words. Thai is split by the browser's dictionary-based segmenter; English and
 * other languages are split on spaces by the same segmenter. Punctuation is ignored.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
    text = String(text || '');
    if (!text.trim()) return 0;
    if (segmenter) {
        let n = 0;
        for (const seg of segmenter.segment(text)) {
            if (seg.isWordLike) n++;
        }
        return n;
    }
    // Fallback for very old browsers: Latin words by spaces, Thai roughly 1 word per 4 chars.
    const latin = (text.match(/[A-Za-z0-9À-ɏ]+/g) || []).length;
    const thai = (text.match(/[฀-๿]/g) || []).length;
    return latin + Math.round(thai / 4);
}

/** Characters without whitespace. */
export function countChars(text) {
    return String(text || '').replace(/\s/g, '').length;
}

export const formatNum = (n) => Number(n || 0).toLocaleString('th-TH');
