const axios = require('axios');
const Holiday = require('../models/Holiday');
const { getReligiousHolidays } = require('./religiousHolidayService');

const NAGER_URL = (year) => `https://date.nager.at/api/v3/PublicHolidays/${year}/TR`;

const norm = (s) => String(s || '').toLowerCase();
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

async function generateHolidays(year) {
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
      filter: { date: doc.date },
      update: { $setOnInsert: doc },
      upsert: true,
    },
  }));

  const result = await Holiday.bulkWrite(ops, { ordered: false });
  const added = result.upsertedCount || 0;
  return { added, total: toInsert.length };
}

async function listHolidays({ year, month } = {}) {
  const y = Number(year);
  const m = Number(month);
  const q = {};
  if (Number.isFinite(y)) q.year = y;
  if (Number.isFinite(m)) {
    const mm = pad2(m);
    q.date = new RegExp(`^${y}-${mm}-`);
  }
  return Holiday.find(q).sort({ date: 1 }).lean();
}

async function upsertHoliday({ date, kind, name, source = 'manual' }) {
  if (!date) throw new Error('date gerekli');
  const y = Number(String(date).slice(0, 4));
  const k = kind === 'arife' ? 'arife' : kind === 'half' ? 'half' : 'full';
  return Holiday.findOneAndUpdate(
    { date },
    { $set: { date, kind: k, name: name || '', source, year: y } },
    { upsert: true, new: true }
  ).lean();
}

async function deleteHoliday(date) {
  if (!date) throw new Error('date gerekli');
  return Holiday.findOneAndDelete({ date }).lean();
}

module.exports = {
  generateHolidays,
  listHolidays,
  upsertHoliday,
  deleteHoliday,
};
