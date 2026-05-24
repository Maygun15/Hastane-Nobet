// services/fairnessEngine.js — Ağırlıklı Adillik Motoru
'use strict';

const Assignment = require('../models/Assignment');
const mongoose   = require('mongoose');

// Nöbet türü ağırlıkları — standart nöbet 1.0 baz puan
const WEIGHTS = {
  night:   1.5,   // gece nöbeti (22:00-08:00) zorluğu
  weekend: 1.3,   // Cumartesi/Pazar yükü
  holiday: 2.0,   // resmi tatil/bayram yükü
  regular: 1.0,   // gündüz hafta içi baz
};

// Türkiye tatilleri (sabit set — bayram tarihleri tahmini)
const HOLIDAYS = new Set([
  '2025-01-01',
  '2025-03-30','2025-03-31','2025-04-01',
  '2025-04-23','2025-05-01','2025-05-19',
  '2025-06-06','2025-06-07','2025-06-08','2025-06-09',
  '2025-07-15','2025-08-30','2025-10-28','2025-10-29',
  '2026-01-01',
  '2026-03-19','2026-03-20','2026-03-21',
  '2026-04-23','2026-05-01','2026-05-19',
  '2026-05-26','2026-05-27','2026-05-28','2026-05-29',
  '2026-07-15','2026-08-30','2026-10-28','2026-10-29',
]);

function isNightShift(a) {
  const sc = (a.shiftCode || '').toUpperCase();
  const startH = Number(a.startHour ?? -1);
  return sc === 'G' || sc === 'GECE' || (a.shiftId || '').toLowerCase().includes('gece') || startH >= 22;
}

function isWeekend(a) {
  const wd = a.weekday != null ? Number(a.weekday) : new Date(a.date || 0).getDay();
  return wd === 0 || wd === 6;
}

function isHoliday(a) {
  return HOLIDAYS.has(String(a.date || '').slice(0, 10));
}

/**
 * Bir kişinin ham metriklerinden ağırlıklı yük puanını hesaplar.
 * Ağırlıklı yük = regularCount×1.0 + nightBonus×0.5 + weekendBonus×0.3 + holidayBonus×1.0
 * (Gece/hafta sonu/bayram atamaları toplam sayıya zaten dahildir; bonus olarak eklenir.)
 */
function weightedLoad({ totalShifts, nightCount, weekendCount, holidayCount }) {
  const regular   = totalShifts - nightCount - weekendCount - holidayCount;
  const clampedR  = Math.max(0, regular);
  return (
    clampedR      * WEIGHTS.regular +
    nightCount    * WEIGHTS.night   +
    weekendCount  * WEIGHTS.weekend +
    holidayCount  * WEIGHTS.holiday
  );
}

/**
 * 0-100 adillik puanı: gruba en yakın kişi 100 alır, uzaklaştıkça düşer.
 * deviation = |kişiYükü - ortalamaYük| / (maxYük - minYük + ε)
 */
function fairnessScore(load, meanLoad, spreadLoad) {
  if (spreadLoad <= 0) return 100;
  const deviation = Math.abs(load - meanLoad) / spreadLoad;
  return Math.round(Math.max(0, (1 - deviation) * 100));
}

/**
 * Belirli bir ay için tüm personelin ağırlıklı adillik skorlarını hesaplar.
 * Veriler doğrudan Assignment koleksiyonundan çekilir.
 *
 * @returns {Promise<{
 *   year, month,
 *   groupStats: { meanLoad, spread, totalShifts, totalNight, totalWeekend, totalHoliday, personCount },
 *   people: Array<{
 *     personId, personName, serviceId,
 *     totalShifts, nightCount, weekendCount, holidayCount,
 *     weightedLoad, fairnessScore,
 *     nightRatio, weekendRatio, holidayRatio,
 *     nightNearness, weekendNearness, holidayNearness,
 *   }>
 * }>}
 */
