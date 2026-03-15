"use strict";

const {
  getUnifiedRuleByCode,
  listUnifiedRules,
  resolveUnifiedRuleFromLegacyKey,
} = require("./unifiedRuleRegistry");

/**
 * DB-side identity adapter for duty rules.
 * This is read-only metadata mapping; it does not change persistence or runtime behavior.
 */
const DB_TO_UNIFIED_MAPPINGS = Object.freeze([
  makeDbRuleMapping({
    dbKey: "ONE_SHIFT_PER_DAY",
    unifiedCode: "ONE_SHIFT_PER_DAY",
    schedulerKey: "ONE_SHIFT_PER_DAY",
    candidateRuleCode: "ONE_SHIFT_PER_DAY",
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "LEAVE_BLOCK",
    unifiedCode: "LEAVE_BLOCK",
    schedulerKey: "LEAVE_BLOCK",
    candidateRuleCode: "LEAVE_BLOCK",
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "NIGHT_NEXT_DAY_OFF",
    unifiedCode: "REST_AFTER_NIGHT",
    schedulerKey: "NIGHT_NEXT_DAY_OFF",
    candidateRuleCode: "REST_AFTER_NIGHT",
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "MIN_REST_HOURS",
    unifiedCode: "MIN_REST_HOURS",
    schedulerKey: "MIN_REST_HOURS",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "MAX_CONSECUTIVE_DAYS",
    unifiedCode: "MAX_CONSECUTIVE_DAYS",
    schedulerKey: "MAX_CONSECUTIVE_DAYS",
    candidateRuleCode: "MAX_CONSECUTIVE_DAYS",
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "MAX_SHIFTS_PER_WEEK",
    unifiedCode: "MAX_SHIFTS_PER_WEEK",
    schedulerKey: "MAX_SHIFTS_PER_WEEK",
    candidateRuleCode: "MAX_WEEKLY_SHIFTS",
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "MAX_TASK_PER_PERSON",
    unifiedCode: "MAX_TASK_PER_PERSON",
    schedulerKey: "MAX_TASK_PER_PERSON",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "WEEKLY_MAX_SHIFTS",
    unifiedCode: "MAX_SHIFTS_PER_WEEK",
    schedulerKey: "MAX_SHIFTS_PER_WEEK",
    candidateRuleCode: "MAX_WEEKLY_SHIFTS",
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "WEEKLY_MAX_DUTIES",
    unifiedCode: "MAX_SHIFTS_PER_WEEK",
    schedulerKey: "MAX_SHIFTS_PER_WEEK",
    candidateRuleCode: "MAX_WEEKLY_SHIFTS",
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "MAX_CONSECUTIVE_6D",
    unifiedCode: "MAX_CONSECUTIVE_DAYS",
    schedulerKey: "MAX_CONSECUTIVE_DAYS",
    candidateRuleCode: "MAX_CONSECUTIVE_DAYS",
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "MIN_REST_11H",
    unifiedCode: "MIN_REST_HOURS",
    schedulerKey: "MIN_REST_HOURS",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "MIN_GAP_12H",
    unifiedCode: "MIN_REST_HOURS",
    schedulerKey: "MIN_REST_HOURS",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeDbRuleMapping({
    dbKey: "ROLE_ELIGIBILITY",
    unifiedCode: "ROLE_ELIGIBILITY",
    schedulerKey: null,
    candidateRuleCode: "ROLE_ELIGIBILITY",
    mappingConfidence: "optional",
  }),
  makeDbRuleMapping({
    dbKey: "SECTION_ELIGIBILITY",
    unifiedCode: "SECTION_ELIGIBILITY",
    schedulerKey: null,
    candidateRuleCode: "SECTION_ELIGIBILITY",
    mappingConfidence: "optional",
  }),
  makeDbRuleMapping({
    dbKey: "ACTIVE_REQUIRED",
    unifiedCode: "ACTIVE_REQUIRED",
    schedulerKey: null,
    candidateRuleCode: "ACTIVE_REQUIRED",
    mappingConfidence: "optional",
  }),
  makeDbRuleMapping({
    dbKey: "SERVICE_MATCH",
    unifiedCode: "SERVICE_MATCH",
    schedulerKey: null,
    candidateRuleCode: "SERVICE_MATCH",
    mappingConfidence: "optional",
  }),
]);

const MAPPING_BY_DB_KEY = buildIndex(DB_TO_UNIFIED_MAPPINGS, "dbKey");
const MAPPING_BY_UNIFIED_CODE = buildPreferredUnifiedIndex(DB_TO_UNIFIED_MAPPINGS);

function resolveUnifiedCodeFromDbRule(ruleLike) {
  const candidates = getRuleIdentityCandidates(ruleLike);

  for (const candidate of candidates) {
    const mapped = MAPPING_BY_DB_KEY.get(candidate);
    if (mapped?.unifiedCode) return mapped.unifiedCode;

    const unifiedRule = resolveUnifiedRuleFromLegacyKey(candidate);
    if (unifiedRule?.code) return unifiedRule.code;
  }

  return null;
}

function resolveDbRuleKeyFromUnifiedCode(code) {
  const normalizedCode = normalizeValue(code);
  if (!normalizedCode) return null;

  const mapped = MAPPING_BY_UNIFIED_CODE.get(normalizedCode);
  if (mapped?.dbKey) return mapped.dbKey;

  const unifiedRule = getUnifiedRuleByCode(normalizedCode);
  return unifiedRule?.schedulerKey || unifiedRule?.code || null;
}

function listDbToUnifiedMappings() {
  return DB_TO_UNIFIED_MAPPINGS.map((item) => ({ ...item }));
}

function getRuleIdentityCandidates(ruleLike) {
  if (typeof ruleLike === "string") {
    const normalized = normalizeValue(ruleLike);
    return normalized ? [normalized] : [];
  }

  if (!ruleLike || typeof ruleLike !== "object") {
    return [];
  }

  const values = [
    ruleLike.dbKey,
    ruleLike.id,
    ruleLike.type,
    ruleLike.code,
    ruleLike.key,
    ruleLike.schedulerKey,
    ruleLike.candidateRuleCode,
    ruleLike.unifiedCode,
  ];

  return Array.from(new Set(values.map(normalizeValue).filter(Boolean)));
}

function makeDbRuleMapping({
  dbKey,
  unifiedCode,
  schedulerKey = null,
  candidateRuleCode = null,
  mappingConfidence = "exact",
} = {}) {
  return Object.freeze({
    dbKey: normalizeValue(dbKey),
    unifiedCode: normalizeValue(unifiedCode),
    schedulerKey: normalizeValue(schedulerKey),
    candidateRuleCode: normalizeValue(candidateRuleCode),
    mappingConfidence: normalizeValue(mappingConfidence) || "exact",
  });
}

function buildIndex(items, field) {
  const index = new Map();

  for (const item of items) {
    const key = normalizeValue(item?.[field]);
    if (!key || index.has(key)) continue;
    index.set(key, item);
  }

  return index;
}

function buildPreferredUnifiedIndex(items) {
  const index = new Map();

  for (const item of items) {
    const key = normalizeValue(item?.unifiedCode);
    if (!key) continue;

    const current = index.get(key);
    if (!current) {
      index.set(key, item);
      continue;
    }

    if (current.mappingConfidence !== "exact" && item.mappingConfidence === "exact") {
      index.set(key, item);
    }
  }

  return index;
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = Object.freeze({
  resolveUnifiedCodeFromDbRule,
  resolveDbRuleKeyFromUnifiedCode,
  listDbToUnifiedMappings,
});
