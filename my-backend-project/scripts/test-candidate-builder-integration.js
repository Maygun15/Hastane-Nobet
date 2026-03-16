"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const candidateBuilderPath = path.join(
  __dirname,
  "..",
  "services",
  "scheduler",
  "candidateBuilder",
  "index.js"
);
const constraintsPath = path.join(__dirname, "..", "services", "scheduler", "constraints.js");
const enginePath = path.join(__dirname, "..", "services", "scheduler", "engine.js");
const standardProfilePath = path.join(__dirname, "..", "..", "config", "rules", "standard-profile.json");

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

function withSchedulerHarness({ mockBuildCandidates = null, mockIsAvailable = null } = {}, fn) {
  const candidateBuilder = require(candidateBuilderPath);
  const constraints = require(constraintsPath);
  const originalBuildCandidates = candidateBuilder.buildCandidates;
  const originalIsAvailable = constraints.isAvailable;

  if (typeof mockBuildCandidates === "function") {
    candidateBuilder.buildCandidates = mockBuildCandidates;
  }
  if (typeof mockIsAvailable === "function") {
    constraints.isAvailable = mockIsAvailable;
  }

  delete require.cache[require.resolve(enginePath)];
  const { runScheduler } = require(enginePath);

  try {
    fn(runScheduler);
  } finally {
    candidateBuilder.buildCandidates = originalBuildCandidates;
    constraints.isAvailable = originalIsAvailable;
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

function testFallbackExcludesActiveRequiredHardBlockedCandidates() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [
      {
        personId: "p1",
        person: staff.find((item) => item.id === "p1") || null,
        failedRules: [{ code: "ACTIVE_REQUIRED", severity: "hard" }],
        hardRejected: true,
        blockingRules: ["ACTIVE_REQUIRED"],
        reasonCodes: ["PERSON_NOT_ACTIVE"],
        status: "rejected",
      },
    ],
    candidates: [],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 1 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { active: false, totalHours: 0 }),
        createRuntimePerson("p2", { active: true, totalHours: 100 }),
      ],
      targetHours: 50,
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "fallback should still allow assignment when safe pool remains");
    assert.strictEqual(
      result.assignments[0].personId,
      "p2",
      "ACTIVE_REQUIRED hard-blocked candidate must not re-enter fallback pool"
    );

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, true);
    assert.strictEqual(audit.hardFilteredByCandidateBuilderCount, 1);
    assert.strictEqual(audit.hardFilteredBlockingRules.ACTIVE_REQUIRED, 1);
  });
}

function testFallbackExcludesServiceMatchHardBlockedCandidates() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [
      {
        personId: "p1",
        person: staff.find((item) => item.id === "p1") || null,
        failedRules: [{ code: "SERVICE_MATCH", severity: "hard" }],
        hardRejected: true,
        blockingRules: ["SERVICE_MATCH"],
        reasonCodes: ["PERSON_SERVICE_MISSING"],
        status: "rejected",
      },
    ],
    candidates: [],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 1 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { serviceId: "svc-2", totalHours: 0 }),
        createRuntimePerson("p2", { serviceId: "svc-1", totalHours: 100 }),
      ],
      targetHours: 50,
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "fallback should keep service-matching candidate available");
    assert.strictEqual(
      result.assignments[0].personId,
      "p2",
      "SERVICE_MATCH hard-blocked candidate must not re-enter fallback pool"
    );

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, true);
    assert.strictEqual(audit.hardFilteredByCandidateBuilderCount, 1);
    assert.strictEqual(audit.hardFilteredBlockingRules.SERVICE_MATCH, 1);
  });
}

function testFallbackExcludesMaxConsecutiveDaysHardBlockedCandidates() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [
      {
        personId: "p1",
        person: staff.find((item) => item.id === "p1") || null,
        failedRules: [{ code: "MAX_CONSECUTIVE_DAYS", severity: "hard" }],
        hardRejected: true,
        blockingRules: ["MAX_CONSECUTIVE_DAYS"],
        reasonCodes: ["MAX_CONSECUTIVE_DAYS_EXCEEDED"],
        status: "rejected",
      },
    ],
    candidates: [],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 1 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", {
          totalHours: 0,
          consecutiveDays: 3,
          lastAssignedDate: "2026-03-13",
        }),
        createRuntimePerson("p2", {
          totalHours: 100,
          consecutiveDays: 0,
          lastAssignedDate: null,
        }),
      ],
      targetHours: 50,
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "fallback should still allow assignment when safe pool remains");
    assert.strictEqual(
      result.assignments[0].personId,
      "p2",
      "MAX_CONSECUTIVE_DAYS hard-blocked candidate must not re-enter fallback pool"
    );

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, true);
    assert.strictEqual(audit.hardFilteredByCandidateBuilderCount, 1);
    assert.strictEqual(audit.hardFilteredBlockingRules.MAX_CONSECUTIVE_DAYS, 1);
  });
}

