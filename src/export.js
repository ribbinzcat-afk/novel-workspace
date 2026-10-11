// deps = 0 (besides the project shape). Builds manuscript / treatment files: .md, .txt, .docx.
// The .docx writer is self-contained: minimal WordprocessingML packed in an uncompressed ZIP.

const STATUS_TH = { plan: 'วางโครง', writing: 'กำลังเขียน', revising: 'แก้ไข', done: 'เสร็จ', published: 'เผยแพร่แล้ว' };

export const safeFileName = (s) => String(s || 'novel').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'novel';

export function episodeHeading(template, ep, n) {
    let title = String(ep.title || '').trim();
    // A default title like "ตอนที่ 3" would read "ตอนที่ 3: ตอนที่ 3" — drop it.
    if (title === `ตอนที่ ${n}`) title = '';
    let out = String(template || 'ตอนที่ {n}: {title}')
        .split('{n}').join(String(n))
        .split('{title}').join(title);
    if (!title) out = out.replace(/[\s:：\-–—|·]+$/u, '');
    return out.trim() || `ตอนที่ ${n}`;
}

/**
 * Normalised document model shared by all formats.
 * @returns {{title:string, blocks:{type:'title'|'h1'|'h2'|'p'|'break'|'label', text:string}[]}}
 */
export function manuscriptModel(project, episodes, opts) {
    const blocks = [];
    if (opts.includeTitle) blocks.push({ type: 'title', text: project.title });
    episodes.forEach((ep, i) => {
        if (i > 0 || opts.includeTitle) blocks.push({ type: 'break', text: '' });
        const n = project.episodes.indexOf(ep) + 1;
        blocks.push({ type: 'h1', text: episodeHeading(opts.heading, ep, n) });
        for (const line of String(ep.text || '').replace(/\r\n?/g, '\n').split('\n')) blocks.push({ type: 'p', text: line });
    });
    return { title: project.title, blocks };
}

