"use strict";

const assert = require("assert");
const path = require("path");

const enginePath = path.join(__dirname, "..", "services", "scheduler", "engine.js");
const auditPath = path.join(__dirname, "..", "services", "scheduler", "audit", "index.js");

function createRuntimePerson(id, overrides = {}) {
  return {
    id,
    name: `Person ${id}`,
    active: true,
    serviceId: "svc-1",
    totalHours: 0,
    totalShifts: 0,
    weekdayCount: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    pairHistory: {},
    assignedDays: [],
    weeklyCounts: {},
    taskCounts: {},
    consecutiveDays: 0,
    lastAssignedDate: null,
    lastShift: null,
    ...overrides,
  };
}

function createContext() {
  return {
    staff: [
      createRuntimePerson("p1", { role: "nurse", areas: ["KIRMIZI"] }),
      createRuntimePerson("p2", { title: "assistant", areas: ["SARI"] }),
      createRuntimePerson("p3", {}),
    ],
    days: [
      {
        date: "2026-03-14",
        weekday: 6,
        section: "KIRMIZI",
        shifts: [
          {
            id: "D",
            code: "D",
            serviceId: "svc-1",
            section: "KIRMIZI",
            requiredRole: "nurse",
            requiredCount: 1,
            hours: 8,
          },
        ],
      },
    ],
    leavesByPerson: {},
    requestsByPerson: {},
    rules: {},
    weights: {},
    issues: [],
    assignments: [
      {
        personId: "p1",
        assignmentDate: "2026-03-14",
        shiftId: "M",
      },
    ],
    targetHours: 0,
    targetShifts: 0,
    randomize: false,
    auditOptions: {
      enableShadowCollection: true,
    },
  };
}

function run() {
  delete require.cache[require.resolve(enginePath)];
  const { runScheduler } = require(enginePath);
  const result = runScheduler(createContext());

  assert.strictEqual(result.assignments.length, 2, "scheduler assignment flow must remain intact");
  assert.strictEqual(result.assignments[result.assignments.length - 1].personId, "p1", "scheduler selection must remain unchanged");
  assert.ok(result.shadowAudit, "shadowAudit must be attached when collection is enabled");
  assert.ok(Array.isArray(result.shadowAudit.observations), "shadow observations must be an array");
  assert.ok(result.shadowAudit.observations.length > 0, "shadow observations must be collected");
  assert.ok(result.shadowAudit.summary, "shadow summary must be calculated");

  const oneShiftRule = result.shadowAudit.summary.ruleSummary.find((item) => item.ruleCode === "ONE_SHIFT_PER_DAY");
  const roleRule = result.shadowAudit.summary.ruleSummary.find((item) => item.ruleCode === "ROLE_ELIGIBILITY");
  const sectionRule = result.shadowAudit.summary.ruleSummary.find((item) => item.ruleCode === "SECTION_ELIGIBILITY");

  assert.ok(oneShiftRule, "ONE_SHIFT_PER_DAY summary is required");
  assert.ok(roleRule, "ROLE_ELIGIBILITY summary is required");
  assert.ok(sectionRule, "SECTION_ELIGIBILITY summary is required");
  assert.strictEqual(oneShiftRule.wouldRejectCount, 1, "same-day assignment must be observed once");
  assert.strictEqual(roleRule.wouldRejectCount, 2, "role mismatches and missing role must be observed");
  assert.strictEqual(roleRule.missingDataRejectCount, 1, "missing role fail-closed must be counted");
  assert.strictEqual(sectionRule.wouldRejectCount, 2, "section mismatches and missing section must be observed");
  assert.strictEqual(sectionRule.missingDataRejectCount, 1, "missing section fail-closed must be counted");

  const personSummary = result.shadowAudit.summary.personSummary.find((item) => item.personId === "p2");
  assert.ok(personSummary, "person summary must include p2");
  assert.strictEqual(personSummary.wouldReject, true, "p2 should be marked as wouldReject");
  assert.ok(personSummary.triggeredRules.includes("ROLE_ELIGIBILITY"), "role trigger must be visible in person summary");
  assert.ok(personSummary.triggeredRules.includes("SECTION_ELIGIBILITY"), "section trigger must be visible in person summary");

  const serviceSummary = result.shadowAudit.summary.serviceSummary.find((item) => item.serviceId === "svc-1");
  assert.ok(serviceSummary, "service summary must include slot service");
  const sectionSummary = result.shadowAudit.summary.sectionSummary.find((item) => item.section === "KIRMIZI");
  assert.ok(sectionSummary, "section summary must include slot section");

  const { collectShadowObservations } = require(auditPath);
  const compositeObservations = collectShadowObservations({
    staff: [
      createRuntimePerson("p10", { areas: ["KIRMIZI"] }),
      createRuntimePerson("p11", { areas: ["YEŞİL"] }),
    ],
    day: { date: "2026-03-14" },
    shift: {
      code: "D",
      section: "KIRMIZI VE SARI ALAN GÖREVLENDİRME",
      serviceId: "svc-1",
    },
    section: "KIRMIZI VE SARI ALAN GÖREVLENDİRME",
    serviceId: "svc-1",
    options: {
      enableCompositeTaskPlaceShadow: true,
    },
  });

  const compositeRule = compositeObservations.filter(
    (item) => item.ruleCode === "COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW"
  );
  assert.strictEqual(compositeRule.length, 2, "composite shadow observation must be produced for each person");
  const eligibleComposite = compositeRule.find((item) => item.personId === "p10");
  const rejectedComposite = compositeRule.find((item) => item.personId === "p11");
  assert.ok(eligibleComposite, "eligible composite observation must exist");
  assert.ok(rejectedComposite, "rejected composite observation must exist");
  assert.strictEqual(eligibleComposite.wouldReject, false, "eligible composite candidate must not be marked as reject");
  assert.strictEqual(rejectedComposite.wouldReject, true, "ineligible composite candidate must be marked as wouldReject");
  assert.strictEqual(rejectedComposite.reasonCode, "COMPOSITE_WORK_AREA_NOT_ELIGIBLE");
  assert.strictEqual(rejectedComposite.taskPlaceKind, "COMPOSITE_WORK_AREA");
  assert.strictEqual(rejectedComposite.targetLabel, "KIRMIZI VE SARI ALAN GÖREVLENDİRME");
  assert.deepStrictEqual(rejectedComposite.eligibleWorkAreasAnyOf, ["KIRMIZI", "SARI"]);

  console.log("Shadow audit collector checks passed.");
}

run();
