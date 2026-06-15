// services/dutyRules.js — İş kuralları motoru
'use strict';

const Assignment = require('../models/Assignment');
const mongoose   = require('mongoose');

// Vardiya bitiş saatleri (dakika cinsinden, gece yarısını geçenler için cross-midnight)
const SHIFT_END_MIN = {
  M: 16*60, M1: 15*60, M2: 16*60, M3: 17*60,
  M4: 0,    // 00:00 → cross-midnight (16:00→00:00)
  M5: 13*60, M6: 14*60,
  N: null,  // 24h tam dinlenme
  V1: 0,    // 00:00 → cross-midnight (08:00→00:00)
  V2: null, // 24h tam dinlenme
};
const SHIFT_START_MIN = {
  M: 8*60, M1: 8*60, M2: 9*60, M3: 10*60,
  M4: 16*60, M5: 8*60, M6: 8*60,
  N: 8*60, V1: 8*60, V2: 8*60,
};
const MIN_REST_MIN = 12 * 60;

// Önceki vardiyanın bitiş saatinden sonraki vardiyanın başlangıcına kadar olan boşluk ≥ 12h mi?
function restGapOk(prevCode, nextCode) {
  const pc = String(prevCode || '').toUpperCase();
  // Bilinmeyen/boş shiftCode → false positive üretme, ihlal sayma
  if (!pc || !(pc in SHIFT_END_MIN)) return true;

  const prevEnd   = SHIFT_END_MIN[pc];
  const prevStart = SHIFT_START_MIN[pc];
  // null: N/V2 gibi tam 24h dinlenme gerektiren vardiyalar
  if (prevEnd === null) return false;

  const nc = String(nextCode || '').toUpperCase();
  const nextStart  = (nc in SHIFT_START_MIN) ? SHIFT_START_MIN[nc] : 8 * 60;
  const prevEndAbs = (prevEnd <= (prevStart ?? 0)) ? prevEnd + 1440 : prevEnd; // cross-midnight
  const nextStartAbs = nextStart + 1440; // ertesi gün başlangıcı (mutlak)
  return (nextStartAbs - prevEndAbs) >= MIN_REST_MIN;
}

const toOid = (id) => {
  try { return new mongoose.Types.ObjectId(String(id)); } catch { return null; }
};

/**
 * Belirli bir personelin belirli bir tarihte 'nöbet sonrası dinlenme' kuralını
 * ihlal edip etmediğini kontrol eder.
 *
 * Kural: T gününde aktif nöbet varsa, T+1 günü atanamaz (24 saat dinlenme).
 *
 * @param {{ hospitalId: string, personId: string, date: string }} params
 * @returns {Promise<{ violation: boolean, prevDate?: string, prevShift?: object }>}
 */
async function checkSingleRestViolation({ hospitalId, personId, date }) {
  const checkDate = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (isNaN(checkDate.getTime())) return { violation: false };

  const prevDate = new Date(checkDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().slice(0, 10);

  const hoid = toOid(hospitalId);
  const filter = {
    personId: String(personId),
    date: prevDateStr,
    status: 'active',
    ...(hoid ? { hospitalId: hoid } : { hospitalId: String(hospitalId) }),
  };

  const prevAssignment = await Assignment.findOne(filter).select('shiftCode roleLabel hours').lean();
  if (!prevAssignment) return { violation: false };

  return {
    violation: true,
    prevDate: prevDateStr,
    prevShift: {
      shiftCode: prevAssignment.shiftCode || '',
      roleLabel: prevAssignment.roleLabel || '',
      hours: prevAssignment.hours || 0,
    },
  };
}

/**
 * Belirli bir ay için hastanedeki tüm dinlenme kuralı ihlallerini döner.
 * Aynı personel arka arkaya iki günde aktif nöbete atanmışsa ihlal sayılır.
 *
 * sectionId/serviceId/role verilirse yalnızca o bucket sorgulanır;
 * verilmezse tüm hospital bazlı kayıtlar taranır (eski davranış).
 *
 * @param {{ hospitalId: string, year: number, month: number, sectionId?: string, serviceId?: string, role?: string }} params
 * @returns {Promise<Array<{ personId, personName, date1, date2 }>>}
 */
async function findRestViolations({ hospitalId, year, month, sectionId, serviceId, role }) {
  const hoid = toOid(hospitalId);
  const match = {
    year: Number(year),
    month: Number(month),
    status: 'active',
    ...(hoid ? { hospitalId: hoid } : { hospitalId: String(hospitalId) }),
  };
  if (sectionId != null && String(sectionId).trim()) match.sectionId = String(sectionId).trim();
  if (serviceId != null)                              match.serviceId = String(serviceId).trim();
  if (role      != null && String(role).trim())       match.role      = String(role).trim();

  const assignments = await Assignment.find(match)
    .select('personId personName date shiftCode')
    .sort({ personId: 1, date: 1 })
    .lean();

  // Group by personId → sorted list of { date, shiftCode }
  const byPerson = new Map();
  for (const a of assignments) {
    const pid = String(a.personId);
    if (!byPerson.has(pid)) byPerson.set(pid, { personName: a.personName, entries: [] });
    byPerson.get(pid).entries.push({ date: String(a.date).slice(0, 10), shiftCode: a.shiftCode || '' });
  }

  const violations = [];
  for (const [pid, { personName, entries }] of byPerson) {
    entries.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < entries.length - 1; i++) {
      const d1 = new Date(`${entries[i].date}T00:00:00`);
      const d2 = new Date(`${entries[i + 1].date}T00:00:00`);
      const diffDays = Math.round((d2 - d1) / 86_400_000);
      if (diffDays === 1 && !restGapOk(entries[i].shiftCode, entries[i + 1].shiftCode)) {
        violations.push({
          personId: pid,
          personName: personName || pid,
          date1: entries[i].date,
          date2: entries[i + 1].date,
          shift1: entries[i].shiftCode,
          shift2: entries[i + 1].shiftCode,
        });
      }
    }
  }

  return violations;
}

module.exports = { checkSingleRestViolation, findRestViolations };
