// services/dutyRules.js — İş kuralları motoru
'use strict';

const Assignment = require('../models/Assignment');
const mongoose   = require('mongoose');

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
 * @param {{ hospitalId: string, year: number, month: number }} params
 * @returns {Promise<Array<{ personId, personName, date1, date2 }>>}
 */
async function findRestViolations({ hospitalId, year, month }) {
  const hoid = toOid(hospitalId);
  const match = {
    year: Number(year),
    month: Number(month),
    status: 'active',
    ...(hoid ? { hospitalId: hoid } : { hospitalId: String(hospitalId) }),
  };

  const assignments = await Assignment.find(match)
    .select('personId personName date')
    .sort({ personId: 1, date: 1 })
    .lean();

  // Group by personId
  const byPerson = new Map();
  for (const a of assignments) {
    const pid = String(a.personId);
    if (!byPerson.has(pid)) byPerson.set(pid, { personName: a.personName, dates: new Set() });
    byPerson.get(pid).dates.add(String(a.date).slice(0, 10));
  }

  const violations = [];
  for (const [pid, { personName, dates }] of byPerson) {
    const sorted = [...dates].sort();
    for (let i = 0; i < sorted.length - 1; i++) {
      const d1 = new Date(`${sorted[i]}T00:00:00`);
      const d2 = new Date(`${sorted[i + 1]}T00:00:00`);
      const diffDays = Math.round((d2 - d1) / 86_400_000);
      if (diffDays === 1) {
        violations.push({ personId: pid, personName: personName || pid, date1: sorted[i], date2: sorted[i + 1] });
      }
    }
  }

  return violations;
}

module.exports = { checkSingleRestViolation, findRestViolations };