function testFallbackExcludesMaxWeeklyShiftsHardBlockedCandidates() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [
      {
        personId: "p1",
        person: staff.find((item) => item.id === "p1") || null,
        failedRules: [{ code: "MAX_WEEKLY_SHIFTS", severity: "hard" }],
        hardRejected: true,
        blockingRules: ["MAX_WEEKLY_SHIFTS"],
        reasonCodes: ["MAX_WEEKLY_SHIFTS_EXCEEDED"],
        status: "rejected",
      },
    ],
    candidates: [],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 1 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", {
          totalHours: 0,
          weeklyCounts: { "2026-W11": 4 },
        }),
        createRuntimePerson("p2", {
          totalHours: 100,
          weeklyCounts: { "2026-W11": 1 },
        }),
      ],
      targetHours: 50,
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "fallback should still allow assignment when safe pool remains");
    assert.strictEqual(
      result.assignments[0].personId,
      "p2",
      "MAX_WEEKLY_SHIFTS hard-blocked candidate must not re-enter fallback pool"
    );

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, true);
    assert.strictEqual(audit.hardFilteredByCandidateBuilderCount, 1);
    assert.strictEqual(audit.hardFilteredBlockingRules.MAX_WEEKLY_SHIFTS, 1);
  });
}

function testMaxConsecutiveDaysBuilderOnlyParity() {
  const contextFactory = () =>
    createBaseContext({
      staff: [
        createRuntimePerson("p1", {
          totalHours: 0,
          consecutiveDays: 3,
          lastAssignedDate: "2026-03-13",
        }),
      ],
      rules: { MAX_CONSECUTIVE_DAYS: 3 },
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
    });

  let baseline;
  withSchedulerHarness({}, (runScheduler) => {
    baseline = runScheduler(contextFactory());
  });

  let builderOnly;
  withSchedulerHarness({ mockIsAvailable: () => true }, (runScheduler) => {
    builderOnly = runScheduler(contextFactory());
  });

  assert.strictEqual(builderOnly.assignments.length, baseline.assignments.length);
  assert.deepStrictEqual(builderOnly.issues, baseline.issues);

  const baselineAudit = getSingleAudit(baseline);
  const builderOnlyAudit = getSingleAudit(builderOnly);
  assert.strictEqual(builderOnlyAudit.selectedCandidateId, baselineAudit.selectedCandidateId);
  assert.strictEqual(builderOnlyAudit.fallbackUsed, baselineAudit.fallbackUsed);
  assert.strictEqual(builderOnlyAudit.hardFilteredByCandidateBuilderCount, baselineAudit.hardFilteredByCandidateBuilderCount);
  assert.deepStrictEqual(builderOnlyAudit.hardFilteredBlockingRules, baselineAudit.hardFilteredBlockingRules);
  assert.strictEqual(builderOnlyAudit.postConstraintCount, baselineAudit.postConstraintCount);
}

function testMaxWeeklyShiftsBuilderOnlyParity() {
  const contextFactory = () =>
    createBaseContext({
      staff: [
        createRuntimePerson("p1", {
          totalHours: 0,
          weeklyCounts: { "2026-W11": 4 },
        }),
      ],
      rules: { MAX_SHIFTS_PER_WEEK: 4 },
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
    });

  let baseline;
  withSchedulerHarness({}, (runScheduler) => {
    baseline = runScheduler(contextFactory());
  });

  let builderOnly;
  withSchedulerHarness({ mockIsAvailable: () => true }, (runScheduler) => {
    builderOnly = runScheduler(contextFactory());
  });

  assert.strictEqual(builderOnly.assignments.length, baseline.assignments.length);
  assert.deepStrictEqual(builderOnly.issues, baseline.issues);

  const baselineAudit = getSingleAudit(baseline);
  const builderOnlyAudit = getSingleAudit(builderOnly);
  assert.strictEqual(builderOnlyAudit.selectedCandidateId, baselineAudit.selectedCandidateId);
  assert.strictEqual(builderOnlyAudit.fallbackUsed, baselineAudit.fallbackUsed);
  assert.strictEqual(builderOnlyAudit.hardFilteredByCandidateBuilderCount, baselineAudit.hardFilteredByCandidateBuilderCount);
  assert.deepStrictEqual(builderOnlyAudit.hardFilteredBlockingRules, baselineAudit.hardFilteredBlockingRules);
  assert.strictEqual(builderOnlyAudit.postConstraintCount, baselineAudit.postConstraintCount);
}

