'use strict';

// Personel tercih talepleri (Request.type = 'tercih') → çizelge motoru girdisi.
//
// Tercih türleri (Request.preferenceKind):
//   off      — "Bu gün(ler) çalışmak istemiyorum"
//   noNight  — "Bu gün(ler) gece nöbeti istemiyorum"
//   want     — "Bu gün(ler) çalışmak istiyorum"
//
// Kural (docs/ROADMAP.md, 02 — puanlı + sorumlu onaylı hibrit):
//   - Sorumlunun ONAYLADIĞI off / noNight → kesin kural (motor o güne yazmaz).
//   - Bekleyen (onaysız) off / noNight → tercih: motor mümkünse kaçınır (ceza puanı).
//   - want → her durumda tercih (puan avantajı), kesin kural değil.
//   - Reddedilen ve silinen talepler yok sayılır.
//   - preferenceKind'ı olmayan eski serbest metin tercihleri yok sayılır.

const Request = require('../models/Request');

const PREFERENCE_KINDS = Object.freeze({
  OFF: 'off',
  NO_NIGHT: 'noNight',
  WANT: 'want',
});
const VALID_KINDS = new Set(Object.values(PREFERENCE_KINDS));

function normalizePreferenceKind(value) {
  const raw = String(value || '').trim();
  if (VALID_KINDS.has(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower === 'nonight' || lower === 'no_night' || lower === 'no-night') return PREFERENCE_KINDS.NO_NIGHT;
  if (lower === 'off' || lower === 'want') return lower;
  return '';
}

function monthBounds(year, month) {
  const mm = String(month).padStart(2, '0');
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/** [start, end] aralığındaki ve verilen aya düşen günleri YYYY-MM-DD olarak döner. */
function expandDatesInMonth(startStr, endStr, year, month) {
  const start = String(startStr || '').slice(0, 10);
  const end = String(endStr || '').slice(0, 10) || start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return [];
  const bounds = monthBounds(year, month);
  const from = start > bounds.start ? start : bounds.start;
  const to = end < bounds.end ? end : bounds.end;
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (key > to) break;
    out.push(key);
    if (out.length > 31) break;
  }
  return out;
}

function emptyBucket() {
  return { hardOff: [], hardNoNight: [], softOff: [], softNoNight: [], want: [] };
}

/**
 * Saf fonksiyon: talep listesinden kişi bazlı tercih haritası üretir.
 * { [personId]: { hardOff, hardNoNight, softOff, softNoNight, want } } (tarih dizileri)
 */
function buildPreferencesByPerson(requests = [], { year, month } = {}) {
  const out = {};
  for (const r of Array.isArray(requests) ? requests : []) {
    if (String(r?.type || '') !== 'tercih') continue;
    const status = String(r?.status || '');
    if (status !== 'approved' && status !== 'pending') continue;
    const kind = normalizePreferenceKind(r?.preferenceKind);
    if (!kind) continue;
    const pid = String(r?.fromPersonId || '').trim();
    if (!pid) continue;
    const dates = expandDatesInMonth(r.targetDate, r.targetDateEnd, year, month);
    if (!dates.length) continue;

    const approved = status === 'approved';
    let key;
    if (kind === PREFERENCE_KINDS.WANT) key = 'want';
    else if (kind === PREFERENCE_KINDS.OFF) key = approved ? 'hardOff' : 'softOff';
    else key = approved ? 'hardNoNight' : 'softNoNight';

    out[pid] ??= emptyBucket();
    const set = new Set(out[pid][key]);
    for (const d of dates) set.add(d);
    out[pid][key] = [...set].sort();
  }
  return out;
}

/** Kişi listesinin ilgili aydaki bekleyen + onaylı tercih taleplerini okur. */
async function loadPreferencesFromDb({ hospitalId = null, personIds = [], year, month } = {}) {
  const ids = [...new Set((personIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length || !year || !month) return {};
  const { start, end } = monthBounds(year, month);
  const filter = {
    type: 'tercih',
    status: { $in: ['pending', 'approved'] },
    preferenceKind: { $in: [...VALID_KINDS] },
    fromPersonId: { $in: ids },
    targetDate: { $lte: end },
    $or: [
      { targetDateEnd: { $gte: start } },
      { targetDateEnd: { $in: ['', null] }, targetDate: { $gte: start } },
    ],
  };
  if (hospitalId) filter.hospitalId = hospitalId;
  const requests = (await Request.find(filter)
    .select('type status preferenceKind fromPersonId targetDate targetDateEnd')
    .lean()) || [];
  return buildPreferencesByPerson(requests, { year, month });
}

/** "want" tercihlerini motorun mevcut requestsByPerson (istek bonusu) girdisine ekler. */
function mergeWantIntoRequests(requestsByPerson = {}, preferencesByPerson = {}) {
  const out = { ...(requestsByPerson || {}) };
  for (const [pid, bucket] of Object.entries(preferencesByPerson || {})) {
    if (!bucket?.want?.length) continue;
    const prev = out[pid];
    const prevList = prev instanceof Set ? [...prev] : Array.isArray(prev) ? prev : [];
    out[pid] = [...new Set([...prevList, ...bucket.want])];
  }
  return out;
}

module.exports = {
  PREFERENCE_KINDS,
  buildPreferencesByPerson,
  expandDatesInMonth,
  loadPreferencesFromDb,
  mergeWantIntoRequests,
  normalizePreferenceKind,
};
