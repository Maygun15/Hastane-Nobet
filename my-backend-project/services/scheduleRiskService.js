'use strict';

// Yayın öncesi risk listesi (yönetici kararı gerektiren durumlar).
//
// Hastane kararı (2026-11-16): boş kalan slotlar ve tüm riskli atamalar için
// sistem uyarır; yönetici her biri için "Yerine ata" ya da "Bu şekilde devam"
// der. Karara bağlanmamış risk varken çizelge yayınlanamaz.
//
// Risk türleri:
//   BOS_SLOT     — görev için gereken kişi sayısı doldurulamadı
//   VERI_EKSIGI  — personelin çalışma alanı / vardiya kodu boş (hiç atanamaz)
//   KURAL        — atama bir kuralı bozuyor (dinlenme, çakışma, alan, haftalık saat…)
//   TERCIH       — kişinin tercihine rağmen atama (onaylı tercih = yüksek risk)
//
// Bu dosya saf fonksiyonlardan oluşur (DB yok); route katmanı veriyi toplar.

const {
  areaMatches,
  normalizeArea,
  isServiceSupervisorLabel,
  hasServiceSupervisorEligibility,
} = require('./scheduler/constraints');

// Motorla aynı alan kuralı: kelime eşleşmesi + servis sorumlusu satırı için ayrıca yetki.
function areaAllowed(person, shiftArea) {
  const area = normalizeArea(shiftArea || '');
  if (!area) return true;
  if (isServiceSupervisorLabel(shiftArea) && !hasServiceSupervisorEligibility(person)) return false;
  const areas = personAreas(person).map(normalizeArea);
  return areas.length > 0 && areaMatches(areas, area);
}
const { isWeekendLikeDay, isNightLikeShift } = require('./scheduler/fairnessCounters');
const { isNightCleanupCode } = require('./scheduler/utils/nightShift');

const DEFAULT_LIMITS = Object.freeze({ MIN_REST_HOURS: 12, MAX_CONSECUTIVE_DAYS: 6, NIGHT_NEXT_DAY_OFF: true, MAX_WEEKLY_HOURS: 72 });

const KURAL_LABEL = {
  GUNDE_IKI_VARDIYA: 'Aynı gün iki vardiya',
  CAKISMA: 'Vardiyalar çakışıyor',
  DINLENME_12S: 'Kurum kuralındaki en az dinlenme süresinin altında',
  GECE_SONRASI_GUN: '24 saat nöbetin ertesi günü çalışma',
  ART_ARDA_GUN: 'Art arda gün sınırı aşıldı',
  HAFTALIK_SAAT: 'Haftalık saat sınırı aşıldı',
  ALAN_UYGUN_DEGIL: 'Kişinin alanına uygun değil',
  VARDIYA_KODU_UYGUN_DEGIL: 'Kişinin vardiya kodlarına uygun değil',
  HAFTA_SONU_M4: 'Hafta sonu M4 yasak',
  BILINMEYEN_KISI: 'Personel listesinde olmayan kişi',
};

const toMin = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function absInterval(date, start, end, hours) {
  const base = Date.parse(`${date}T00:00:00Z`) / 60000;
  const s = toMin(start);
  let e = toMin(end);
  if (s == null) return null;
  if (e == null) e = s + Number(hours || 0) * 60;
  if (e <= s) e += 1440; // gece yarısını geçen / 24 saat
  return { from: base + s, to: base + e };
}

function isoWeek(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

const personKey = (p) => String(p?.id || p?._id || p?.personId || '');
const personAreas = (p) => {
  const raw = p?.meta?.areas || p?.areas || [];
  return Array.isArray(raw) ? raw : String(raw).split(',').map((x) => x.trim()).filter(Boolean);
};
const personCodes = (p) => {
  const raw = p?.meta?.shiftCodes || p?.shiftCodes || [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,;/]/);
  return list.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
};

function shiftRef(days) {
  const map = new Map();
  for (const d of days || []) for (const s of d.shifts || []) map.set(`${d.date}|${s.id}`, { day: d, shift: s });
  return map;
}