function testMaxWeeklyShiftsAliasMatrixHardRejects() {
  const aliases = [
    "MAX_WEEKLY_SHIFTS",
    "MAX_SHIFTS_PER_WEEK",
    "WEEKLY_MAX_SHIFTS",
    "WEEKLY_MAX_DUTIES",
  ];

  for (const key of aliases) {
    const candidateBuilder = require(candidateBuilderPath);
    const result = candidateBuilder.evaluateCandidate({
      person: {
        id: "p1",
        name: "Nurse A",
        weeklyCounts: { "2026-W12": 3 },
      },
      context: {
        person: {
          id: "p1",
          name: "Nurse A",
          weeklyCounts: { "2026-W12": 3 },
        },
        personId: "p1",
        date: "2026-03-20",
        rules: { [key]: 3 },
        shift: { id: "D", code: "D" },
      },
      activeRuleCodes: ["MAX_WEEKLY_SHIFTS"],
    });

    assert.strictEqual(result.status, "rejected", `${key} should produce hard rejection`);
    assert.strictEqual(result.hardRejected, true, `${key} should mark candidate as hard rejected`);
    assert.deepStrictEqual(result.blockingRules, ["MAX_WEEKLY_SHIFTS"], `${key} should block on canonical weekly code`);
  }
}

function testRestAfterNightRejectsCanonicalNightCodes() {
  const candidateBuilder = require(candidateBuilderPath);

  for (const shiftCode of ["N", "NIGHT"]) {
    const result = candidateBuilder.evaluateCandidate({
      person: {
        id: "p1",
        name: "Nurse Night",
      },
      context: {
        person: {
          id: "p1",
          name: "Nurse Night",
        },
        personId: "p1",
        date: "2026-03-20",
        existingAssignments: [
          {
            personId: "p1",
            date: "2026-03-19",
            shiftCode,
          },
        ],
        shift: { id: "D", code: "D" },
        rules: {},
      },
      activeRuleCodes: ["REST_AFTER_NIGHT"],
    });

    assert.strictEqual(result.status, "rejected", `${shiftCode} should trigger REST_AFTER_NIGHT hard reject`);
    assert.strictEqual(result.hardRejected, true, `${shiftCode} should mark candidate as hard rejected`);
    assert.deepStrictEqual(result.blockingRules, ["REST_AFTER_NIGHT"], `${shiftCode} should block on REST_AFTER_NIGHT`);
  }
}

function testRestAfterNightIgnoresV2NightEquivalent() {
  const candidateBuilder = require(candidateBuilderPath);
  const result = candidateBuilder.evaluateCandidate({
    person: {
      id: "p1",
      name: "Nurse V2",
    },
    context: {
      person: {
        id: "p1",
        name: "Nurse V2",
      },
      personId: "p1",
      date: "2026-03-20",
      existingAssignments: [
        {
          personId: "p1",
          date: "2026-03-19",
          shiftCode: "V2",
        },
      ],
      shift: { id: "D", code: "D" },
      rules: {},
    },
    activeRuleCodes: ["REST_AFTER_NIGHT"],
  });

  assert.strictEqual(result.status, "eligible", "V2 should not be treated as canonical true-night in candidateBuilder");
  assert.strictEqual(result.hardRejected, false, "V2 should not hard reject via REST_AFTER_NIGHT");
  assert.deepStrictEqual(result.blockingRules, [], "V2 should not populate blockingRules for REST_AFTER_NIGHT");
}

