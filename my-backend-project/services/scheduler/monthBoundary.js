'use strict';

/**
 * Aylar arası planlama (İP-2 / B).
 *
 * Ayın ilk günlerinde dinlenme, gece sonrası izin, ardışık gün ve haftalık sınır
 * kuralları ÖNCEKİ dönemdeki görevlere bağlıdır. Bu modül:
 *   1) Etkin kurallardan geriye bakılacak gün sayısını türetir,
 *   2) O aralıktaki önceki görevleri Assignment koleksiyonundan (tek doğruluk kaynağı)
 *      ilgili personel için okur (personel başka serviste çalışmış olsa da),
 *   3) Veri yoksa / kısmisa bunu açıkça bildirir.
 *
 * Gece yarısını aşan vardiyalar: başlangıç/bitiş saatleri vardiya tanımından alınır,
 * bitiş ≤ başlangıç ise ertesi güne taşar (constraints.js ile aynı yorum).
 * Yıl değişimi ve ay uzunlukları UTC tarih aritmetiğiyle hesaplanır.
 */

const Assignment = require('../../models/Assignment');
const MonthlySchedule = require('../../models/MonthlySchedule');

const DAY_MS = 86400000;
const MAX_LOOKBACK = 31;

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function monthStart(year, month) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1));
}

function previousYearMonth(year, month) {
  return Number(month) === 1 ? { year: Number(year) - 1, month: 12 } : { year: Number(year), month: Number(month) - 1 };
}

function parseHm(v) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Vardiya süresi (saat) — gece yarısını aşan vardiyalar dahil. */
function shiftLengthHours(meta = {}) {
  const s = parseHm(meta.start || meta.startTime);
  const e = parseHm(meta.end || meta.endTime);
  if (s != null && e != null) {
    let end = e;
    if (end <= s) end += 1440;
    return (end - s) / 60;
  }
  const h = Number(meta.hours || meta.duration || 0);
  return Number.isFinite(h) && h > 0 ? h : 24;
}

/**
 * Etkin kurallardan geriye bakış süresi (gün).
 * - Dinlenme: en uzun vardiya + en az dinlenme süresi kadar geriye (gece yarısını aşan
 *   vardiya ertesi güne taşar) → ceil((maxShift + minRest) / 24).
 * - Gece sonrası izin: en az 1 gün.
 * - Ardışık gün sınırı: N gün.
 * - Haftalık sınır: ayın 1'inin ISO haftasının pazartesisine kadar.
 */
function computeLookbackDays({ rules = {}, shiftMetaByCode = {}, year, month } = {}) {
  const parts = { rest: 0, night: 0, consecutive: 0, weekly: 0 };
  const maxShift = Math.max(24, ...Object.values(shiftMetaByCode || {}).map((m) => shiftLengthHours(m)));
  const minRest = Number(rules.MIN_REST_HOURS || 0);
  if (minRest > 0) parts.rest = Math.ceil((maxShift + minRest) / 24);
  if (rules.NIGHT_NEXT_DAY_OFF) parts.night = 1;
  const maxCons = Number(rules.MAX_CONSECUTIVE_DAYS || 0);
  if (maxCons > 0) parts.consecutive = maxCons;
  if (Number(rules.MAX_SHIFTS_PER_WEEK || 0) > 0 && year && month) {
    const wd = monthStart(year, month).getUTCDay(); // 0=Pazar
    parts.weekly = (wd + 6) % 7; // pazartesiye kadar gün
  }
  const days = Math.min(MAX_LOOKBACK, Math.max(1, ...Object.values(parts)));
  return { days, parts, maxShiftHours: maxShift };
}

function dateRange(year, month, lookbackDays) {
  const start = monthStart(year, month);
  const from = new Date(start.getTime() - lookbackDays * DAY_MS);
  const to = new Date(start.getTime() - DAY_MS);
  return { from: isoDate(from), to: isoDate(to) };
}

const ACTIVE_STATUS = { $nin: ['cancelled', 'deleted', 'iptal'] };

/**
 * Önceki dönem görevlerini okur.
 * Dönen `status`:
 *   - 'found'   : önceki ay planı var, aralıkta görev bulundu
 *   - 'empty'   : önceki ay planı var ama aralıkta bu personelin görevi yok (geçerli durum)
 *   - 'missing' : önceki ay için plan / görev verisi yok → ay başı kontrolü sınırlı
 */
