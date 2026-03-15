"use strict";

const CANDIDATE_RULE_CODES = require("../candidateBuilder/ruleCodes");
const {
  UNIFIED_RULE_TYPES,
  UNIFIED_RULE_BEHAVIORS,
} = require("./unifiedRuleConstants");

/**
 * Unified hard rule registry starter.
 * This is metadata-only for now and does not change scheduler execution behavior.
 */
const UNIFIED_RULES = Object.freeze([
  makeRule({
    code: "ONE_SHIFT_PER_DAY",
    labelTr: "Bir personele aynı gün içinde yalnızca tek vardiya atanabilir",
    category: "Vardiya ve Dinlenme",
    type: UNIFIED_RULE_TYPES.HARD,
    behavior: UNIFIED_RULE_BEHAVIORS.BLOCK,
    scope: "PERSON_DAY",
    activeByDefault: true,
    schedulerKey: "ONE_SHIFT_PER_DAY",
    candidateRuleCode: CANDIDATE_RULE_CODES.ONE_SHIFT_PER_DAY,
    evaluatorKey: "oneShiftPerDay",
    locked: true,
  }),
  makeRule({
    code: "LEAVE_BLOCK",
    labelTr: "İzinli veya raporlu personele nöbet atanamaz",
    category: "İzin ve Uygunluk",
    type: UNIFIED_RULE_TYPES.HARD,
    behavior: UNIFIED_RULE_BEHAVIORS.BLOCK,
    scope: "PERSON_DAY",
    activeByDefault: true,
    schedulerKey: "LEAVE_BLOCK",
    candidateRuleCode: CANDIDATE_RULE_CODES.LEAVE_BLOCK,
    evaluatorKey: "leaveBlock",
    locked: true,
  }),
  makeRule({
    code: "REST_AFTER_NIGHT",
    labelTr: "Gece nöbeti sonrası zorunlu dinlenme sağlanmalıdır",
    category: "Vardiya ve Dinlenme",
    type: UNIFIED_RULE_TYPES.HARD,
    behavior: UNIFIED_RULE_BEHAVIORS.BLOCK,
    scope: "PERSON_DAY",
    activeByDefault: true,
    schedulerKey: "NIGHT_NEXT_DAY_OFF",
    candidateRuleCode: CANDIDATE_RULE_CODES.REST_AFTER_NIGHT,
    evaluatorKey: "restAfterNight",
    locked: true,
  }),
  makeRule({
    code: "MIN_REST_HOURS",
    labelTr: "Vardiyalar arasında minimum dinlenme süresi korunmalıdır",
    category: "Vardiya ve Dinlenme",
    type: UNIFIED_RULE_TYPES.HARD,
    behavior: UNIFIED_RULE_BEHAVIORS.BLOCK,
    scope: "PERSON_SHIFT",
    activeByDefault: true,
    schedulerKey: "MIN_REST_HOURS",
    candidateRuleCode: null,
    evaluatorKey: "minRestHours",
    locked: true,
  }),
  makeRule({
    code: "ROLE_ELIGIBILITY",
    labelTr: "Personel yalnızca rolüne uygun görevlere atanabilir",
    category: "Yetkinlik ve Uygunluk",
    type: UNIFIED_RULE_TYPES.HARD,
    behavior: UNIFIED_RULE_BEHAVIORS.BLOCK,
    scope: "PERSON_SHIFT",
    activeByDefault: false,
    schedulerKey: null,
    candidateRuleCode: CANDIDATE_RULE_CODES.ROLE_ELIGIBILITY,
    evaluatorKey: "roleEligibility",
    locked: true,
  }),
  makeRule({
    code: "SECTION_ELIGIBILITY",
    labelTr: "Personel yalnızca yetkili olduğu çalışma alanlarında görevlendirilebilir",
    category: "Yetkinlik ve Uygunluk",
    type: UNIFIED_RULE_TYPES.HARD,
    behavior: UNIFIED_RULE_BEHAVIORS.BLOCK,
    scope: "PERSON_SHIFT",
    activeByDefault: false,
    schedulerKey: null,
    candidateRuleCode: CANDIDATE_RULE_CODES.SECTION_ELIGIBILITY,
    evaluatorKey: "sectionEligibility",
    locked: true,
  }),
  makeRule({
    code: "ACTIVE_REQUIRED",
    labelTr: "Pasif personel planlamaya dahil edilmemelidir",
    category: "Temel Uygunluk",
    type: UNIFIED_RULE_TYPES.HARD,
    behavior: UNIFIED_RULE_BEHAVIORS.BLOCK,
    scope: "PERSON",
    activeByDefault: true,
    schedulerKey: null,
    candidateRuleCode: CANDIDATE_RULE_CODES.ACTIVE_REQUIRED,
    evaluatorKey: "activeRequired",
    locked: true,
  }),
  makeRule({
    code: "SERVICE_MATCH",
    labelTr: "Personel yalnızca bağlı olduğu hizmet alanında planlanmalıdır",
    category: "Temel Uygunluk",
    type: UNIFIED_RULE_TYPES.HARD,
    behavior: UNIFIED_RULE_BEHAVIORS.BLOCK,
    scope: "PERSON_SHIFT",
    activeByDefault: true,
    schedulerKey: null,
    candidateRuleCode: CANDIDATE_RULE_CODES.SERVICE_MATCH,
    evaluatorKey: "serviceMatch",
    locked: true,
  }),
]);

const RULE_BY_CODE = buildIndex(UNIFIED_RULES, "code");
const RULE_BY_SCHEDULER_KEY = buildIndex(UNIFIED_RULES, "schedulerKey");
const RULE_BY_CANDIDATE_CODE = buildIndex(UNIFIED_RULES, "candidateRuleCode");

function listUnifiedRules() {
  return UNIFIED_RULES.map(cloneRule);
}

function getUnifiedRuleByCode(code) {
  const normalizedCode = normalizeValue(code);
  if (!normalizedCode) return null;
  const rule = RULE_BY_CODE.get(normalizedCode);
  return rule ? cloneRule(rule) : null;
}

function resolveUnifiedRuleFromLegacyKey(key) {
  const normalizedKey = normalizeValue(key);
  if (!normalizedKey) return null;

  const directMatch =
    RULE_BY_CODE.get(normalizedKey) ||
    RULE_BY_SCHEDULER_KEY.get(normalizedKey) ||
    RULE_BY_CANDIDATE_CODE.get(normalizedKey);

  return directMatch ? cloneRule(directMatch) : null;
}

function makeRule(definition = {}) {
  return Object.freeze({
    code: normalizeValue(definition.code),
    labelTr: normalizeValue(definition.labelTr),
    category: normalizeValue(definition.category),
    type: normalizeValue(definition.type),
    behavior: normalizeValue(definition.behavior),
    scope: normalizeValue(definition.scope),
    activeByDefault: definition.activeByDefault === true,
    schedulerKey: normalizeValue(definition.schedulerKey),
    candidateRuleCode: normalizeValue(definition.candidateRuleCode),
    evaluatorKey: normalizeValue(definition.evaluatorKey),
    locked: definition.locked !== false,
  });
}

function buildIndex(items, field) {
  const index = new Map();

  for (const item of items) {
    const value = normalizeValue(item?.[field]);
    if (!value) continue;
    if (!index.has(value)) {
      index.set(value, item);
    }
  }

  return index;
}

function cloneRule(rule) {
  return { ...rule };
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = Object.freeze({
  UNIFIED_RULES,
  getUnifiedRuleByCode,
  listUnifiedRules,
  resolveUnifiedRuleFromLegacyKey,
});