function testValidatorCleansUpNightEquivalentV2Assignments() {
  const { validateAssignments } = require(path.join(
    __dirname,
    "..",
    "services",
    "scheduler",
    "validator.js"
  ));

  const result = validateAssignments({
    assignments: [
      {
        date: "2026-03-19",
        personId: "p1",
        shiftId: "V2",
        shiftCode: "V2",
      },
      {
        date: "2026-03-20",
        personId: "p1",
        shiftId: "D",
        shiftCode: "D",
      },
    ],
  });

  assert.strictEqual(result.assignments.length, 1, "validator should drop next-day assignment after V2");
  assert.strictEqual(result.assignments[0].shiftCode, "V2", "validator should keep the original V2 assignment");
  assert.deepStrictEqual(result.issues, [
    {
      date: "2026-03-20",
      shiftId: "D",
      reason: "REST_AFTER_NIGHT",
    },
  ]);
}

function testLegacyNightFallbackActualInventoryIsCanonical() {
  const {
    isNightEquivalentShiftCode,
    isNightShiftCode,
  } = require(path.join(__dirname, "..", "services", "scheduler", "utils", "nightShift.js"));

  const usesLegacyNightMarker = (code) => String(code || "").trim().toUpperCase().includes("N");

  const standardProfile = JSON.parse(fs.readFileSync(standardProfilePath, "utf8"));
  const inventory = new Set(
    (Array.isArray(standardProfile?.shifts) ? standardProfile.shifts : [])
      .map((shift) => String(shift?.id || "").trim().toUpperCase())
      .filter(Boolean)
  );

  // Repo also carries canonical NIGHT in backend-adjacent code paths.
  inventory.add("NIGHT");

  const fallbackOnly = Array.from(inventory).filter(
    (code) =>
      usesLegacyNightMarker(code) &&
      !isNightShiftCode(code) &&
      !isNightEquivalentShiftCode(code)
  );

  assert.deepStrictEqual(
    fallbackOnly,
    [],
    "current repo shift inventory should not rely on includes(\"N\") legacy fallback"
  );
}

function testStrictRoleEligibilityFiltersMismatchedCandidate() {
  withScheduler(null, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { role: "doctor", totalHours: 0 }),
        createRuntimePerson("p2", { role: "nurse", totalHours: 100 }),
      ],
      targetHours: 50,
      candidateBuilderOptions: {
        strictRoleEligibility: true,
      },
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
              requiredRole: "nurse",
              requiredCount: 1,
              hours: 8,
            },
          ],
        },
      ],
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "strict role mode should still assign eligible candidate");
    assert.strictEqual(result.assignments[0].personId, "p2", "role-mismatched candidate must be rejected");

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, false, "fallback should not be used when role-eligible candidate exists");
    assert.strictEqual(audit.rejectedCount, 1, "one role-mismatched candidate should be rejected");
  });
}

function testFallbackExcludesRoleEligibilityHardBlockedCandidates() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [
      {
        personId: "p1",
        person: staff.find((item) => item.id === "p1") || null,
        failedRules: [{ code: "ROLE_ELIGIBILITY", severity: "hard" }],
        hardRejected: true,
        blockingRules: ["ROLE_ELIGIBILITY"],
        reasonCodes: ["PERSON_ROLE_MISSING_FAIL_CLOSED"],
        status: "rejected",
      },
    ],
    candidates: [],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 1 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { role: "doctor", totalHours: 0 }),
        createRuntimePerson("p2", { role: "nurse", totalHours: 100 }),
      ],
      targetHours: 50,
      candidateBuilderOptions: {
        strictRoleEligibility: true,
      },
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "fallback should still assign from safe pool");
    assert.strictEqual(
      result.assignments[0].personId,
      "p2",
      "ROLE_ELIGIBILITY hard-blocked candidate must not re-enter fallback pool"
    );

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, true);
    assert.strictEqual(audit.hardFilteredByCandidateBuilderCount, 1);
    assert.strictEqual(audit.hardFilteredBlockingRules.ROLE_ELIGIBILITY, 1);
    assert.strictEqual(audit.roleEligibilityHardRejectCount, 1);
  });
}

