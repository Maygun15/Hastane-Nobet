'use strict';
// services/complianceEngine.js — İş Hukuku ve Mevzuat Denetim Motoru
// Kaynak mevzuat: 4857 sayılı İş Kanunu + Sağlık Bakanlığı Yönetmelikleri

const mongoose   = require('mongoose');
const Assignment = require('../models/Assignment');
const Setting    = require('../models/Setting');
const { broadcastAll } = require('./sseService');

/* ─── Varsayılan konfigürasyon (Setting'den override edilebilir) ─── */
const DEFAULT_CONFIG = {
  weeklyMaxHours:        45,   // İş Kanunu 63. madde — haftalık üst sınır
  dailyMaxHours:         11,   // Günlük maksimum çalışma süresi
  minRestHoursBetween:   11,   // İki vardiya arasındaki minimum dinlenme
  maxConsecutiveDays:    7,    // Kesintisiz çalışma üst sınırı
  nightShiftMonthlyLimit: 8,   // 0 = sınırsız
};

const toOid = (id) => {
  try { return new mongoose.Types.ObjectId(String(id)); } catch { return null; }
};

/* ─── Konfigürasyon yönetimi ─── */

async function loadConfig(hospitalId) {
  try {
    const hoid = toOid(hospitalId);
    const filter = hoid ? { hospitalId: hoid } : { hospitalId: String(hospitalId) };
    const doc = await Setting.findOne({ ...filter, key: 'complianceConfig' }).lean();
    if (doc?.value && typeof doc.value === 'object') {
      return { ...DEFAULT_CONFIG, ...doc.value };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

async function saveConfig(hospitalId, incoming) {
  const hoid = toOid(hospitalId);
  const filter = hoid ? { hospitalId: hoid } : { hospitalId: String(hospitalId) };
  const value = { ...DEFAULT_CONFIG, ...incoming };
  await Setting.findOneAndUpdate(
    { ...filter, key: 'complianceConfig' },
    { $set: { ...filter, key: 'complianceConfig', value } },
    { upsert: true, new: true }
  );
  return value;
}

/* ─── Yardımcılar ─── */

function isNightShift(s) {
  const sc = (s.shiftCode || '').toUpperCase();
  const startH = Number(s.startHour ?? -1);
  return sc === 'G' || sc === 'GECE' || (s.shiftId || '').toLowerCase().includes('gece') || startH >= 22;
}

// ISO hafta anahtarı: "2025-W21"
function isoWeekKey(dateStr) {
  const d = new Date(String(dateStr) + 'T12:00:00Z');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/* ─── Aggregation: kişi başına vardiya dizisi ─── */

async function fetchPersonShifts(hoid, year, month) {
  const pad   = (n) => String(n).padStart(2, '0');
  const start = `${year}-${pad(month)}-01`;
  const end   = `${year}-${pad(month)}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

  return Assignment.aggregate([
    {
      $match: {
        hospitalId: hoid,
        date:       { $gte: start, $lte: end },
        status:     'active',
      },
    },
    {
      $group: {
        _id:         '$personId',
        personName:  { $first: '$personName' },
        serviceId:   { $first: '$serviceId' },
        totalHours:  { $sum: { $ifNull: ['$hours', 0] } },
        totalShifts: { $sum: 1 },
        shifts: {
          $push: {
            date:      '$date',
            hours:     { $ifNull: ['$hours', 0] },
            startHour: { $ifNull: ['$startHour', 8] },
            shiftCode: { $ifNull: ['$shiftCode', ''] },
            shiftId:   { $ifNull: ['$shiftId', ''] },
          },
        },
      },
    },
    { $sort: { personName: 1 } },
  ]);
}

/* ─── Kişi başına ihlal analizi ─── */

function analyzeCompliance(person, config) {
  const violations = [];
  const sorted = [...(person.shifts || [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  // 1. Haftalık maksimum saat (İş Kanunu 63)
  const byWeek = {};
  for (const s of sorted) {
    const wk = isoWeekKey(s.date);
    byWeek[wk] = (byWeek[wk] || 0) + Number(s.hours || 0);
  }
  for (const [week, hours] of Object.entries(byWeek)) {
    if (hours > config.weeklyMaxHours) {
      violations.push({
        rule:     'WEEKLY_MAX_HOURS',
        severity: 'error',
        week,
        value:    Math.round(hours * 10) / 10,
        limit:    config.weeklyMaxHours,
        label:    `${week}: ${Math.round(hours * 10) / 10} saat çalışma (yasal limit: ${config.weeklyMaxHours} saat)`,
      });
    }
  }

  // 2. Günlük maksimum saat
  for (const s of sorted) {
    const h = Number(s.hours || 0);
    if (h > config.dailyMaxHours) {
      violations.push({
        rule:     'DAILY_MAX_HOURS',
        severity: 'warning',
        date:     s.date,
        value:    h,
        limit:    config.dailyMaxHours,
        label:    `${s.date}: ${h} saatlik vardiya (limit: ${config.dailyMaxHours} saat)`,
      });
    }
  }

  // 3. Vardiyalar arası minimum dinlenme
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevDate = new Date(String(prev.date) + 'T00:00:00Z');
    const currDate = new Date(String(curr.date) + 'T00:00:00Z');
    const daysDiff = Math.round((currDate - prevDate) / 86400000);

    if (daysDiff <= 1 && daysDiff >= 0) {
      const prevEnd = Number(prev.startHour ?? 8) + Number(prev.hours ?? 8);
      const currStartAbs = daysDiff * 24 + Number(curr.startHour ?? 8);
      const restHours = currStartAbs - prevEnd;

      if (restHours >= 0 && restHours < config.minRestHoursBetween) {
        violations.push({
          rule:         'MIN_REST_BETWEEN',
          severity:     'error',
          date:         curr.date,
          previousDate: prev.date,
          value:        Math.round(restHours * 10) / 10,
          limit:        config.minRestHoursBetween,
          label:        `${prev.date} → ${curr.date}: ${Math.round(restHours * 10) / 10} saat dinlenme (min: ${config.minRestHoursBetween} saat)`,
        });
      }
    }
  }

  // 4. Kesintisiz çalışma günü
  let streak = 1;
  let streakStart = sorted[0]?.date || '';
  let lastReportedStreak = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d1 = new Date(String(sorted[i - 1].date) + 'T00:00:00Z');
    const d2 = new Date(String(sorted[i].date) + 'T00:00:00Z');
    const diff = Math.round((d2 - d1) / 86400000);
    if (diff === 1) {
      streak++;
      if (streak > config.maxConsecutiveDays && streak !== lastReportedStreak) {
        lastReportedStreak = streak;
        violations.push({
          rule:        'MAX_CONSECUTIVE_DAYS',
          severity:    'warning',
          streakStart,
          date:        sorted[i].date,
          value:       streak,
          limit:       config.maxConsecutiveDays,
          label:       `${streakStart} – ${sorted[i].date}: ${streak} gün kesintisiz çalışma (limit: ${config.maxConsecutiveDays})`,
        });
      }
    } else {
      streak = 1;
      streakStart = sorted[i].date;
      lastReportedStreak = 0;
    }
  }

  // 5. Aylık gece nöbeti limiti
  if (config.nightShiftMonthlyLimit > 0) {
    const nightCount = sorted.filter(isNightShift).length;
    if (nightCount > config.nightShiftMonthlyLimit) {
      violations.push({
        rule:     'NIGHT_SHIFT_LIMIT',
        severity: 'warning',
        value:    nightCount,
        limit:    config.nightShiftMonthlyLimit,
        label:    `${nightCount} gece nöbeti (aylık limit: ${config.nightShiftMonthlyLimit})`,
      });
    }
  }

  return violations;
}

/* ─── Public API ─── */

async function checkMonthCompliance({ hospitalId, year, month }) {
  const hoid = toOid(hospitalId);
  if (!hoid) return { ok: false, error: 'Geçersiz hospitalId' };

  const [config, people] = await Promise.all([
    loadConfig(hoid),
    fetchPersonShifts(hoid, Number(year), Number(month)),
  ]);

  const results = people.map((p) => {
    const violations = analyzeCompliance(p, config);
    return {
      personId:    String(p._id),
      personName:  p.personName || String(p._id),
      serviceId:   p.serviceId || '',
      totalHours:  Math.round((p.totalHours || 0) * 10) / 10,
      totalShifts: p.totalShifts || 0,
      violations,
      isCompliant: violations.length === 0,
      hasError:    violations.some((v) => v.severity === 'error'),
      hasWarning:  violations.some((v) => v.severity === 'warning'),
    };
  });

  // Önce error'lar, sonra warning'ler, ardından temizler
  results.sort((a, b) =>
    (b.hasError ? 2 : b.hasWarning ? 1 : 0) - (a.hasError ? 2 : a.hasWarning ? 1 : 0)
  );

  const summary = {
    totalPeople:     results.length,
    compliant:       results.filter((r) => r.isCompliant).length,
    withErrors:      results.filter((r) => r.hasError).length,
    withWarnings:    results.filter((r) => r.hasWarning && !r.hasError).length,
    totalViolations: results.reduce((s, r) => s + r.violations.length, 0),
  };

  return {
    ok:    true,
    year:  Number(year),
    month: Number(month),
    config,
    summary,
    people: results,
  };
}

/**
 * Çizelge yayınlanmadan önce çalıştırılır.
 * Soft-block: ihlaller varsa uyarır ama canPublish=true döner (kullanıcı override edebilir).
 * SSE üzerinden 'compliance:violation' yayınlar.
 */
async function runPrePublishCheck({ hospitalId, year, month }) {
  const result = await checkMonthCompliance({ hospitalId, year, month });
  if (!result.ok) return result;

  const violations = result.people.flatMap((p) =>
    p.violations.map((v) => ({
      ...v,
      personId:   p.personId,
      personName: p.personName,
      serviceId:  p.serviceId,
    }))
  );

  const hasCritical = violations.some((v) => v.severity === 'error');
  const hasWarning  = violations.some((v) => v.severity === 'warning');

  if (violations.length > 0) {
    void broadcastAll('compliance:violation', {
      year:           Number(year),
      month:          Number(month),
      hasCritical,
      hasWarning,
      violationCount: violations.length,
      peopleAffected: result.people.filter((p) => !p.isCompliant).length,
    });
  }

  return {
    ok:          true,
    canPublish:  true,   // soft-block — kullanıcı geçersiz kılabilir
    hasCritical,
    hasWarning,
    violations,
    summary:     result.summary,
    config:      result.config,
  };
}

module.exports = {
  checkMonthCompliance,
  runPrePublishCheck,
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
};