async function computeMonthlyFairnessScores({ hospitalId, year, month }) {
  const hoid = (() => {
    try { return new mongoose.Types.ObjectId(String(hospitalId)); } catch { return null; }
  })();

  const assignments = await Assignment.find({
    ...(hoid ? { hospitalId: hoid } : { hospitalId: String(hospitalId) }),
    year: Number(year),
    month: Number(month),
    status: 'active',
  }).select('personId personName serviceId shiftCode shiftId startHour weekday date hours').lean();

  // Group by personId
  const byPerson = new Map();
  for (const a of assignments) {
    const pid  = String(a.personId || a.personName || '?');
    const name = a.personName || pid;
    if (!byPerson.has(pid)) {
      byPerson.set(pid, {
        personId: pid, personName: name,
        serviceId: a.serviceId || '',
        totalShifts: 0, nightCount: 0, weekendCount: 0, holidayCount: 0,
      });
    }
    const p = byPerson.get(pid);
    p.totalShifts++;
    if (isNightShift(a))  p.nightCount++;
    if (isWeekend(a))     p.weekendCount++;
    if (isHoliday(a))     p.holidayCount++;
  }

  const people = [...byPerson.values()];

  // Group totals for ideal ratio computation
  const totalShifts  = people.reduce((s, p) => s + p.totalShifts,  0);
  const totalNight   = people.reduce((s, p) => s + p.nightCount,   0);
  const totalWeekend = people.reduce((s, p) => s + p.weekendCount, 0);
  const totalHoliday = people.reduce((s, p) => s + p.holidayCount, 0);
  const personCount  = people.length;

  const idealNightRatio   = totalShifts > 0 ? totalNight   / totalShifts : 0;
  const idealWeekendRatio = totalShifts > 0 ? totalWeekend / totalShifts : 0;
  const idealHolidayRatio = totalShifts > 0 ? totalHoliday / totalShifts : 0;

  // Weighted loads
  const loads = people.map(p => weightedLoad(p));
  const meanLoad = personCount > 0 ? loads.reduce((s, l) => s + l, 0) / personCount : 0;
  const minLoad  = personCount > 0 ? Math.min(...loads) : 0;
  const maxLoad  = personCount > 0 ? Math.max(...loads) : 0;
  const spread   = maxLoad - minLoad;

  // Nearness: 0-100 proximity to group ideal ratio (100 = exact match)
  const nearness = (personRatio, idealRatio) => {
    if (idealRatio <= 0) return 100;
    const dev = Math.abs(personRatio - idealRatio) / idealRatio;
    return Math.round(Math.max(0, (1 - dev) * 100));
  };

  const result = people.map((p, i) => {
    const wLoad        = loads[i];
    const nightRatio   = p.totalShifts > 0 ? p.nightCount   / p.totalShifts : 0;
    const weekendRatio = p.totalShifts > 0 ? p.weekendCount / p.totalShifts : 0;
    const holidayRatio = p.totalShifts > 0 ? p.holidayCount / p.totalShifts : 0;

    return {
      personId:       p.personId,
      personName:     p.personName,
      serviceId:      p.serviceId,
      totalShifts:    p.totalShifts,
      nightCount:     p.nightCount,
      weekendCount:   p.weekendCount,
      holidayCount:   p.holidayCount,
      weightedLoad:   Math.round(wLoad * 10) / 10,
      fairnessScore:  fairnessScore(wLoad, meanLoad, spread),
      nightRatio:     Math.round(nightRatio   * 100),
      weekendRatio:   Math.round(weekendRatio * 100),
      holidayRatio:   Math.round(holidayRatio * 100),
      nightNearness:   nearness(nightRatio,   idealNightRatio),
      weekendNearness: nearness(weekendRatio, idealWeekendRatio),
      holidayNearness: nearness(holidayRatio, idealHolidayRatio),
    };
  });

  // Sort by fairnessScore desc (most fair first)
  result.sort((a, b) => b.fairnessScore - a.fairnessScore);

  return {
    year: Number(year),
    month: Number(month),
    groupStats: { meanLoad: Math.round(meanLoad * 10) / 10, spread: Math.round(spread * 10) / 10, totalShifts, totalNight, totalWeekend, totalHoliday, personCount, idealNightRatio: Math.round(idealNightRatio * 100), idealWeekendRatio: Math.round(idealWeekendRatio * 100), idealHolidayRatio: Math.round(idealHolidayRatio * 100) },
    people: result,
  };
}

module.exports = { computeMonthlyFairnessScores, weightedLoad, WEIGHTS };