export function treatmentModel(project, episodes) {
    const blocks = [{ type: 'title', text: `${project.title} — Treatment` }];
    const o = project.overview || {};
    const section = (label, text) => {
        if (!String(text || '').trim()) return;
        blocks.push({ type: 'label', text: label });
        for (const line of String(text).split('\n')) blocks.push({ type: 'p', text: line });
    };
    blocks.push({ type: 'h1', text: 'ภาพรวมเรื่อง' });
    section('Logline', o.logline);
    section('แนว / กลุ่มผู้อ่าน', o.genre);
    section('เรื่องย่อ / Premise', o.premise);
    section('ตัวละครหลัก', o.characters);
    section('โลก / ฉาก', o.world);
    section('โน้ต', o.notes);
    episodes.forEach((ep) => {
        const n = project.episodes.indexOf(ep) + 1;
        const t = ep.treatment || {};
        blocks.push({ type: 'h1', text: episodeHeading('ตอนที่ {n}: {title}', ep, n) });
        blocks.push({ type: 'p', text: `สถานะ: ${STATUS_TH[ep.status] || ep.status} · ${ep.words || 0} คำ${ep.target ? ` / เป้า ${ep.target}` : ''}` });
        section('เรื่องย่อ', t.summary);
        const beats = String(t.beats || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (beats.length) {
            blocks.push({ type: 'label', text: 'ลำดับเหตุการณ์' });
            beats.forEach((b, i) => blocks.push({ type: 'p', text: `${i + 1}. ${b}` }));
        }
        section('POV', t.pov);
        section('สถานที่', t.location);
        section('ตัวละครที่ปรากฏ', t.characters);
        section('Hook ท้ายตอน', t.hook);
        section('โน้ต', t.notes);
    });
    return { title: project.title, blocks };
}

// ------------------------------------------------------------------ text formats

export function toMarkdown(model) {
    const out = [];
    for (const b of model.blocks) {
        if (b.type === 'title') out.push(`# ${b.text}`, '');
        else if (b.type === 'h1') out.push(`## ${b.text}`, '');
        else if (b.type === 'label') out.push('', `**${b.text}**`, '');
        else if (b.type === 'break') { if (out.length) out.push('', '---', ''); }
        else out.push(b.text === '' ? '' : `${b.text}  `); // two spaces = keep the line break
    }
    return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

export function toPlainText(model) {
    const out = [];
    for (const b of model.blocks) {
        if (b.type === 'title') out.push(b.text, '='.repeat(Math.min(40, Math.max(8, b.text.length))), '');
        else if (b.type === 'h1') out.push(b.text, '');
        else if (b.type === 'label') out.push('', `[${b.text}]`);
        else if (b.type === 'break') { if (out.length) out.push('', ''); }
        else out.push(b.text);
    }
    return out.join('\n').trim() + '\n';
}

// ------------------------------------------------------------------ docx

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    // strip characters that are illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function run(text) {
    return `<w:r><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}

/**
 * @param {{blocks:any[]}} model
 * @param {{font?:string, size?:number, indent?:boolean, pageBreak?:boolean}} opts
 * @returns {Blob}
 */
export function toDocx(model, opts = {}) {
    const font = xmlEsc(opts.font || 'TH Sarabun New');
    const half = Math.round((Number(opts.size) || 16) * 2); // docx sizes are in half-points
    let body = '';
    for (const b of model.blocks) {
        if (b.type === 'title') body += `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(b.text)}</w:p>`;
        else if (b.type === 'h1') body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(b.text)}</w:p>`;
        else if (b.type === 'label') body += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run(b.text)}</w:p>`;
        else if (b.type === 'break') body += opts.pageBreak !== false ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '<w:p/>';
        else body += b.text === '' ? '<w:p/>' : `<w:p>${run(b.text)}</w:p>`;
    }
    const indent = opts.indent ? '<w:ind w:firstLine="720"/>' : '';
    const rFonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;

    const files = {
        '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
        '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
        'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
        'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
 <w:rPrDefault><w:rPr>${rFonts}<w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:lang w:val="th-TH" w:bidi="th-TH"/></w:rPr></w:rPrDefault>
 <w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr>${indent}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
 <w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="480"/><w:ind w:firstLine="0"/></w:pPr>
 <w:rPr><w:b/><w:bCs/><w:sz w:val="${half * 2}"/><w:szCs w:val="${half * 2}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
 <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="240"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr>
 <w:rPr><w:b/><w:bCs/><w:sz w:val="${Math.round(half * 1.4)}"/><w:szCs w:val="${Math.round(half * 1.4)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
 <w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr>
 <w:rPr><w:b/><w:bCs/></w:rPr></w:style>
</w:styles>`,
        'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>
</w:document>`,
    };
    return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ------------------------------------------------------------------ minimal ZIP (store, no compression)

let crcTable = null;
function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    for (const [name, content] of Object.entries(files)) {
        const nameBytes = enc.encode(name);
        const data = enc.encode(content);
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);   // UTF-8 names
        local.setUint16(8, 0, true);        // store
        local.setUint16(10, dosTime, true);
        local.setUint16(12, dosDate, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);
        chunks.push(new Uint8Array(local.buffer), nameBytes, data);

        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true);
        cen.setUint16(4, 20, true);
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(10, 0, true);
        cen.setUint16(12, dosTime, true);
        cen.setUint16(14, dosDate, true);
        cen.setUint32(16, crc, true);
        cen.setUint32(20, data.length, true);
        cen.setUint32(24, data.length, true);
        cen.setUint16(28, nameBytes.length, true);
        cen.setUint32(42, offset, true);
        central.push(new Uint8Array(cen.buffer), nameBytes);
        offset += 30 + nameBytes.length + data.length;
    }
    const cenSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Object.keys(files).length, true);
    end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const total = all.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
}

// ------------------------------------------------------------------ download

export function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * @param {'md'|'txt'|'docx'} format
 * @returns {{blob: Blob, ext: string}}
 */
export function render(model, format, opts) {
    if (format === 'docx') return { blob: toDocx(model, opts), ext: 'docx' };
    if (format === 'txt') return { blob: new Blob(['﻿' + toPlainText(model)], { type: 'text/plain;charset=utf-8' }), ext: 'txt' };
    return { blob: new Blob([toMarkdown(model)], { type: 'text/markdown;charset=utf-8' }), ext: 'md' };
}
