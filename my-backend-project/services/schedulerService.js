const GeneratedSchedule = require('../models/GeneratedSchedule');
const MonthlySchedule = require('../models/MonthlySchedule');
const { listHolidays } = require('./holidayService');
const { generateMonthlyPlan } = require('./scheduler');
const { generateDraftRoster } = require('./scheduler/draftRoster');
const { fetchDutyRules, DEFAULT_RULES, DEFAULT_WEIGHTS } = require('./scheduler/ruleResolver');
const { resolveStaff } = require('./scheduler/staffResolver');
const { validateAssignments } = require('./scheduler/validator');
const { applyHolidayPolicies } = require('./scheduler/holidayPolicyAdapter');
const { buildSchedulerInput } = require('./scheduler/inputBuilder');

async function generateSchedule({ sectionId, serviceId = '', role = '', year, month, dryRun = false, userId, payload = {}, hospitalId = null }) {
  const query = hospitalId ? { hospitalId, sectionId, year, month } : { sectionId, year, month };
  if (serviceId) query.serviceId = serviceId;
  if (role) query.role = role;
  const scheduleDoc = await MonthlySchedule.findOne(query).lean();
  const holidays = await listHolidays({ year, month, hospitalId });
  const {
    effectiveDefs,
    effectiveOverrides,
    effectiveShiftOptions,
    days,
    holidayKindByDate,
    shiftMetaByCode,
  } = buildSchedulerInput({
    scheduleDoc,
    payload,
    year,
    month,
    hospitalId,
    holidays,
  });

  if (!days || !days.length) {
    throw new Error('Vardiya şablonu bulunamadı (MonthlySchedule.data.defs bekleniyor).');
  }

  const effectiveDays = applyHolidayPolicies({ days, holidayKindByDate, shiftMetaByCode });

  const staffPack = Array.isArray(payload.staff) && payload.staff.length
    ? { staff: payload.staff, debug: { rawCount: payload.staff.length, filteredCount: payload.staff.length, usedFallback: false, roleTokens: [] } }
    : await resolveStaff({ serviceId, role, hospitalId });
  const staff = staffPack.staff;

  const leavesByPerson = payload.leavesByPerson || {};
  const requestsByPerson = payload.requestsByPerson || {};

  const staffCount = Array.isArray(staff) ? staff.length : 0;
  const totalSlots = Array.isArray(effectiveDays)
    ? effectiveDays.reduce(
        (sum, d) => sum + (d.shifts || []).reduce((s, sh) => s + (Number(sh.requiredCount || 0) || 0), 0),
        0
      )
    : 0;
  const totalHoursCalc = Array.isArray(effectiveDays)
    ? effectiveDays.reduce(
        (sum, d) =>
          sum +
          (d.shifts || []).reduce((s, sh) => {
            const need = Number(sh.requiredCount || 0) || 0;
            const hours = Number(sh.hours || 0) || 0;
            return s + need * hours;
          }, 0),
        0
      )
    : 0;

  const targetHours =
    Number(payload.targetHours || 0) > 0
      ? Number(payload.targetHours || 0)
      : staffCount > 0 && totalHoursCalc > 0
      ? totalHoursCalc / staffCount
      : 0;
  const targetShifts =
    Number(payload.targetShifts || 0) > 0
      ? Number(payload.targetShifts || 0)
      : staffCount > 0 && totalSlots > 0
      ? totalSlots / staffCount
      : 0;

  const engineMode = String(payload.engine || payload.mode || '').toLowerCase();
  const useDraft = engineMode === 'draft';

  const { doc: ruleDoc, rules: dbRules, weights: dbWeights } = await fetchDutyRules({ sectionId, serviceId, role, hospitalId });
  const rules = { ...dbRules, ...(payload.rules || {}) };
  const weights = { ...dbWeights, ...(payload.weights || {}) };

  let context = null;
  let draftResult = null;
  if (useDraft) {
    draftResult = generateDraftRoster({
      year,
      month,
      rows: effectiveDefs,
      overrides: effectiveOverrides,
      staff,
      leavesByPerson,
      pins: Array.isArray(payload.pins) ? payload.pins : [],
      supervisorConfig: payload.supervisorConfig || {},
      supervisorPool: payload.supervisorPool || [],
      leavePolicy: payload.leavePolicy || "hard",
      requireEligibility: payload.requireEligibility !== false,
      nightCodes: payload.nightShiftCodes || null,
      shiftOptions: effectiveShiftOptions,
    });
  } else {
    context = await generateMonthlyPlan({
      year,
      month,
      getActiveStaff: async () => staff,
      getMonthlyShifts: async () => effectiveDays,
      getLeaves: async () => leavesByPerson,
      getRequests: async () => requestsByPerson,
      ruleEngineDoc: ruleDoc || null,
      rules,
      weights,
      targetHours,
      targetShifts,
      debug: {
        logBlocks: payload?.debug?.logBlocks || process.env.SCHEDULER_DEBUG === '1',
      },
    });
  }

  const shiftCount = effectiveDays.reduce((sum, d) => sum + (d.shifts?.length || 0), 0);
  const requiredSlots = effectiveDays.reduce(
    (sum, d) => sum + (d.shifts || []).reduce((s, sh) => s + (Number(sh.requiredCount || 0) || 0), 0),
    0
  );

  const baseAssignmentsRaw = useDraft ? (draftResult?.assignments || []) : (context.assignments || []);
  const baseIssues = useDraft ? (draftResult?.issues || []) : (context.issues || []);
  const validated = validateAssignments({
    assignments: baseAssignmentsRaw,
    leavesByPerson,
    holidayKindByDate,
    shiftMetaByCode,
    defs: effectiveDefs,
  });
  const data = {
    assignments: validated.assignments,
    issues: [...baseIssues, ...(validated.issues || [])],
    days: days.length,
    debug: {
      staff: staffPack.debug,
      shiftCount,
      requiredSlots,
      engine: useDraft ? "draft" : "optimized",
      hardFiltered: validated?.debug?.hardFiltered || 0,
    },
  };

  if (dryRun) {
    return { data, rules, weights, sourceScheduleId: scheduleDoc?._id || null };
  }

  const doc = await GeneratedSchedule.create({
    ...(hospitalId ? { hospitalId } : {}),
    sectionId,
    serviceId,
    role,
    year,
    month,
    sourceScheduleId: scheduleDoc?._id || null,
    data,
    meta: { rules, weights },
    createdBy: userId || null,
    updatedBy: userId || null,
  });

  // Atamaları MonthlySchedule'a da yaz (PersonScheduleCalendar okuyabilsin)
  try {
    if (scheduleDoc?._id) {
      await MonthlySchedule.findByIdAndUpdate(
        scheduleDoc._id,
        { $set: { 'data.assignments': data.assignments || [], 'data.generatedAt': new Date().toISOString() } },
        { new: true }
      );
    }
  } catch (e) {
    console.warn('[scheduler] MonthlySchedule assignments yazma hatası:', e.message);
  }

  return { data, rules, weights, generatedId: String(doc._id) };
}

module.exports = {
  generateSchedule,
  fetchDutyRules,
  DEFAULT_RULES,
  DEFAULT_WEIGHTS,
};
