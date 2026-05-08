// services/swapSuggestionService.js — Find best swap partners for a given assignment
const Assignment      = require('../models/Assignment');
const Setting         = require('../models/Setting');
const Person          = require('../models/Person');

function parseYM(dateStr) {
  const m = String(dateStr || '').slice(0, 7).match(/^(\d{4})-(\d{2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
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
// Check shift+area eligibility. Both gates are backward-compatible (no restriction if absent).
function isShiftEligible(candidate, shiftId, roleLabel) {
  const code = String(shiftId || '').trim().toUpperCase();

  // Gate 1: eligibleShiftCodes — explicit shift whitelist
  const eligibleCodes = candidate?.meta?.eligibleShiftCodes;
  if (Array.isArray(eligibleCodes) && eligibleCodes.length > 0) {
    if (!eligibleCodes.some((s) => String(s || '').trim().toUpperCase() === code)) return false;
  }

  // Gate 2: workAreas — area/role whitelist (match against roleLabel if provided)
  if (roleLabel) {
    const workAreas = candidate?.meta?.workAreas;
    if (Array.isArray(workAreas) && workAreas.length > 0) {
      const norm = (s) => String(s || '').trim().toLowerCase();
      const labelNorm = norm(roleLabel);
      if (!workAreas.some((a) => norm(a) === labelNorm)) return false;
    }
  }

  return true;
}

async function suggestSwaps({ personId, date, shiftId, roleLabel, serviceId, hospitalId, limit = 5 }) {
  const ym = parseYM(date);
  if (!ym) return { ok: false, message: 'Geçersiz tarih formatı' };

  const personQuery = { active: { $ne: false } };
  if (serviceId) personQuery.serviceId = serviceId;
  if (hospitalId) personQuery.hospitalId = hospitalId;
  if (personId) personQuery._id = { $ne: personId };

  const candidates = await Person.find(personQuery).select('_id name serviceId meta').lean();

  // SSOT: use Assignment collection for counting and conflict detection
  const assignQuery = { year: ym.year, month: ym.month };
  if (hospitalId) assignQuery.hospitalId = hospitalId;
  const monthAssignments = await Assignment.find(assignQuery).select('personId date').lean();

  const assignCountByPerson = {};
  const assignedOnDateByPerson = new Set();
  for (const a of monthAssignments) {
    const pid = String(a.personId || '');
    if (!pid) continue;
    assignCountByPerson[pid] = (assignCountByPerson[pid] || 0) + 1;
    if (String(a.date || '').slice(0, 10) === date) {
      assignedOnDateByPerson.add(pid);
    }
  }

  const ownCount = assignCountByPerson[String(personId)] || 0;

  // Leaves: fetch for service
  const leaveDoc = await Setting.findOne({ key: 'leavesV2', serviceId: String(serviceId || '') }).lean();
  const leaveValue = leaveDoc?.value || {};
  const dayNum = String(parseInt(date.slice(8, 10), 10));
  const monthKey = date.slice(0, 7);

  const suggestions = [];
  for (const c of candidates) {
    const cid = String(c._id);

    if (assignedOnDateByPerson.has(cid)) continue;
    if (leaveValue[cid]?.[monthKey]?.[dayNum]) continue;
    if (!isShiftEligible(c, shiftId, roleLabel)) continue;

    const shiftCount = assignCountByPerson[cid] || 0;
    const delta = ownCount - shiftCount;

    suggestions.push({
      personId:   cid,
      personName: c.name || cid,
      serviceId:  c.serviceId || '',
      shiftCount,
      delta,
      eligible: true,
    });
  }

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
