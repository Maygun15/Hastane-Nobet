// src/lib/requestParser.js
// Basit serbest metin -> yapılandırılmış istek dönüştürücü

const MONTHS_TR = {
  ocak: 1,
  şubat: 2,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayıs: 5,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  ağustos: 8,
  agustos: 8,
  eylül: 9,
  eylul: 9,
  ekim: 10,
  kasım: 11,
  kasim: 11,
  aralık: 12,
  aralik: 12,
};

const INTENT_KEYWORDS = {
  avoid: [/istemiyor/, /olm(?:asın|asin)/, /yasak/, /eğitimde/, /egitimde/, /operasyon/, /rapor/, /katılamaz/, /izinsiz bağlamak istemiyor/],
  prefer: [/istiyor/, /olsun/, /talep/, /mümkünse/, /mukünse/, /tercih/],
};

const SHIFT_KEYWORDS = {
  NOBET: [/nöbet/, /nobet/],
  OFF: [/boş gün/, /bos gun/, /izin/, /off/],
};

const DAY_RANGE_REGEX = /(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s+(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)/giu;

function canonName(str) {
  return (str || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("tr")
    .replace(/\s+/g, " ")
    .trim();
}

function detectIntent(text, fallbackType) {
  const lower = text.toLocaleLowerCase("tr");
  for (const [intent, regs] of Object.entries(INTENT_KEYWORDS)) {
    if (regs.some((re) => re.test(lower))) return intent;
  }
  if (fallbackType === "OFF") return "prefer";
  return "avoid"; // varsayılan olarak korumacı davran
}

function detectShift(text, fallbackType) {
  const lower = text.toLocaleLowerCase("tr");
  for (const [shift, regs] of Object.entries(SHIFT_KEYWORDS)) {
    if (regs.some((re) => re.test(lower))) return shift;
  }
  if (fallbackType === "OFF") return "OFF";
  if (fallbackType === "SHIFT") return "NOBET";
  return null;
}

export function parseRequestText({
  text = "",
  type = "NOTE",
  date,
  defaultYear,
  defaultMonth,
}) {
  const lower = text.toLocaleLowerCase("tr");
  const intent = detectIntent(lower, type);
  const shift = detectShift(lower, type);
  const segments = [];

  let match;
  while ((match = DAY_RANGE_REGEX.exec(lower))) {
    const startDay = Number(match[1]);
    const endDay = match[2] ? Number(match[2]) : startDay;
    const monthName = match[3];
    const month1 = MONTHS_TR[monthName.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("tr")];
    if (!Number.isFinite(startDay) || startDay < 1 || startDay > 31) continue;
    const month = month1 ?? defaultMonth;
    const year = defaultYear ?? (date ? new Date(date).getFullYear() : new Date().getFullYear());
    segments.push({
      startDay,
      endDay,
      month,
      year,
      intent,
      shift,
    });
  }

  if (!segments.length) {
    if (date) {
      const dt = new Date(date);
      segments.push({
        startDay: dt.getDate(),
        endDay: dt.getDate(),
        month: dt.getMonth() + 1,
        year: dt.getFullYear(),
        intent,
        shift,
      });
    } else if (defaultMonth && defaultYear) {
      segments.push({
        startDay: null,
        endDay: null,
        month: defaultMonth,
        year: defaultYear,
        intent,
        shift,
      });
    }
  }

  return { intent, shift, segments };
}

const LS_KEY = "requestBoxV1";

function ensureRange(seg) {
  if (seg.startDay == null || seg.startDay < 1) seg.startDay = 1;
  if (seg.endDay == null || seg.endDay < seg.startDay) seg.endDay = seg.startDay;
  const clamp = (v) => Math.min(Math.max(v, 1), 31);
  seg.startDay = clamp(seg.startDay);
  seg.endDay = clamp(seg.endDay);
  return seg;
}

export function collectRequestsByPerson({ year, month1, strictMonth = true } = {}) {
  let raw = [];
  try {
    raw = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    if (!Array.isArray(raw)) raw = [];
  } catch {
    raw = [];
  }

  const refYear = Number(year) || new Date().getFullYear();
  const refMonth = Number(month1) || new Date().getMonth() + 1;

  const byPerson = {};

  const addSegment = (meta, seg) => {
    const canon = meta.canon;
    if (!canon) return;
    const bucket = (byPerson[canon] ||= {
      personId: meta.personId || null,
      personName: meta.personName || null,
      avoid: [],
      prefer: [],
    });
    const target = seg.intent === "avoid" ? bucket.avoid : bucket.prefer;
    target.push(ensureRange({
      startDay: seg.startDay,
      endDay: seg.endDay,
      month: seg.month,
      year: seg.year,
      shift: seg.shift || null,
    }));
  };

  for (const item of raw) {
    const text = item?.text || "";
    const meta = {
      personId: item?.personId || null,
      personName: item?.personName || "",
      canon: item?.personName ? canonName(item.personName) : null,
    };

    let analysis = item?.analysis;
    if (!analysis || !Array.isArray(analysis.segments) || !analysis.segments.length) {
      analysis = parseRequestText({
        text,
        type: item?.type || "NOTE",
        date: item?.date || null,
        defaultYear: refYear,
        defaultMonth: refMonth,
      });
    }

    if (!analysis || !analysis.segments) continue;
    for (const seg of analysis.segments) {
      const segYear = seg.year || refYear;
      const segMonth = seg.month || refMonth;
      if (strictMonth && (segYear !== refYear || segMonth !== refMonth)) continue;
      addSegment(meta, {
        intent: seg.intent || analysis.intent,
        shift: seg.shift || analysis.shift || null,
        startDay: seg.startDay ?? null,
        endDay: seg.endDay ?? null,
        month: segMonth,
        year: segYear,
      });
    }
  }

  return { byPerson, raw };
}