/** Atamaları bağımsız denetler; ihlal listesi döner. */
function auditAssignments({ assignments = [], days = [], staff = [], limits = {}, priorAssignments = [] }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const refs = shiftRef(days);
  const people = new Map(staff.map((p) => [personKey(p), p]));
  const out = [];

  const enrich = (a) => {
    const ref = refs.get(`${a.date}|${a.shiftId || a.rowId}`);
    return {
      ...a,
      start: a.start || a.startTime || ref?.shift?.start || null,
      end: a.end || a.endTime || ref?.shift?.end || null,
      hours: Number(a.hours || ref?.shift?.hours || 0),
      _ref: ref,
    };
  };
  // Önceki dönem görevleri (İP-2) yalnız sıralı kontrollere katılır; ihlal yalnız bu ayın
  // görevine yazılır (önceki ayın görevi bu planda değiştirilemez).
  const add = (type, a, detail = '') => a?._prior ? null : out.push({
    type, date: a.date, personId: String(a.personId || ''), personName: a.personName || '',
    rowId: String(a.shiftId || a.rowId || ''), shiftCode: a.shiftCode || '', detail,
  });

  const byPerson = new Map();
  for (const raw of assignments) {
    const a = enrich(raw);
    const k = String(a.personId || '');
    if (!byPerson.has(k)) byPerson.set(k, []);
    byPerson.get(k).push(a);

    const p = people.get(k);
    if (!p) { add('BILINMEYEN_KISI', a); continue; }
    if (a._ref?.shift?.area && personAreas(p).length && !areaAllowed(p, a._ref.shift.area)) add('ALAN_UYGUN_DEGIL', a, a._ref.shift.area);
    if (a._ref?.day && isWeekendLikeDay(a._ref.day) && String(a.shiftCode).toUpperCase() === 'M4') add('HAFTA_SONU_M4', a);
    const codes = personCodes(p);
    if (codes.length && a.shiftCode && !codes.includes(String(a.shiftCode).toUpperCase())) add('VARDIYA_KODU_UYGUN_DEGIL', a);
  }

  for (const raw of priorAssignments || []) {
    const k = String(raw.personId || '');
    if (!byPerson.has(k)) continue; // bu ay görevi olmayan kişinin önceki görevi önemsiz
    byPerson.get(k).push({ ...raw, hours: Number(raw.hours || 0), _prior: true });
  }

  const minRest = Number(L.MIN_REST_HOURS || 0) * 60;
  const maxCons = Number(L.MAX_CONSECUTIVE_DAYS || 0);
  for (const list of byPerson.values()) {
    list.sort((x, y) => (x.date === y.date ? (toMin(x.start) ?? 0) - (toMin(y.start) ?? 0) : x.date < y.date ? -1 : 1));
    const perDay = new Map();
    const weekly = new Map();
    let cons = 0;
    let prevDate = null;
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      perDay.set(a.date, (perDay.get(a.date) || 0) + 1);
      if (perDay.get(a.date) === 2) add('GUNDE_IKI_VARDIYA', a);
      const wk = isoWeek(a.date);
      weekly.set(wk, { h: (weekly.get(wk)?.h || 0) + a.hours, a });

      if (prevDate !== a.date) {
        const diff = prevDate ? (Date.parse(a.date) - Date.parse(prevDate)) / 86400000 : null;
        cons = diff === 1 ? cons + 1 : 1;
        if (maxCons && cons > maxCons) add('ART_ARDA_GUN', a, `${cons} gün`);
        prevDate = a.date;
      }

      const prev = list[i - 1];
      if (prev) {
        const p = absInterval(prev.date, prev.start, prev.end, prev.hours);
        const c = absInterval(a.date, a.start, a.end, a.hours);
        if (p && c) {
          const gap = c.from - p.to;
          if (gap < 0) add('CAKISMA', a, `${prev.date} ${prev.shiftCode}`);
          else if (minRest && gap < minRest) add('DINLENME_12S', a, `${(gap / 60).toFixed(1)} saat; kural en az ${minRest / 60} saat`);
        }
        // Dinlenme kuralının gece tanımı (N / NIGHT / V2 / 24 saat) — V1 dahil değil.
        const prevRestNight = isNightCleanupCode(prev.shiftCode) || Number(prev.hours || 0) >= 24;
        const dayGap = (Date.parse(a.date) - Date.parse(prev.date)) / 86400000;
        if (L.NIGHT_NEXT_DAY_OFF && prevRestNight && dayGap === 1) add('GECE_SONRASI_GUN', a, `${prev.date} ${prev.shiftCode}`);
      }
    }
    if (L.MAX_WEEKLY_HOURS) {
      for (const [wk, { h, a }] of weekly) {
        if (h > L.MAX_WEEKLY_HOURS) add('HAFTALIK_SAAT', { ...a, date: wk }, `${h} saat`);
      }
    }
  }
  return out;
}

