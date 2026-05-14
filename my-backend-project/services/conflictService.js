// services/conflictService.js
// Hospital scope (AsyncLocalStorage) otomatik devreye girer — hospitalId açıkça geçmek gerekmez.
const MonthlySchedule = require('../models/MonthlySchedule');
const Setting = require('../models/Setting');

function parseYearMonth(dateStr) {
  const m = String(dateStr || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function formatLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
async function checkSameDayConflict({ personId, personName, date, excludeShiftId, excludeSlot }) {
  const ym = parseYearMonth(date);
  if (!ym) return [];
  const dateStr = String(date).slice(0, 10);
  const excludeId = String(excludeShiftId || '').trim().toUpperCase();
  const excludeSectionId = String(excludeSlot?.sectionId || '').trim();
  const excludeServiceId = String(excludeSlot?.serviceId || '').trim();
  const excludeRole = String(excludeSlot?.role || '').trim();

  const docs = await MonthlySchedule.find({ year: ym.year, month: ym.month }).lean();
  const conflicts = [];

  for (const doc of docs) {
    const assignments = Array.isArray(doc?.data?.assignments) ? doc.data.assignments : [];
    for (const a of assignments) {
      if (String(a?.date || a?.day || '').slice(0, 10) !== dateStr) continue;
      if (!samePerson(a, personId, personName)) continue;
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      const isExactExcludedSlot =
        excludeId &&
        aShift === excludeId &&
        (!excludeSectionId || String(doc?.sectionId || '').trim() === excludeSectionId) &&
        (!excludeServiceId || String(doc?.serviceId || '').trim() === excludeServiceId) &&
        (!excludeRole || String(doc?.role || '').trim() === excludeRole);
      if (isExactExcludedSlot) continue;
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

async function checkAdjacentDayConflict({ personId, personName, date }) {
  const ym = parseYearMonth(date);
  if (!ym) return [];

  const target = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return [];

  const prev = new Date(target);
  prev.setDate(prev.getDate() - 1);
  const next = new Date(target);
  next.setDate(next.getDate() + 1);
  const wantedDates = new Set([
    formatLocalDate(prev),
    formatLocalDate(next),
  ]);

  const docs = await MonthlySchedule.find({
    year: { $in: Array.from(new Set([ym.year, prev.getFullYear(), next.getFullYear()])) },
    month: { $in: Array.from(new Set([ym.month, prev.getMonth() + 1, next.getMonth() + 1])) },
  }).lean();

  const conflicts = [];
  for (const doc of docs) {
    const assignments = Array.isArray(doc?.data?.assignments) ? doc.data.assignments : [];
    for (const a of assignments) {
      const aDate = String(a?.date || a?.day || '').slice(0, 10);
      if (!wantedDates.has(aDate)) continue;
      if (!samePerson(a, personId, personName)) continue;
      conflicts.push({
        date: aDate,
        shiftId: String(a?.shiftId || a?.shiftCode || '').trim(),
        shiftLabel: String(a?.shiftLabel || a?.roleLabel || '').trim(),
        sectionId: String(doc?.sectionId || ''),
        serviceId: String(doc?.serviceId || ''),
      });
    }
  }
  return conflicts;
}

module.exports = { checkSameDayConflict, checkLeaveConflict, checkAdjacentDayConflict };
