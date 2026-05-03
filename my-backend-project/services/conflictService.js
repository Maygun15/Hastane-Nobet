// services/conflictService.js
// Hospital scope (AsyncLocalStorage) otomatik devreye girer — hospitalId açıkça geçmek gerekmez.
const MonthlySchedule = require('../models/MonthlySchedule');
const Setting = require('../models/Setting');

function parseYearMonth(dateStr) {
  const m = String(dateStr || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function samePerson(a, personId, personName) {
  const pid = String(personId || '').trim();
  const pname = String(personName || '').trim().toLowerCase();
  const aPid = String(a?.personId || '').trim();
  const aPname = String(a?.personName || '').trim().toLowerCase();
  if (pid && aPid) return pid === aPid;
  if (pname && aPname) return pname === aPname;
  return false;
}

/**
 * Aynı kişiye aynı gün başka bir vardiya atanmış mı?
 * excludeShiftId: edit senaryosunda mevcut vardiyayı çakışma listesinden çıkar.
 */
async function checkSameDayConflict({ personId, personName, date, excludeShiftId }) {
  const ym = parseYearMonth(date);
  if (!ym) return [];
  const dateStr = String(date).slice(0, 10);
  const excludeId = String(excludeShiftId || '').trim().toUpperCase();

  const docs = await MonthlySchedule.find({ year: ym.year, month: ym.month }).lean();
  const conflicts = [];

  for (const doc of docs) {
    const assignments = Array.isArray(doc?.data?.assignments) ? doc.data.assignments : [];
    for (const a of assignments) {
      if (String(a?.date || a?.day || '').slice(0, 10) !== dateStr) continue;
      if (!samePerson(a, personId, personName)) continue;
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      if (excludeId && aShift === excludeId) continue;
      conflicts.push({
        date: dateStr,
        shiftId: aShift,
        shiftLabel: String(a?.shiftLabel || a?.roleLabel || '').trim(),
        sectionId: String(doc?.sectionId || ''),
        serviceId: String(doc?.serviceId || ''),
      });
    }
  }
  return conflicts;
}

/**
 * Kişi bu tarihte izinli mi?
 * serviceId: izin kaydının serviceId'si (boş string de olabilir).
 */
async function checkLeaveConflict({ personId, date, serviceId }) {
  const ym = parseYearMonth(date);
  if (!ym || !personId) return null;

  const monthKey = `${ym.year}-${String(ym.month).padStart(2, '0')}`;
  const pid = String(personId);
  const sids = Array.from(new Set([serviceId || '', '']));

  const docs = await Setting.find({ key: 'leavesV2', serviceId: { $in: sids } }).lean();
  for (const doc of docs) {
    if (!doc?.value) continue;
    const monthLeaves = (doc.value[pid] || {})[monthKey] || {};
    const dayLeave = monthLeaves[String(ym.day)];
    if (!dayLeave) continue;
    const code = typeof dayLeave === 'string' ? dayLeave : dayLeave?.code;
    if (code) return { date: String(date).slice(0, 10), code };
  }
  return null;
}

module.exports = { checkSameDayConflict, checkLeaveConflict };
