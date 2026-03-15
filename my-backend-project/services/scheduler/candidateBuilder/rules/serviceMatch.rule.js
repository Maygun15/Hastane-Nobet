"use strict";

const REASON_CODES = require("../reasonCodes");
const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");

/**
 * Rule: candidate should match target service/area requirements.
 */
function serviceMatchRule(context = {}) {
  const person = context?.person || context?.candidate || null;
  const targetServiceId = normalizeId(
    context?.serviceId ?? context?.shift?.serviceId ?? context?.day?.serviceId
  );

  if (!targetServiceId) {
    return makeRulePass({
      code: "SERVICE_MATCH",
      message: "Target service is missing. Rule skipped.",
      meta: {
        skipped: true,
        reason: REASON_CODES.SERVICE_ID_MISSING,
      },
    });
  }

  if (!person || typeof person !== "object") {
    return makeRuleFail({
      code: "SERVICE_MATCH",
      message: "Person record is missing.",
      meta: {
        reason: REASON_CODES.PERSON_MISSING,
        targetServiceId,
      },
    });
  }

  const personServiceId = extractPersonServiceId(person);
  if (!personServiceId) {
    return makeRuleFail({
      code: "SERVICE_MATCH",
      message: "Person service information is missing.",
      meta: {
        reason: REASON_CODES.PERSON_SERVICE_MISSING,
        targetServiceId,
      },
    });
  }

  if (personServiceId === targetServiceId) {
    return makeRulePass({
      code: "SERVICE_MATCH",
      message: "Person service matches target service.",
      meta: {
        targetServiceId,
        personServiceId,
      },
    });
  }

  return makeRuleFail({
    code: "SERVICE_MATCH",
    message: "Person service does not match target service.",
    meta: {
      targetServiceId,
      personServiceId,
    },
  });
}

function extractPersonServiceId(person) {
  const fromNested = normalizeId(person?.service?._id ?? person?.service?.id);
  if (fromNested) return fromNested;

  const fromDirect = normalizeId(person?.serviceId);
  if (fromDirect) return fromDirect;

  if (typeof person?.service === "string" || typeof person?.service === "number") {
    return normalizeId(person.service);
  }

  return null;
}

function normalizeId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.toLowerCase();
}

module.exports = serviceMatchRule;
