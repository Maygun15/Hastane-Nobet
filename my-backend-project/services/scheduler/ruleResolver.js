const DutyRule = require('../../models/DutyRule');

const DEFAULT_RULES = {
  ONE_SHIFT_PER_DAY: true,
  LEAVE_BLOCK: true,
  MAX_CONSECUTIVE_DAYS: 6,
  MIN_REST_HOURS: 12,
  NIGHT_NEXT_DAY_OFF: true,
  MAX_SHIFTS_PER_WEEK: 0,
  MAX_TASK_PER_PERSON: 0,
};

// DutyRule.basicRules (yapısal alan) → scheduler DEFAULT_RULES anahtarlarına dönüştür.
// doc.rules bir array ({id,type,enabled,value}) olduğu için doğrudan spread edilemez.
function basicRulesToSchedulerRules(basicRules = {}) {
  const out = {};
  if (basicRules.maxConsecutiveDays != null) out.MAX_CONSECUTIVE_DAYS = basicRules.maxConsecutiveDays;
  if (basicRules.minRestHours != null) out.MIN_REST_HOURS = basicRules.minRestHours;
  if (basicRules.noDoubleShiftPerDay != null) out.ONE_SHIFT_PER_DAY = basicRules.noDoubleShiftPerDay;
  if (basicRules.nightShiftFollowUp != null) {
    out.NIGHT_NEXT_DAY_OFF = basicRules.nightShiftFollowUp !== 'none';
  }
  return out;
}

const DEFAULT_WEIGHTS = {
  hourBalance: 2,
  shiftBalance: 3,
  weekdayBalance: 3,
  pairPenalty: 5,
  requestBonus: -5,
};

async function fetchDutyRules({ sectionId, serviceId = '', role = '', hospitalId = null }) {
  // Önce en spesifik kuralı ara; yoksa daha genel kuralı kullan
  const fallbacks = [
    { sectionId, serviceId, role },
    { sectionId, serviceId, role: '' },
    { sectionId, serviceId: '', role },
    { sectionId, serviceId: '', role: '' },
  ];

  let doc = null;
  for (const q of fallbacks) {
    doc = await DutyRule.findOne(hospitalId ? { ...q, hospitalId } : q).lean();
    if (doc) break;
  }

  const rules = { ...DEFAULT_RULES, ...basicRulesToSchedulerRules(doc?.basicRules) };
  const weights = { ...DEFAULT_WEIGHTS, ...(doc?.weights && !Array.isArray(doc.weights) ? doc.weights : {}) };
  return { doc, rules, weights };
}

async function resolveRules(params = {}) {
  const {
    sectionId,
    serviceId = '',
    role = '',
    hospitalId = null,
    rules: ruleOverrides = {},
    weights: weightOverrides = {},
  } = params || {};

  const { doc: ruleDoc, rules: dbRules, weights: dbWeights } = await fetchDutyRules({
    sectionId,
    serviceId,
    role,
    hospitalId,
  });

  return {
    ruleDoc: ruleDoc || null,
    hardConstraints: ruleDoc?.hardConstraints || {},
    softConstraints: ruleDoc?.softConstraints || {},
    policies: ruleDoc?.policies || {},
    rules: { ...dbRules, ...(ruleOverrides || {}) },
    weights: { ...dbWeights, ...(weightOverrides || {}) },
  };
}

module.exports = {
  DEFAULT_RULES,
  DEFAULT_WEIGHTS,
  fetchDutyRules,
  resolveRules,
};
