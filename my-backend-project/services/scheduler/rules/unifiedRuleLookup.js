"use strict";

const {
  resolveUnifiedCodeFromDbRule,
} = require("./dbRuleAdapter");
const {
  getUnifiedRuleByCode,
} = require("./unifiedRuleRegistry");

/**
 * Scheduler-side unified rule lookup foundation.
 * This is intentionally read-only and must not affect enforcement.
 */
function lookupUnifiedRuleCode(ruleLike) {
  return resolveUnifiedCodeFromDbRule(ruleLike);
}

function lookupUnifiedRule(ruleLike) {
  const unifiedCode = lookupUnifiedRuleCode(ruleLike);
  if (!unifiedCode) return null;
  return getUnifiedRuleByCode(unifiedCode);
}

function explainUnifiedRule(ruleLike) {
  const legacyKey = extractLegacyKey(ruleLike);
  const unifiedRule = lookupUnifiedRule(ruleLike);

  if (!unifiedRule) {
    return {
      legacyKey,
      unifiedCode: null,
      labelTr: null,
      type: null,
      category: null,
      locked: null,
      found: false,
    };
  }

  return {
    legacyKey,
    unifiedCode: unifiedRule.code || null,
    labelTr: unifiedRule.labelTr || null,
    type: unifiedRule.type || null,
    category: unifiedRule.category || null,
    locked: unifiedRule.locked === true,
    found: true,
  };
}

function extractLegacyKey(ruleLike) {
  if (typeof ruleLike === "string") {
    return normalizeValue(ruleLike);
  }

  if (!ruleLike || typeof ruleLike !== "object") {
    return null;
  }

  return (
    normalizeValue(ruleLike.key) ||
    normalizeValue(ruleLike.schedulerKey) ||
    normalizeValue(ruleLike.id) ||
    normalizeValue(ruleLike.code) ||
    normalizeValue(ruleLike.type) ||
    null
  );
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = Object.freeze({
  lookupUnifiedRule,
  lookupUnifiedRuleCode,
  explainUnifiedRule,
});
