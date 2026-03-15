"use strict";

const RULE_CODES = require("../ruleCodes");
const REASON_CODES = require("../reasonCodes");
const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");
const {
  resolveTaskPlaceDefinition,
  TASK_PLACE_KINDS,
  normalizeTaskPlaceKey,
} = require("../taskPlaceTaxonomy");

/**
 * Hard rule: checks section/area compatibility between slot and person.
 * Policy: fail-closed when target section exists but person section data is missing.
 */
function sectionEligibilityRule(context = {}) {
  // Source precedence is documented in contextContract.SECTION_TARGET_PRECEDENCE.
  const rawTargetTaskPlace = normalizeDisplayValue(
    context?.section ??
      context?.shift?.section ??
      context?.shift?.area ??
      context?.day?.section
  );

  if (!rawTargetTaskPlace) {
    return makeRulePass({
      code: RULE_CODES.SECTION_ELIGIBILITY,
      message: "Target section is missing. Rule skipped.",
      meta: {
        skipped: true,
        reason: REASON_CODES.TARGET_SECTION_MISSING,
      },
    });
  }

  const taskPlaceDefinition = resolveTaskPlaceDefinition(rawTargetTaskPlace);
  if (taskPlaceDefinition.kind === TASK_PLACE_KINDS.RESPONSIBILITY) {
    return makeRulePass({
      code: RULE_CODES.SECTION_ELIGIBILITY,
      message: "Target task place is not a section. Rule skipped.",
      meta: {
        skipped: true,
        reason: REASON_CODES.TASK_PLACE_NOT_SECTION,
        taskPlaceKind: taskPlaceDefinition.kind,
        resolvedLabel: taskPlaceDefinition.label,
        normalizedKey: taskPlaceDefinition.normalizedKey,
      },
    });
  }

  if (taskPlaceDefinition.kind === TASK_PLACE_KINDS.COMPOSITE_WORK_AREA) {
    return makeRulePass({
      code: RULE_CODES.SECTION_ELIGIBILITY,
      message: "Target task place is composite. Rule skipped.",
      meta: {
        skipped: true,
        reason: REASON_CODES.TASK_PLACE_COMPOSITE,
        taskPlaceKind: taskPlaceDefinition.kind,
        resolvedLabel: taskPlaceDefinition.label,
        normalizedKey: taskPlaceDefinition.normalizedKey,
      },
    });
  }

  if (taskPlaceDefinition.kind === TASK_PLACE_KINDS.UNKNOWN) {
    return makeRulePass({
      code: RULE_CODES.SECTION_ELIGIBILITY,
      message: "Target task place is unknown. Rule skipped.",
      meta: {
        skipped: true,
        reason: REASON_CODES.TASK_PLACE_UNKNOWN,
        taskPlaceKind: taskPlaceDefinition.kind,
        resolvedLabel: taskPlaceDefinition.label || rawTargetTaskPlace,
        normalizedKey: taskPlaceDefinition.normalizedKey,
      },
    });
  }

  const targetSection = taskPlaceDefinition.normalizedKey;
  const personSections = extractPersonSections(context?.person || context?.candidate);
  if (!personSections.length) {
    return makeRuleFail({
      code: RULE_CODES.SECTION_ELIGIBILITY,
      message: "Person section data is missing while target section is defined.",
      meta: {
        reason: REASON_CODES.PERSON_SECTION_MISSING_FAIL_CLOSED,
        taskPlaceKind: taskPlaceDefinition.kind,
        resolvedLabel: taskPlaceDefinition.label,
        normalizedKey: taskPlaceDefinition.normalizedKey,
        targetSection,
      },
    });
  }

  if (personSections.includes(targetSection)) {
    return makeRulePass({
      code: RULE_CODES.SECTION_ELIGIBILITY,
      message: "Person is section-eligible.",
      meta: {
        taskPlaceKind: taskPlaceDefinition.kind,
        resolvedLabel: taskPlaceDefinition.label,
        normalizedKey: taskPlaceDefinition.normalizedKey,
        targetSection,
        personSections,
      },
    });
  }

  return makeRuleFail({
    code: RULE_CODES.SECTION_ELIGIBILITY,
    message: "Person is not eligible for target section.",
    meta: {
      taskPlaceKind: taskPlaceDefinition.kind,
      resolvedLabel: taskPlaceDefinition.label,
      normalizedKey: taskPlaceDefinition.normalizedKey,
      targetSection,
      personSections,
    },
  });
}

function extractPersonSections(person) {
  if (!person || typeof person !== "object") return [];

  const values = normalizeList(
    person?.sections ??
    person?.section ??
    person?.area ??
    person?.areas ??
    person?.meta?.sections ??
    person?.meta?.areas ??
    person?.meta?.section ??
    person?.meta?.area
  );

  return Array.from(new Set(values));
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTaskPlaceKey(item))
      .filter(Boolean);
  }

  if (typeof value === "string" && value.includes(",")) {
    return value
      .split(",")
      .map((item) => normalizeTaskPlaceKey(item))
      .filter(Boolean);
  }

  const one = normalizeTaskPlaceKey(value);
  return one ? [one] : [];
}

function normalizeDisplayValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = sectionEligibilityRule;
