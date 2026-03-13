const axios = require('axios');
const Holiday = require('../models/Holiday');
const CalendarSetting = require('../models/CalendarSetting');
const { getReligiousHolidays } = require('./religiousHolidayService');

const NAGER_URL = (year) => `https://date.nager.at/api/v3/PublicHolidays/${year}/TR`;

const norm = (s) => String(s || '').toLowerCase();
const normalizeText = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const pad2 = (n) => String(n).padStart(2, '0');
const dateMinusOne = (dateStr) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

async function fetchNager(year) {
  const res = await axios.get(NAGER_URL(year), { timeout: 20000 });
  const list = Array.isArray(res.data) ? res.data : [];
  return list.map((h) => ({
    date: h.date, // YYYY-MM-DD
    name: h.localName || h.name || '',
    globalName: h.name || '',
  }));
}

function buildArifeEntries(items) {
  const ramazan = items.filter((h) => norm(h.name).includes('ramazan'));
  const kurban = items.filter((h) => norm(h.name).includes('kurban'));
  const earliest = (arr) => arr.map((x) => x.date).sort()[0];
  const out = [];
  const rDate = earliest(ramazan);
  if (rDate) {
    const arife = dateMinusOne(rDate);
    if (arife) out.push({ date: arife, kind: 'arife', name: 'Ramazan Bayramı Arifesi' });
  }
  const kDate = earliest(kurban);
  if (kDate) {
    const arife = dateMinusOne(kDate);
    if (arife) out.push({ date: arife, kind: 'arife', name: 'Kurban Bayramı Arifesi' });
  }
  return out;
}

function buildHalfDayEntries(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return [];
  // 28 Ekim öğleden sonra yarım gün tatil
  return [
    {
      date: `${y}-10-28`,
      kind: 'half',
      name: 'Cumhuriyet Bayramı Arifesi (Öğleden sonra)',
    },
  ];
}

function inferHolidayKind(row = {}) {
  const kind = String(row?.kind || '').toLowerCase().trim();
  const name = normalizeText(row?.name || row?.localName || row?.globalName || '');

  // İsmi "arife" ise yarım gün statüsü korunur.
  if (name.includes('arife')) return 'arife';

  // Bayram günleri her zaman tam gün sayılır.
  if (name.includes('bayram')) return 'full';

  if (kind === 'full' || kind === 'arife' || kind === 'half') return kind;
  if (name.includes('ogleden sonra') || name.includes('yarim gun') || name.includes('half')) return 'half';
  return 'full';
}

function toYmd(raw) {
  if (!raw) return '';
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function inferCalendarSettingKind(row = {}) {
  const type = normalizeText(row?.type || '');
  const isHoliday = row?.isHoliday;
  const affectWorkingHours = row?.affectWorkingHours;

  if (isHoliday === false) return null;
  if (type === 'working_day') return null;
  if (affectWorkingHours === false) return null;

  return inferHolidayKind({
    kind: row?.kind || '',
    name: row?.name || row?.description || '',
  });
}

async function generateHolidays(year, { hospitalId = null } = {}) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) {
    throw new Error('Yıl geçersiz');
  }

  const items = await fetchNager(y);
  const arifeItems = buildArifeEntries(items);
  const halfItems = buildHalfDayEntries(y);
  const religious = await getReligiousHolidays(y);

  const toInsert = [];
  for (const h of items) {
    if (!h.date) continue;
    toInsert.push({
      date: h.date,
      kind: 'full',
      name: h.name,
      source: 'nager',
      year: y,
    });
  }
  for (const a of arifeItems) {
    toInsert.push({
      date: a.date,
      kind: 'arife',
      name: a.name,
      source: 'nager',
      year: y,
    });
  }
  for (const h of halfItems) {
    toInsert.push({
      date: h.date,
      kind: 'half',
      name: h.name,
      source: 'rule',
      year: y,
    });
  }
  for (const r of religious) {
    const rk = r.kind === 'arife' ? 'arife' : r.kind === 'half' ? 'half' : 'full';
    toInsert.push({
      date: r.date,
      kind: rk,
      name: r.name || '',
      source: 'aladhan',
      year: y,
    });
  }

  if (!toInsert.length) return [];

  const ops = toInsert.map((doc) => ({
    updateOne: {
      filter: hospitalId ? { hospitalId, date: doc.date } : { date: doc.date },
      update: {
        $setOnInsert: hospitalId ? { ...doc, hospitalId } : doc,
      },
      upsert: true,
    },
  }));

  const result = await Holiday.bulkWrite(ops, { ordered: false });
  const added = result.upsertedCount || 0;
  return { added, total: toInsert.length };
}

async function listHolidays({ year, month, hospitalId = null } = {}) {
  const y = Number(year);
  const m = Number(month);
  const qHoliday = hospitalId ? { hospitalId } : {};
  const qCal = hospitalId ? { hospitalId } : {};
  if (Number.isFinite(y)) qHoliday.year = y;
  if (Number.isFinite(y)) qCal.year = y;
  if (Number.isFinite(m)) {
    const mm = pad2(m);
    qHoliday.date = new RegExp(`^${y}-${mm}-`);
    qCal.month = m;
  }
  const [holidays, calendarSettings] = await Promise.all([
    Holiday.find(qHoliday).sort({ date: 1 }).lean(),
    CalendarSetting.find(qCal).sort({ updatedAt: 1, createdAt: 1, _id: 1 }).lean(),
  ]);

  const byDate = new Map();
  for (const row of holidays || []) {
    const date = toYmd(row?.date);
    if (!date) continue;
    byDate.set(date, {
      ...row,
      date,
      kind: inferHolidayKind(row),
    });
  }

  // Parametreler > Takvim girdileri Holiday kaynağını override eder.
  for (const row of calendarSettings || []) {
    const date = toYmd(row?.date);
    if (!date) continue;
    const kind = inferCalendarSettingKind(row);
    if (!kind) {
      byDate.delete(date);
      continue;
    }
    byDate.set(date, {
      date,
      name: String(row?.name || row?.description || ''),
      kind,
      source: 'parameters-calendar',
      year: Number.isFinite(y) ? y : Number(String(date).slice(0, 4)),
    });
  }

  return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function upsertHoliday({ date, kind, name, source = 'manual', hospitalId = null }) {
  if (!date) throw new Error('date gerekli');
  const y = Number(String(date).slice(0, 4));
  const k = kind === 'arife' ? 'arife' : kind === 'half' ? 'half' : 'full';
  return Holiday.findOneAndUpdate(
    hospitalId ? { hospitalId, date } : { date },
    { $set: hospitalId ? { hospitalId, date, kind: k, name: name || '', source, year: y } : { date, kind: k, name: name || '', source, year: y } },
    { upsert: true, new: true }
  ).lean();
}

async function deleteHoliday(date, { hospitalId = null } = {}) {
  if (!date) throw new Error('date gerekli');
  return Holiday.findOneAndDelete(hospitalId ? { hospitalId, date } : { date }).lean();
}

module.exports = {
  generateHolidays,
  listHolidays,
  upsertHoliday,
  deleteHoliday,
};
