// src/api/parse.service.js

// "1-3" gibi aralıkları YYYY-MM-DD listesine çevirir
const DAY_RANGE_RE = /\b(\d{1,2})\s*-\s*(\d{1,2})\b/i;

function expandDaysFromInput(activeYM, rawText) {
  const m = rawText?.match?.(DAY_RANGE_RE);
  if (!m) return [];
  const start = Number(m[1]);
  const end   = Number(m[2]);
  const days = [];
  for (let d = start; d <= end; d++) {
    const dd = String(d).padStart(2, '0');
    days.push(`${activeYM}-${dd}`);
  }
  return days;
}

/**
 * Girdi → normalize edilmiş payload
 * input: { rawText, activeYM, personId?, locale? }
 * output: parsed-request.schema.json ile uyumlu bir obje
 */
async function parseRequest({ rawText, activeYM, personId, locale = 'tr-TR' }) {
  if (!rawText) throw new Error('rawText boş olamaz');
  if (!activeYM) throw new Error('activeYM (YYYY-MM) gerekli');

  const items = [];
  const days  = expandDaysFromInput(activeYM, rawText);

  // Basit kurallar (ileride genişleteceğiz):
  // - metinde "izin" geçiyorsa belirtilen günleri BLOCK (LEAVE) yap
  // - metinde "fazla mesai" veya "mesai" geçerse OVERTIME örnek kaydı ekle (opsiyonel)
  const wantsLeave = /izin/i.test(rawText);
  if (wantsLeave && days.length) {
    for (const date of days) {
      items.push({
        kind: 'BLOCK',           // schema: BlockItem
        type: 'LEAVE',
        date,
        meta: { source: 'nlp-simple' }
      });
    }
  }

  // örnek: "mesai" geçtiyse gün başına 1 saat fazla mesai (isteğe bağlı)
  const wantsOvertime = /(fazla\s*mesai|mesai)/i.test(rawText);
  if (wantsOvertime && days.length) {
    for (const date of days) {
      items.push({
        kind: 'OVERTIME',        // schema: OvertimeItem
        hours: 1,
        date,
        meta: { source: 'nlp-simple' }
      });
    }
  }

  // örnek: "gündüz" / "gece" tercihleri
  if (/gündüz/i.test(rawText)) {
    items.push({
      kind: 'SHIFT_PREFERENCE',  // schema: ShiftPreferenceItem
      code: 'DAY',
      meta: { source: 'nlp-simple' }
    });
  }
  if (/gece/i.test(rawText)) {
    items.push({
      kind: 'SHIFT_PREFERENCE',
      code: 'NIGHT',
      meta: { source: 'nlp-simple' }
    });
  }

  return {
    schemaVersion: '1.0.0',
    personId: personId || null,
    locale,
    activeYM,
    items
  };
}

module.exports = { parseRequest };