function testStrictSectionEligibilityFiltersMismatchedCandidate() {
  withScheduler(null, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { areas: ["SARI"], totalHours: 0 }),
        createRuntimePerson("p2", { areas: ["TRIAJ", "KIRMIZI"], totalHours: 100 }),
      ],
      targetHours: 50,
      candidateBuilderOptions: {
        strictSectionEligibility: true,
      },
      days: [
        {
          date: "2026-03-14",
          weekday: 6,
          shifts: [
            {
              id: "D",
              code: "D",
              serviceId: "svc-1",
              section: "TRIAJ",
              requiredCount: 1,
              hours: 8,
            },
          ],
        },
      ],
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "strict section mode should still assign eligible candidate");
    assert.strictEqual(result.assignments[0].personId, "p2", "section-mismatched candidate must be rejected");

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, false, "fallback should not be used when section-eligible candidate exists");
    assert.strictEqual(audit.rejectedCount, 1, "one section-mismatched candidate should be rejected");
    assert.strictEqual(audit.sectionEligibilityCheckedCount, 2, "all candidates evaluated by section rule should be counted");
    assert.strictEqual(audit.sectionEligibilityHardRejectCount, 1, "one candidate should be hard-rejected by section rule");
    assert.strictEqual(audit.sectionEligibilityPassCount, 1, "one candidate should pass section rule");
  });
}

function testFallbackExcludesSectionEligibilityHardBlockedCandidates() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [
      {
        personId: "p1",
        person: staff.find((item) => item.id === "p1") || null,
        failedRules: [{ code: "SECTION_ELIGIBILITY", severity: "hard" }],
        hardRejected: true,
        blockingRules: ["SECTION_ELIGIBILITY"],
        reasonCodes: ["SECTION_NOT_ALLOWED"],
        status: "rejected",
      },
    ],
    candidates: [],
    evaluations: [
      {
        personId: "p1",
        hardRejected: true,
        blockingRules: ["SECTION_ELIGIBILITY"],
        ruleResults: [
          { code: "SECTION_ELIGIBILITY", passed: false, meta: { reason: "SECTION_NOT_ALLOWED" } },
        ],
      },
    ],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 1 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { areas: ["SARI"], totalHours: 0 }),
        createRuntimePerson("p2", { areas: ["TRIAJ"], totalHours: 100 }),
      ],
      targetHours: 50,
      candidateBuilderOptions: {
        strictSectionEligibility: true,
      },
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "fallback should still assign from safe pool");
    assert.strictEqual(
      result.assignments[0].personId,
      "p2",
      "SECTION_ELIGIBILITY hard-blocked candidate must not re-enter fallback pool"
    );

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.fallbackUsed, true);
    assert.strictEqual(audit.hardFilteredByCandidateBuilderCount, 1);
    assert.strictEqual(audit.hardFilteredBlockingRules.SECTION_ELIGIBILITY, 1);
    assert.strictEqual(audit.sectionEligibilityHardRejectCount, 1);
  });
}

function testFairnessPolicyInfluencesOrderingOnTie() {
  withScheduler(null, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", {
          active: true,
          serviceId: "svc-1",
          stats: { assignmentsThisMonth: 5 },
        }),
        createRuntimePerson("p2", {
          active: true,
          serviceId: "svc-1",
          stats: { assignmentsThisMonth: 1 },
        }),
      ],
      randomize: false,
      targetHours: 0,
      targetShifts: 0,
    });
    const result = runScheduler(context);

    assert.strictEqual(result.assignments.length, 1, "one candidate should be assigned");
    assert.strictEqual(
      result.assignments[0].personId,
      "p2",
      "candidate with fewer monthly assignments should win fairness tie-break"
    );

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.selectedCandidateId, "p2");
    assert.strictEqual(audit.selectionReason, "POLICY_TIE_BREAK");
    assert.ok(Number.isFinite(audit.selectedPolicyScore), "selectedPolicyScore must be numeric");
    assert.ok(Array.isArray(audit.selectedPolicyBreakdown), "selectedPolicyBreakdown must be an array");
    assert.ok(Array.isArray(audit.topCandidates), "topCandidates must be an array");
    assert.ok(audit.topCandidates.length >= 2, "topCandidates must include compared candidates");

    const fairnessEntry = audit.selectedPolicyBreakdown.find((item) => item?.policy === "FAIRNESS");
    assert.ok(fairnessEntry, "selected breakdown must include FAIRNESS");
    assert.strictEqual(fairnessEntry.reason, null);
    assert.strictEqual(fairnessEntry.meta.statsMissing, false);
  });
}

