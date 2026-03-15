"use strict";

const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");

/**
 * Rule: candidate must be active for scheduling.
 */
function activeRequiredRule(context = {}) {
  const person = context?.person || context?.candidate || null;
  if (!person || typeof person !== "object") {
    return makeRuleFail({
      code: "ACTIVE_REQUIRED",
      message: "Person record is missing.",
      meta: { reason: "PERSON_MISSING" },
    });
  }

  const isActiveFlag = person.active === true || person.isActive === true;
  const statusIsActive = String(person.status || "").trim().toLowerCase() === "active";
  const isActive = isActiveFlag || statusIsActive;

  if (isActive) {
    return makeRulePass({
      code: "ACTIVE_REQUIRED",
      message: "Person is active.",
      meta: {
        active: person.active === true,
        isActive: person.isActive === true,
        status: person.status || null,
      },
    });
  }

  return makeRuleFail({
    code: "ACTIVE_REQUIRED",
    message: "Person is not active.",
    meta: {
      active: person.active ?? null,
      isActive: person.isActive ?? null,
      status: person.status ?? null,
    },
  });
}

module.exports = activeRequiredRule;
