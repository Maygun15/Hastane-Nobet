"use strict";

const assert = require("assert");

const {
  RULE_CODES,
  evaluateCandidateShadow,
  listShadowRuleCodes,
  getRuleReadiness,
} = require("../services/scheduler/candidateBuilder");
const oneShiftPerDayRule = require("../services/scheduler/candidateBuilder/rules/oneShiftPerDay.rule");
const roleEligibilityRule = require("../services/scheduler/candidateBuilder/rules/roleEligibility.rule");
const sectionEligibilityRule = require("../services/scheduler/candidateBuilder/rules/sectionEligibility.rule");

function testOneShiftPerDayPass() {
  const result = oneShiftPerDayRule({
    personId: "p1",
    date: "2026-03-14",
    existingAssignments: [{ personId: "p1", date: "2026-03-13" }],
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.code, RULE_CODES.ONE_SHIFT_PER_DAY);
}

function testOneShiftPerDayFail() {
  const result = oneShiftPerDayRule({
    personId: "p1",
    date: "2026-03-14",
    existingAssignments: [{ staffId: "P1", assignmentDate: "2026-03-14", shiftId: "N" }],
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.code, RULE_CODES.ONE_SHIFT_PER_DAY);
  assert.strictEqual(result.meta.matchedAssignmentDate, "2026-03-14");
}

function testOneShiftPerDaySkipped() {
  const result = oneShiftPerDayRule({
    date: "2026-03-14",
    existingAssignments: [],
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.meta.skipped, true);
  assert.strictEqual(result.meta.reason, "PERSON_ID_MISSING");
}

function testRoleEligibilityPass() {
  const result = roleEligibilityRule({
    shift: { requiredRoles: ["Nurse"] },
    person: { meta: { roles: ["nurse", "charge"] } },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.code, RULE_CODES.ROLE_ELIGIBILITY);
}

function testRoleEligibilityFail() {
  const result = roleEligibilityRule({
    rules: { requiredRole: "admin" },
    person: { title: "nurse" },
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.code, RULE_CODES.ROLE_ELIGIBILITY);
}

function testRoleEligibilitySkipped() {
  const result = roleEligibilityRule({
    shift: {},
    person: { role: "nurse" },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.meta.skipped, true);
  assert.strictEqual(result.meta.reason, "ROLE_REQUIREMENT_MISSING");
}

function testRoleEligibilityFailClosed() {
  const result = roleEligibilityRule({
    options: { requiredRole: "nurse" },
    person: { id: "p1" },
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.meta.reason, "PERSON_ROLE_MISSING_FAIL_CLOSED");
}

function testSectionEligibilityPass() {
  const result = sectionEligibilityRule({
    shift: { area: "KIRMIZI" },
    person: { areas: "SARI, KIRMIZI" },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.code, RULE_CODES.SECTION_ELIGIBILITY);
}

function testSectionEligibilityFail() {
  const result = sectionEligibilityRule({
    day: { section: "SARI" },
    person: { section: "KIRMIZI" },
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.code, RULE_CODES.SECTION_ELIGIBILITY);
}

function testSectionEligibilitySkipped() {
  const result = sectionEligibilityRule({
    shift: {},
    person: { sections: ["er"] },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.meta.skipped, true);
  assert.strictEqual(result.meta.reason, "TARGET_SECTION_MISSING");
}

function testSectionEligibilityFailClosed() {
  const result = sectionEligibilityRule({
    section: "KIRMIZI",
    person: { id: "p1" },
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.meta.reason, "PERSON_SECTION_MISSING_FAIL_CLOSED");
}

function testSectionEligibilityResponsibilitySkipped() {
  const result = sectionEligibilityRule({
    section: "SERVİS SORUMLUSU",
    person: { sections: ["ER"] },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.meta.skipped, true);
  assert.strictEqual(result.meta.reason, "TASK_PLACE_NOT_SECTION");
  assert.strictEqual(result.meta.taskPlaceKind, "RESPONSIBILITY");
}

function testSectionEligibilityCompositeSkipped() {
  const result = sectionEligibilityRule({
    section: "KIRMIZI VE SARI ALAN GÖREVLENDİRME",
    person: { sections: ["KIRMIZI"] },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.meta.skipped, true);
  assert.strictEqual(result.meta.reason, "TASK_PLACE_COMPOSITE");
  assert.strictEqual(result.meta.taskPlaceKind, "COMPOSITE_WORK_AREA");
}

function testSectionEligibilityUnknownSkipped() {
  const result = sectionEligibilityRule({
    section: "BILINMEYEN GOREV YERI",
    person: { sections: ["ER"] },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.meta.skipped, true);
  assert.strictEqual(result.meta.reason, "TASK_PLACE_UNKNOWN");
  assert.strictEqual(result.meta.taskPlaceKind, "UNKNOWN");
}

function testShadowModeObservesRejectingRule() {
  const shadow = evaluateCandidateShadow({
    person: { id: "p1", active: true, serviceId: "svc-1", role: "nurse", section: "er" },
    day: { date: "2026-03-14" },
    shift: { code: "D", requiredRole: "admin", section: "er" },
    ruleCodes: [RULE_CODES.ROLE_ELIGIBILITY, RULE_CODES.SECTION_ELIGIBILITY],
    schedulerContext: { assignments: [] },
    assignmentState: { assignments: [] },
  });

  assert.strictEqual(shadow.personId, "p1");
  assert.strictEqual(shadow.wouldReject, true);
  assert.ok(shadow.triggeredRuleCodes.includes(RULE_CODES.ROLE_ELIGIBILITY));
  assert.ok(Array.isArray(shadow.observations));

  const observation = shadow.observations.find((item) => item.ruleCode === RULE_CODES.ROLE_ELIGIBILITY);
  assert.ok(observation, "shadow observation should include triggering rule");
  assert.strictEqual(observation.personId, "p1");
  assert.strictEqual(observation.triggered, true);
  assert.strictEqual(observation.wouldReject, true);
  assert.strictEqual(observation.enabled, false);
  assert.strictEqual(observation.rolloutStage, "shadow");
  assert.strictEqual(observation.shadowMode, true);
  assert.ok(typeof observation.message === "string" && observation.message.length > 0);
  assert.deepStrictEqual(observation.targetSummary.requiredRoles, ["admin"]);
  assert.strictEqual(observation.targetSummary.section, "er");
}

function testShadowModeObservesSkippedRule() {
  const shadow = evaluateCandidateShadow({
    person: { id: "p2", active: true },
    day: { date: "2026-03-14" },
    shift: { code: "D" },
    ruleCodes: [RULE_CODES.SECTION_ELIGIBILITY],
    schedulerContext: { assignments: [] },
    assignmentState: { assignments: [] },
  });

  assert.strictEqual(shadow.wouldReject, false);
  const observation = shadow.observations[0];
  assert.strictEqual(observation.ruleCode, RULE_CODES.SECTION_ELIGIBILITY);
  assert.strictEqual(observation.triggered, false);
  assert.strictEqual(observation.wouldReject, false);
  assert.strictEqual(observation.personId, "p2");
  assert.strictEqual(observation.targetSummary.targetSection, null);
}

function testShadowRuleCatalogHelpers() {
  const shadowRules = listShadowRuleCodes();
  assert.ok(shadowRules.includes(RULE_CODES.ONE_SHIFT_PER_DAY));
  assert.ok(shadowRules.includes(RULE_CODES.ROLE_ELIGIBILITY));
  assert.ok(shadowRules.includes(RULE_CODES.SECTION_ELIGIBILITY));

  const readiness = getRuleReadiness(RULE_CODES.ROLE_ELIGIBILITY);
  assert.ok(readiness, "readiness should exist for role rule");
  assert.strictEqual(readiness.enabled, false);
  assert.strictEqual(readiness.rolloutStage, "shadow");
  assert.strictEqual(readiness.shadowMode, true);
  assert.strictEqual(readiness.requiresCleanRoleData, true);
  assert.ok(Array.isArray(readiness.overrideScopeHints));
  assert.ok(readiness.overrideScopeHints.includes("service"));
}

function run() {
  const tests = [
    { name: "ONE_SHIFT_PER_DAY pass", fn: testOneShiftPerDayPass },
    { name: "ONE_SHIFT_PER_DAY fail", fn: testOneShiftPerDayFail },
    { name: "ONE_SHIFT_PER_DAY skipped", fn: testOneShiftPerDaySkipped },
    { name: "ROLE_ELIGIBILITY pass", fn: testRoleEligibilityPass },
    { name: "ROLE_ELIGIBILITY fail", fn: testRoleEligibilityFail },
    { name: "ROLE_ELIGIBILITY skipped", fn: testRoleEligibilitySkipped },
    { name: "ROLE_ELIGIBILITY fail-closed", fn: testRoleEligibilityFailClosed },
    { name: "SECTION_ELIGIBILITY pass", fn: testSectionEligibilityPass },
    { name: "SECTION_ELIGIBILITY fail", fn: testSectionEligibilityFail },
    { name: "SECTION_ELIGIBILITY skipped", fn: testSectionEligibilitySkipped },
    { name: "SECTION_ELIGIBILITY fail-closed", fn: testSectionEligibilityFailClosed },
    { name: "SECTION_ELIGIBILITY responsibility skipped", fn: testSectionEligibilityResponsibilitySkipped },
    { name: "SECTION_ELIGIBILITY composite skipped", fn: testSectionEligibilityCompositeSkipped },
    { name: "SECTION_ELIGIBILITY unknown skipped", fn: testSectionEligibilityUnknownSkipped },
    { name: "shadow mode triggered rule", fn: testShadowModeObservesRejectingRule },
    { name: "shadow mode skipped rule", fn: testShadowModeObservesSkippedRule },
    { name: "shadow rule catalog helpers", fn: testShadowRuleCatalogHelpers },
  ];

  let passed = 0;
  for (const test of tests) {
    try {
      test.fn();
      passed += 1;
      console.log(`PASS: ${test.name}`);
    } catch (error) {
      console.error(`FAIL: ${test.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
      break;
    }
  }

  if (!process.exitCode) {
    console.log(`All V2.2 candidateBuilder rule checks passed (${passed}/${tests.length}).`);
  }
}

run();
