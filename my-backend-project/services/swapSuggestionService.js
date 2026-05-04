// services/swapSuggestionService.js — Find best swap partners for a given assignment
const MonthlySchedule = require('../models/MonthlySchedule');
const Setting         = require('../models/Setting');
const Person          = require('../models/Person');

function parseYM(dateStr) {
  const m = String(dateStr || '').slice(0, 7).match(/^(\d{4})-(\d{2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

async function getLeaveDays(personId, serviceId) {
  const doc = await Setting.findOne({ key: 'leavesV2', serviceId: String(serviceId || '') }).lean();
  const leaves = doc?.value?.[String(personId)] || {};
  // Flatten to a Set of 'YYYY-MM-DD' strings
  const days = new Set();
  for (const [monthKey, monthLeaves] of Object.entries(leaves)) {
    for (const day of Object.keys(monthLeaves || {})) {
      days.add(`${monthKey}-${String(day).padStart(2, '0')}`);
    }
  }
  return days;
}

async function getAssignedDates(personId, ym) {
  const docs = await MonthlySchedule.find({ year: ym.year, month: ym.month }).lean();
  const dates = new Set();
  for (const doc of docs) {
    for (const a of (doc?.data?.assignments || [])) {
      if (String(a?.personId || '') === String(personId)) {
        dates.add(String(a?.date || a?.day || '').slice(0, 10));
      }
    }
  }
  return dates;
}

/**
 * Suggest up to `limit` swap partners for a given person+date+shift.
 *
 * A candidate is eligible if on `targetDate` they:
 *   - Are NOT on leave
 *   - Are NOT already assigned to another shift
 *   - Are active
 *
 * They are ranked by how many fewer shifts they have than the requester.
 *
 * @param {object} opts
 * @param {string} opts.personId       — person who wants to swap
 * @param {string} opts.date           — YYYY-MM-DD
 * @param {string} opts.shiftId        — shift code/id being offered
 * @param {string} [opts.serviceId]    — restrict candidates to same service
 * @param {string} [opts.hospitalId]
 * @param {number} [opts.limit]        — max suggestions (default 5)
 */
async function suggestSwaps({ personId, date, shiftId, serviceId, hospitalId, limit = 5 }) {
  const ym = parseYM(date);
  if (!ym) return { ok: false, message: 'Geçersiz tarih formatı' };

  const query = { active: { $ne: false } };
  if (serviceId) query.serviceId = serviceId;
  if (hospitalId) query.hospitalId = hospitalId;
  if (personId)   query._id = { $ne: personId };

  const candidates = await Person.find(query).select('_id name serviceId').lean();

  // Count assignments for each candidate this month (for ranking)
  const docs = await MonthlySchedule.find({ year: ym.year, month: ym.month }).lean();
  const assignCountByPerson = {};
  const assignedOnDateByPerson = new Set();

  for (const doc of docs) {
    for (const a of (doc?.data?.assignments || [])) {
      const pid = String(a?.personId || '');
      assignCountByPerson[pid] = (assignCountByPerson[pid] || 0) + 1;
      if (String(a?.date || a?.day || '').slice(0, 10) === date) {
        assignedOnDateByPerson.add(pid);
      }
    }
  }

  // Own shift count
  const ownCount = assignCountByPerson[String(personId)] || 0;

  // Leaves: fetch for service
  const leaveDoc = await Setting.findOne({ key: 'leavesV2', serviceId: String(serviceId || '') }).lean();
  const leaveValue = leaveDoc?.value || {};

  const suggestions = [];
  for (const c of candidates) {
    const cid = String(c._id);

    // Skip if already assigned that day
    if (assignedOnDateByPerson.has(cid)) continue;

    // Skip if on leave that day
    const dayNum = String(parseInt(date.slice(8, 10), 10));
    const monthKey = date.slice(0, 7);
    if (leaveValue[cid]?.[monthKey]?.[dayNum]) continue;

    const shiftCount = assignCountByPerson[cid] || 0;
    const delta = ownCount - shiftCount; // positive means candidate has fewer shifts

    suggestions.push({
      personId:   cid,
      personName: c.name || cid,
      shiftCount,
      delta,
      eligible: true,
    });
  }

  // Sort: candidates with fewer shifts first (fairness), then by name
  suggestions.sort((a, b) => b.delta - a.delta || (a.personName > b.personName ? 1 : -1));

  return {
    ok: true,
    requesterShiftCount: ownCount,
    date,
    shiftId,
    suggestions: suggestions.slice(0, limit),
  };
}

module.exports = { suggestSwaps };
