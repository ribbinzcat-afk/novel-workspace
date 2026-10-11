// deps = 0. Every instruction sent to the AI. All of them can be edited in the Extensions drawer.
// {{token}} placeholders are this extension's own (not ST macros).

const RULES = `กฎ:
- ห้ามเขียนเนื้อเรื่องต่อ และห้ามเขียนต้นฉบับใหม่ทั้งย่อหน้าแทนผู้เขียน
- ตอบเป็นภาษาไทย กระชับ เป็นข้อ ๆ อ้างถึงประโยคในต้นฉบับเมื่อชี้จุด`;

export const PROMPT_DEFS = {
    system: {
        label: 'System prompt (ใช้กับทุกเครื่องมือ)',
        tokens: [],
        default: `คุณคือบรรณาธิการนิยายมืออาชีพที่ช่วยนักเขียนพัฒนางานของตัวเอง นักเขียนเป็นคนเขียนเองทั้งหมด หน้าที่ของคุณคือให้ความเห็น ตั้งคำถาม และชี้จุดที่ควรพิจารณา ไม่ใช่เขียนแทน`,
    },
    critique: {
        label: 'วิจารณ์ฉากนี้',
        icon: 'fa-comment-dots',
        tokens: ['text'],
        default: `[งาน: วิจารณ์ต้นฉบับ]
ต่อไปนี้คือส่วนหนึ่งของนิยายเรื่อง "{{title}}" ({{scope}})

<treatment ของตอนนี้>
{{treatment}}
</treatment>

<ต้นฉบับ>
{{text}}
</ต้นฉบับ>

ให้ความเห็นแบบบรรณาธิการในหัวข้อเหล่านี้ (ข้ามหัวข้อที่ไม่มีอะไรจะพูด):
1. จุดแข็ง 2–3 ข้อ
2. จังหวะและความลื่นไหล
3. บทสนทนาและน้ำเสียงตัวละคร
4. ภาพ บรรยากาศ การใช้ภาษา (คำซ้ำ สำนวนจำเจ ประโยคที่อ่านสะดุด)
5. ข้อเสนอแนะที่ทำได้ทันที 3 ข้อ

${RULES}`,
    },
    continuity: {
        label: 'เช็กความต่อเนื่องกับ Treatment',
        icon: 'fa-link',
        tokens: ['text', 'treatment'],
        default: `[งาน: ตรวจความต่อเนื่อง]
ข้อมูลเรื่อง "{{title}}"

<ภาพรวมเรื่อง>
{{overview}}
</ภาพรวมเรื่อง>

<treatment ของตอนนี้>
{{treatment}}
</treatment>

<ต้นฉบับ ({{scope}})>
{{text}}
</ต้นฉบับ>

ตรวจหาจุดที่ต้นฉบับขัดกับภาพรวมเรื่องหรือ treatment เช่น ชื่อ/นิสัย/ความสัมพันธ์ตัวละคร สถานที่ ลำดับเวลา POV กฎของโลก หรือข้อมูลที่ตัวละครไม่ควรรู้
ตอบเป็นรายการ: [จุดที่ขัด] — [อ้างอิงในต้นฉบับ] — [ขัดกับข้อมูลไหน]
ถ้าไม่พบให้ตอบว่า "ไม่พบจุดขัดแย้ง" แล้วบอกสิ่งที่ควรระวังในตอนถัดไป 1–2 ข้อ

${RULES}`,
    },
    goalcheck: {
        label: 'ตอนนี้ตรงเป้าที่วางไว้ไหม',
        icon: 'fa-bullseye',
        tokens: ['text', 'treatment'],
        default: `[งาน: เทียบต้นฉบับกับแผนของตอน]
<treatment ของตอนนี้>
{{treatment}}
</treatment>

<ต้นฉบับ ({{scope}})>
{{text}}
</ต้นฉบับ>

ทำเช็กลิสต์ทีละเหตุการณ์ใน treatment ว่า ✅ ครบ / ⚠️ มีแต่ยังอ่อน / ❌ ยังไม่มี พร้อมเหตุผลสั้น ๆ
จากนั้นประเมินว่า hook ท้ายตอนทำงานหรือยัง และถ้ายังไม่ครบ ควรเติมอะไร (บอกเป็นแนวทาง ไม่ต้องเขียนให้)

${RULES}`,
    },
    wording: {
        label: 'หาคำ / สำนวนอื่น',
        icon: 'fa-spell-check',
        tokens: ['text'],
        default: `[งาน: หาคำและสำนวนทางเลือก]
ข้อความที่ผู้เขียนเลือก:
"{{text}}"

บริบทรอบ ๆ:
{{context}}

เสนอทางเลือก 5–8 แบบสำหรับข้อความที่เลือก เรียงจากใกล้ความหมายเดิมที่สุด แต่ละแบบบอกสั้น ๆ ว่าให้น้ำเสียงหรืออารมณ์ต่างจากเดิมอย่างไร
ถ้าข้อความเป็นคำเดียว ให้เสนอคำพ้องและคำใกล้เคียงที่เข้ากับบริบท
ตอบเป็นภาษาไทย เป็นรายการ`,
    },
    ask: {
        label: 'ถามเอง',
        icon: 'fa-circle-question',
        tokens: ['question', 'text'],
        default: `[งาน: ตอบคำถามของผู้เขียน]
นิยายเรื่อง "{{title}}"

<ภาพรวมเรื่อง>
{{overview}}
</ภาพรวมเรื่อง>

<treatment ของตอนนี้>
{{treatment}}
</treatment>

<ต้นฉบับ ({{scope}})>
{{text}}
</ต้นฉบับ>

คำถามของผู้เขียน: {{question}}

${RULES}`,
    },
};

/** Tools shown in the AI panel, in order. */
export const TOOL_IDS = ['critique', 'continuity', 'goalcheck', 'wording', 'ask'];

export function getTemplate(id, stored) {
    const v = stored?.[id];
    return typeof v === 'string' && v.trim() ? v : PROMPT_DEFS[id].default;
}

export function buildPrompt(id, vars, stored) {
    let out = getTemplate(id, stored);
    for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(String(v ?? ''));
    return out;
}

export function validatePromptTemplate(id, text) {
    const missing = PROMPT_DEFS[id].tokens.filter(t => !String(text).includes(`{{${t}}}`));
    return { ok: missing.length === 0, missing };
}
