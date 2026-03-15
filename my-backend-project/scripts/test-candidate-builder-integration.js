"use strict";

const assert = require("assert");
const path = require("path");

const candidateBuilderPath = path.join(
  __dirname,
  "..",
  "services",
  "scheduler",
  "candidateBuilder",
  "index.js"
);
const enginePath = path.join(__dirname, "..", "services", "scheduler", "engine.js");

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

function createBaseContext(overrides = {}) {
  return {
    staff: [
      createRuntimePerson("p1", { active: true, serviceId: "svc-1" }),
      createRuntimePerson("p2", { active: false, serviceId: "svc-1" }),
    ],
    days: [
      {
        date: "2026-03-14",
        weekday: 6,
        shifts: [
          {
            id: "D",
            code: "D",
            serviceId: "svc-1",
            section: "ER",
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
    assignments: [],
    targetHours: 0,
    targetShifts: 0,
    randomize: false,
    ...overrides,
  };
}

function withScheduler(mockBuildCandidates, fn) {
  const candidateBuilder = require(candidateBuilderPath);
  const originalBuildCandidates = candidateBuilder.buildCandidates;
  if (typeof mockBuildCandidates === "function") {
    candidateBuilder.buildCandidates = mockBuildCandidates;
  }

  delete require.cache[require.resolve(enginePath)];
  const { runScheduler } = require(enginePath);

  try {
    fn(runScheduler);
  } finally {
    candidateBuilder.buildCandidates = originalBuildCandidates;
    delete require.cache[require.resolve(enginePath)];
  }
}

function getSingleAudit(resultContext) {
  assert.ok(Array.isArray(resultContext.candidateAudit), "candidateAudit must be an array");
  assert.ok(resultContext.candidateAudit.length >= 1, "candidateAudit must include slot record");
  return resultContext.candidateAudit[0];
}

function assertAuditShape(audit) {
  const requiredKeys = [
    "inputStaffCount",
    "eligibleCount",
    "rejectedCount",
    "fallbackUsed",
    "fallbackReason",
    "postConstraintCount",
    "rejected",
  ];

  for (const key of requiredKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(audit, key), `audit.${key} is required`);
  }
}

function testEligiblePath() {
  withScheduler(null, (runScheduler) => {
    const context = createBaseContext();
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "one assignment should be created");
    assert.strictEqual(result.assignments[0].personId, "p1", "eligible candidate should be selected");

    const audit = getSingleAudit(result);
    assertAuditShape(audit);
    assert.strictEqual(audit.fallbackUsed, false, "fallback should not be used on eligible path");
    assert.strictEqual(audit.fallbackReason, null, "fallbackReason should be null on eligible path");
    assert.strictEqual(audit.inputStaffCount, 2, "inputStaffCount should match slot staff pool");
    assert.strictEqual(audit.eligibleCount, 1, "eligibleCount should reflect candidate builder result");
    assert.strictEqual(audit.rejectedCount, 1, "rejectedCount should reflect candidate builder result");
  });
}

function testFallbackOnEmpty() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [{ personId: "p1", failedRules: [{ code: "ACTIVE_REQUIRED" }] }],
    candidates: [],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 1 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { active: true }),
        createRuntimePerson("p2", { active: true }),
      ],
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "scheduler should continue with fallback pool");
    const audit = getSingleAudit(result);
    assertAuditShape(audit);
    assert.strictEqual(audit.fallbackUsed, true, "fallback should be used when eligible is empty");
    assert.strictEqual(
      audit.fallbackReason,
      "NO_ELIGIBLE_FROM_CANDIDATE_BUILDER",
      "fallback reason should match empty eligible behavior"
    );
  });
}

function testFallbackOnError() {
  const mockBuildCandidates = () => {
    throw new Error("mock candidate builder failure");
  };

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { active: true }),
        createRuntimePerson("p2", { active: true }),
      ],
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "scheduler should continue when builder throws");
    const audit = getSingleAudit(result);
    assertAuditShape(audit);
    assert.strictEqual(audit.fallbackUsed, true, "fallback should be used on builder error");
    assert.strictEqual(
      audit.fallbackReason,
      "CANDIDATE_BUILDER_ERROR",
      "fallback reason should match error behavior"
    );
    assert.ok(
      String(audit.error || "").includes("mock candidate builder failure"),
      "error message should be preserved in audit"
    );
  });
}

function testAuditPopulation() {
  withScheduler(null, (runScheduler) => {
    const context = createBaseContext();
    const result = runScheduler(context);
    const audit = getSingleAudit(result);

    assertAuditShape(audit);
    assert.ok(Array.isArray(audit.rejected), "rejected summary should be an array");
    if (audit.rejected.length > 0) {
      const firstRejected = audit.rejected[0];
      assert.ok(Object.prototype.hasOwnProperty.call(firstRejected, "personId"), "rejected summary personId is required");
      assert.ok(
        Object.prototype.hasOwnProperty.call(firstRejected, "failedRuleCodes"),
        "rejected summary failedRuleCodes is required"
      );
    }
  });
}

function testHardRejectFiltering() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [
      {
        personId: "p1",
        person: staff.find((item) => item.id === "p1") || null,
        failedRules: [],
        status: "eligible",
      },
    ],
    rejected: [
      {
        personId: "p2",
        person: staff.find((item) => item.id === "p2") || null,
        failedRules: [{ code: "ACTIVE_REQUIRED", severity: "hard" }],
        status: "rejected",
      },
    ],
    candidates: [staff.find((item) => item.id === "p1") || null],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 1, rejectedCount: 1 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { totalHours: 100 }),
        createRuntimePerson("p2", { totalHours: 0 }),
      ],
      targetHours: 50,
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "one assignment should be created");
    assert.strictEqual(
      result.assignments[0].personId,
      "p1",
      "hard-rejected candidate must not enter selection pool when fallback is not used"
    );

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, false, "fallback should not be used when eligible exists");
    assert.strictEqual(audit.eligibleCount, 1, "eligible count should reflect filtered pool");
    assert.strictEqual(audit.rejectedCount, 1, "rejected count should reflect filtered-out candidates");
  });
}

function run() {
  const tests = [
    { name: "eligible path", fn: testEligiblePath },
    { name: "fallback on empty", fn: testFallbackOnEmpty },
    { name: "fallback on error", fn: testFallbackOnError },
    { name: "audit population", fn: testAuditPopulation },
    { name: "hard reject filtering", fn: testHardRejectFiltering },
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
    console.log(`All candidateBuilder integration checks passed (${passed}/${tests.length}).`);
  }
}

run();