async function loadPriorAssignments({
  hospitalId = null, sectionId, serviceId = '', role = '', year, month,
  staff = [], lookbackDays = 1, shiftMetaByCode = {},
  assignmentModel = Assignment, monthlyModel = MonthlySchedule,
} = {}) {
  const { from, to } = dateRange(year, month, lookbackDays);
  const prev = previousYearMonth(year, month);
  const ids = new Set((staff || []).map((p) => String(p?.id || p?._id || p?.personId || '')).filter(Boolean));
  const nameToId = new Map((staff || []).map((p) => [String(p?.name || p?.fullName || '').trim().toLocaleUpperCase('tr-TR'), String(p?.id || p?._id || '')]));

  const base = { ...(hospitalId ? { hospitalId } : {}), date: { $gte: from, $lte: to }, status: ACTIVE_STATUS };
  const [assignmentRows, prevDoc] = await Promise.all([
    assignmentModel.find(base, { date: 1, personId: 1, personName: 1, shiftCode: 1, shiftId: 1, hours: 1, serviceId: 1 }).lean(),
    monthlyModel.findOne({
      ...(hospitalId ? { hospitalId } : {}), sectionId, serviceId, role, year: prev.year, month: prev.month,
    }, { 'data.assignments': 1 }).lean(),
  ]);
  let rows = assignmentRows || [];
  let source = 'assignments';
  // Projeksiyon yoksa aynı kapsamdaki önceki ay planından oku (eski veri).
  if (!rows.length && Array.isArray(prevDoc?.data?.assignments)) {
    rows = prevDoc.data.assignments.filter((a) => {
      const d = String(a?.date || a?.day || '').slice(0, 10);
      return d >= from && d <= to;
    });
    source = 'monthly';
  }

  const prior = [];
  for (const r of rows) {
    let pid = String(r.personId || '').trim();
    if (!ids.has(pid)) pid = nameToId.get(String(r.personName || '').trim().toLocaleUpperCase('tr-TR')) || '';
    if (!pid || !ids.has(pid)) continue;
    const code = String(r.shiftCode || r.shiftId || '').trim();
    const meta = shiftMetaByCode?.[code] || shiftMetaByCode?.[code.toUpperCase()] || {};
    prior.push({
      date: String(r.date).slice(0, 10),
      personId: pid,
      personName: r.personName || '',
      shiftCode: code,
      shiftId: code,
      start: meta.start || meta.startTime || null,
      end: meta.end || meta.endTime || null,
      hours: Number(r.hours || meta.hours || 0) || shiftLengthHours(meta),
      prior: true,
    });
  }
  prior.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Önceki ay planı yoksa ve aralıkta bu personele ait görev de yoksa: veri eksik.
  let status;
  if (prior.length) status = 'found';
  else if (prevDoc) status = 'empty';
  else { status = 'missing'; source = 'none'; }

  const prevLabel = `${prev.year}-${pad(prev.month)}`;
  const message = status === 'missing'
    ? `Önceki dönem (${prevLabel}) verisi yok: ayın ilk ${lookbackDays} günü için dinlenme / gece sonrası / ardışık gün kontrolü yalnız bu ayın verisiyle yapıldı. Önceki ayın son görevlerini sisteme girin ya da elle kontrol edin.`
    : status === 'empty'
      ? `Önceki dönemde (${from} – ${to}) bu personelin görevi yok; ay başı kontrolü tam.`
      : `Önceki dönemden ${prior.length} görev (${from} – ${to}) ay başı kontrolüne dahil edildi.`;

  return { assignments: prior, status, source, from, to, lookbackDays, previousMonth: prevLabel, message };
}

/**
 * Önceki görevlerle personelin başlangıç durumunu kurar (son vardiya, ardışık gün,
 * haftalık sayaç). Toplam saat/nöbet ve adalet sayaçlarına EKLENMEZ: onlar bu ayın.
 */
function seedPersonStateFromPrior(staff = [], prior = [], { getISOWeekKey, isNightCode } = {}) {
  const byId = new Map(staff.map((p) => [String(p.id), p]));
  for (const a of prior) {
    const person = byId.get(String(a.personId));
    if (!person) continue;
    const diff = person.lastAssignedDate
      ? Math.round((Date.parse(`${a.date}T00:00:00Z`) - Date.parse(`${person.lastAssignedDate}T00:00:00Z`)) / DAY_MS)
      : null;
    if (person.lastAssignedDate !== a.date) {
      person.consecutiveDays = diff === 1 ? Number(person.consecutiveDays || 0) + 1 : 1;
      person.lastAssignedDate = a.date;
    }
    if (typeof getISOWeekKey === 'function') {
      const wk = getISOWeekKey(a.date);
      if (wk) {
        if (!person.weeklyCounts) person.weeklyCounts = {};
        person.weeklyCounts[wk] = Number(person.weeklyCounts[wk] || 0) + 1;
      }
    }
    person.lastShift = {
      date: a.date,
      code: a.shiftCode,
      start: a.start,
      end: a.end,
      isNight: typeof isNightCode === 'function' ? !!isNightCode(a.shiftCode) : false,
      prior: true,
    };
  }
}

module.exports = {
  computeLookbackDays,
  dateRange,
  loadPriorAssignments,
  previousYearMonth,
  seedPersonStateFromPrior,
  shiftLengthHours,
};