function testPolicyAuditFieldsVisible() {
  withScheduler(null, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", {
          active: true,
          serviceId: "svc-1",
          stats: { assignmentsThisMonth: 1 },
          totalHours: 100,
          totalShifts: 12,
          consecutiveDays: 3,
          lastShift: { date: "2026-03-12", code: "D", isNight: false },
        }),
        createRuntimePerson("p2", {
          active: true,
          serviceId: "svc-1",
          stats: { assignmentsThisMonth: 1 },
          totalHours: 40,
          totalShifts: 5,
          consecutiveDays: 0,
        }),
      ],
      weights: {
        hourBalance: 0,
        shiftBalance: 0,
        weekdayBalance: 0,
        pairPenalty: 0,
        requestBonus: 0,
      },
      targetHours: 80,
      targetShifts: 10,
      randomize: false,
    });
    const result = runScheduler(context);
    const audit = getSingleAudit(result);

    assert.strictEqual(audit.selectedCandidateId, "p2");
    assert.ok(Number.isFinite(audit.selectedSchedulerScore), "selectedSchedulerScore must be numeric");
    assert.ok(Number.isFinite(audit.selectedPolicyScore), "selectedPolicyScore must be numeric");
    assert.ok(Array.isArray(audit.selectedPolicyBreakdown), "selectedPolicyBreakdown must be visible");
    assert.ok(Array.isArray(audit.topCandidates), "topCandidates must be visible");
    assert.ok(audit.topCandidates.length >= 2, "topCandidates must include compact shortlist");
    assert.strictEqual(audit.selectionReason, "POLICY_TIE_BREAK");

    const fatigueEntry = audit.selectedPolicyBreakdown.find((item) => item?.policy === "FATIGUE");
    const workloadEntry = audit.selectedPolicyBreakdown.find((item) => item?.policy === "WORKLOAD_BALANCE");
    assert.ok(fatigueEntry, "selected breakdown must include FATIGUE");
    assert.ok(workloadEntry, "selected breakdown must include WORKLOAD_BALANCE");
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
    { name: "fallback excludes ACTIVE_REQUIRED hard-blocked candidates", fn: testFallbackExcludesActiveRequiredHardBlockedCandidates },
    { name: "fallback excludes SERVICE_MATCH hard-blocked candidates", fn: testFallbackExcludesServiceMatchHardBlockedCandidates },
    { name: "fallback excludes MAX_WEEKLY_SHIFTS hard-blocked candidates", fn: testFallbackExcludesMaxWeeklyShiftsHardBlockedCandidates },
    { name: "fallback excludes MAX_CONSECUTIVE_DAYS hard-blocked candidates", fn: testFallbackExcludesMaxConsecutiveDaysHardBlockedCandidates },
    { name: "MAX_CONSECUTIVE_DAYS builder-only parity", fn: testMaxConsecutiveDaysBuilderOnlyParity },
    { name: "MAX_WEEKLY_SHIFTS builder-only parity", fn: testMaxWeeklyShiftsBuilderOnlyParity },
    { name: "MAX_WEEKLY_SHIFTS alias matrix hard rejects", fn: testMaxWeeklyShiftsAliasMatrixHardRejects },
    { name: "REST_AFTER_NIGHT rejects canonical night codes", fn: testRestAfterNightRejectsCanonicalNightCodes },
    { name: "REST_AFTER_NIGHT ignores V2 night-equivalent codes", fn: testRestAfterNightIgnoresV2NightEquivalent },
    { name: "validator cleans up V2 night-equivalent assignments", fn: testValidatorCleansUpNightEquivalentV2Assignments },
    { name: "legacy night fallback actual inventory is canonical", fn: testLegacyNightFallbackActualInventoryIsCanonical },
    { name: "strict ROLE_ELIGIBILITY filters mismatched candidate", fn: testStrictRoleEligibilityFiltersMismatchedCandidate },
    { name: "fallback excludes ROLE_ELIGIBILITY hard-blocked candidates", fn: testFallbackExcludesRoleEligibilityHardBlockedCandidates },
    { name: "strict SECTION_ELIGIBILITY filters mismatched candidate", fn: testStrictSectionEligibilityFiltersMismatchedCandidate },
    { name: "fallback excludes SECTION_ELIGIBILITY hard-blocked candidates", fn: testFallbackExcludesSectionEligibilityHardBlockedCandidates },
    { name: "fairness policy influences ordering on tie", fn: testFairnessPolicyInfluencesOrderingOnTie },
    { name: "policy audit fields visible", fn: testPolicyAuditFieldsVisible },
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