/** Gün/görev bazında gereken ve atanan kişi sayısı → boş slotlar. */
function findUnfilledSlots({ assignments = [], days = [] }) {
  const counts = new Map();
  for (const a of assignments) {
    const k = `${String(a.date).slice(0, 10)}|${a.shiftId || a.rowId}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = [];
  for (const d of days || []) {
    for (const s of d.shifts || []) {
      const need = Number(s.requiredCount || 0);
      if (need <= 0) continue;
      const have = counts.get(`${d.date}|${s.id}`) || 0;
      if (have < need) out.push({ date: d.date, rowId: String(s.id), shiftCode: s.code || '', area: s.area || '', need, have });
    }
  }
  return out;
}

/** Personel tercihi ile çelişen atamalar. */
function findPreferenceConflicts({ assignments = [], preferencesByPerson = {}, days = [] }) {
  const refs = shiftRef(days);
  const out = [];
  for (const a of assignments) {
    const pref = preferencesByPerson?.[String(a.personId || '')];
    if (!pref) continue;
    const date = String(a.date).slice(0, 10);
    const shift = refs.get(`${date}|${a.shiftId || a.rowId}`)?.shift || { code: a.shiftCode };
    const night = isNightLikeShift({ ...shift, code: shift.code || a.shiftCode });
    const base = { date, personId: String(a.personId), personName: a.personName || '', rowId: String(a.shiftId || a.rowId || ''), shiftCode: a.shiftCode || '' };
    if ((pref.hardOff || []).includes(date)) out.push({ ...base, kind: 'off', approved: true });
    else if ((pref.softOff || []).includes(date)) out.push({ ...base, kind: 'off', approved: false });
    if (night && (pref.hardNoNight || []).includes(date)) out.push({ ...base, kind: 'noNight', approved: true });
    else if (night && (pref.softNoNight || []).includes(date)) out.push({ ...base, kind: 'noNight', approved: false });
  }
  return out;
}

const fmtDate = (d) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}` : String(d || '');
};

/**
 * Tüm riskleri tek listede, kararlarıyla birlikte döner.
 * acks: { [key]: { by, byName, at, note } } — MonthlySchedule.riskAcks
 */
function computeScheduleRisks({ assignments = [], days = [], staff = [], preferencesByPerson = {}, acks = {}, limits = {}, priorAssignments = [] } = {}) {
  const rowLabel = new Map();
  for (const d of days || []) for (const s of d.shifts || []) rowLabel.set(String(s.id), `${s.area || s.label || ''} (${s.code || ''})`.trim());
  const risks = [];

  for (const u of findUnfilledSlots({ assignments, days })) {
    risks.push({
      key: `BOS_SLOT|${u.date}|${u.rowId}`,
      type: 'BOS_SLOT', severity: 'yuksek', date: u.date, rowId: u.rowId, shiftCode: u.shiftCode,
      message: `${fmtDate(u.date)} · ${rowLabel.get(u.rowId) || u.rowId}: ${u.need} kişi gerekli, ${u.have} atandı`,
    });
  }

  for (const p of staff) {
    const missing = [];
    if (!personAreas(p).length) missing.push('çalışma alanı');
    if (!personCodes(p).length) missing.push('vardiya kodu');
    if (!missing.length) continue;
    risks.push({
      key: `VERI_EKSIGI|${personKey(p)}`,
      type: 'VERI_EKSIGI', severity: 'orta', personId: personKey(p), personName: p.name || '',
      message: `${p.name || personKey(p)}: ${missing.join(' ve ')} tanımlı değil — hiçbir göreve atanamaz`,
    });
  }

  const seen = new Set();
  for (const v of auditAssignments({ assignments, days, staff, limits, priorAssignments })) {
    const key = `KURAL|${v.type}|${v.date}|${v.personId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    risks.push({
      key, type: 'KURAL', rule: v.type, severity: 'yuksek', date: v.date, personId: v.personId,
      personName: v.personName, rowId: v.rowId, shiftCode: v.shiftCode,
      message: `${fmtDate(v.date)} · ${v.personName || v.personId}: ${KURAL_LABEL[v.type] || v.type}${v.detail ? ` (${v.detail})` : ''}`,
    });
  }

  for (const c of findPreferenceConflicts({ assignments, preferencesByPerson, days })) {
    const what = c.kind === 'off' ? 'çalışmak istemiyor' : 'gece istemiyor';
    risks.push({
      key: `TERCIH|${c.kind}|${c.date}|${c.personId}`,
      type: 'TERCIH', severity: c.approved ? 'yuksek' : 'orta', date: c.date, personId: c.personId,
      personName: c.personName, rowId: c.rowId, shiftCode: c.shiftCode,
      message: `${fmtDate(c.date)} · ${c.personName || c.personId}: ${c.approved ? 'onaylı tercih' : 'bekleyen tercih'} — ${what}, ${c.shiftCode} atandı`,
    });
  }

  const sevOrder = { yuksek: 0, orta: 1 };
  risks.sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || String(a.date || '').localeCompare(String(b.date || '')));
  for (const r of risks) {
    const ack = acks?.[r.key];
    r.acknowledged = !!ack;
    if (ack) r.ack = ack;
  }
  return {
    risks,
    total: risks.length,
    pending: risks.filter((r) => !r.acknowledged).length,
  };
}

/**
 * Boş bir slot için aday sıralaması ("Yerine ata").
 * Uygun = alan ve vardiya kodu uyuyor, o gün başka ataması yok, onaylı tercihi
 * engellemiyor ve atama yeni bir kural ihlali doğurmuyor. Uygun olmayanlar
 * gerekçesiyle döner (yönetici bilerek seçebilir; atama ekranı ayrıca uyarır).
 */
function rankSlotCandidates({ assignments = [], days = [], staff = [], preferencesByPerson = {}, date, rowId, limits = {}, priorAssignments = [] } = {}) {
  const ref = shiftRef(days).get(`${date}|${rowId}`);
  if (!ref) return { slot: null, candidates: [] };
  const { shift, day } = ref;
  const area = normalizeArea(shift.area || '');
  const code = String(shift.code || '').toUpperCase();
  const night = isNightLikeShift(shift);

  const byPerson = new Map();
  for (const a of assignments) {
    const k = String(a.personId || '');
    if (!byPerson.has(k)) byPerson.set(k, []);
    byPerson.get(k).push(a);
  }
  const countViolations = (list, person) => auditAssignments({ assignments: list, days, staff: [person], limits, priorAssignments })
    .filter((v) => v.type !== 'ALAN_UYGUN_DEGIL' && v.type !== 'VARDIYA_KODU_UYGUN_DEGIL').length;

  const candidates = [];
  for (const p of staff) {
    const id = personKey(p);
    const list = byPerson.get(id) || [];
    const reasons = [];
    const codes = personCodes(p);
    if (!areaAllowed(p, shift.area)) reasons.push('Alanı uygun değil');
    if (codes.length && code && !codes.includes(code)) reasons.push('Vardiya kodu uygun değil');
    if (list.some((a) => String(a.date).slice(0, 10) === date)) reasons.push('O gün başka nöbeti var');
    const pref = preferencesByPerson?.[id] || {};
    if ((pref.hardOff || []).includes(date) || (night && (pref.hardNoNight || []).includes(date))) reasons.push('Onaylı tercihi var');
    const softPref = (pref.softOff || []).includes(date) || (night && (pref.softNoNight || []).includes(date));

    const hypothetical = { date, shiftId: rowId, rowId, shiftCode: shift.code, personId: id, personName: p.name || '', start: shift.start, end: shift.end, hours: shift.hours };
    const before = countViolations(list, p);
    const after = countViolations([...list, hypothetical], p);
    if (after > before) reasons.push('Kural ihlali doğurur (dinlenme / art arda gün / haftalık saat)');

    const hours = list.reduce((s, a) => s + Number(a.hours || 0), 0);
    const nights = list.filter((a) => isNightLikeShift({ code: a.shiftCode })).length;
    candidates.push({
      personId: id,
      personName: p.name || id,
      eligible: reasons.length === 0,
      reasons,
      softPreference: softPref,
      monthHours: hours,
      monthNights: nights,
      weekend: isWeekendLikeDay(day),
    });
  }
  // Uygunlar önce; aralarında bekleyen tercihi olmayan, ay saati ve gece sayısı az olan önce.
  candidates.sort((a, b) =>
    (Number(b.eligible) - Number(a.eligible))
    // Uygun olmayanlarda en az engeli olan (ör. sadece dinlenme) önce; alanı uymayanlar sona.
    || (Number(a.reasons.includes('Alanı uygun değil')) - Number(b.reasons.includes('Alanı uygun değil')))
    || (a.reasons.length - b.reasons.length)
    || (Number(a.softPreference) - Number(b.softPreference))
    || (a.monthHours - b.monthHours)
    || (a.monthNights - b.monthNights)
    || a.personName.localeCompare(b.personName, 'tr'));
  return {
    slot: { date, rowId, shiftCode: shift.code, area: shift.area || '', start: shift.start, end: shift.end, hours: shift.hours },
    candidates,
  };
}

module.exports = {
  KURAL_LABEL,
  auditAssignments,
  rankSlotCandidates,
  computeScheduleRisks,
  findPreferenceConflicts,
  findUnfilledSlots,
};
