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
const policyLayerPath = path.join(
  __dirname,
  "..",
  "services",
  "scheduler",
  "policies",
  "evaluatePolicies.js"
);

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

function withScheduler(mockBuildCandidates, fn, mockEvaluatePolicies = null) {
  const candidateBuilder = require(candidateBuilderPath);
  const originalBuildCandidates = candidateBuilder.buildCandidates;
  const evaluatePolicies = require(policyLayerPath);
  const originalEvaluatePolicies = evaluatePolicies;
  if (typeof mockBuildCandidates === "function") {
    candidateBuilder.buildCandidates = mockBuildCandidates;
  }

  if (typeof mockEvaluatePolicies === "function") {
    delete require.cache[require.resolve(policyLayerPath)];
    require.cache[require.resolve(policyLayerPath)] = {
      id: require.resolve(policyLayerPath),
      filename: require.resolve(policyLayerPath),
      loaded: true,
      exports: mockEvaluatePolicies,
    };
  }

  delete require.cache[require.resolve(enginePath)];
  const { runScheduler } = require(enginePath);

  try {
    fn(runScheduler);
  } finally {
    candidateBuilder.buildCandidates = originalBuildCandidates;
    delete require.cache[require.resolve(policyLayerPath)];
    require.cache[require.resolve(policyLayerPath)] = {
      id: require.resolve(policyLayerPath),
      filename: require.resolve(policyLayerPath),
      loaded: true,
      exports: originalEvaluatePolicies,
    };
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
    assert.strictEqual(audit.selectionReason, "POLICY_BEST");
    assert.ok(Number.isFinite(audit.selectedPolicyScore), "selectedPolicyScore must be numeric");
    assert.ok(Array.isArray(audit.selectedPolicyBreakdown), "selectedPolicyBreakdown must be an array");
    assert.ok(Array.isArray(audit.topCandidates), "topCandidates must be an array");
    assert.ok(audit.topCandidates.length >= 2, "topCandidates must include compared candidates");

    const fairnessEntry = audit.selectedPolicyBreakdown.find((item) => item?.policy === "FAIRNESS");
    assert.ok(fairnessEntry, "selected breakdown must include FAIRNESS");
    assert.strictEqual(fairnessEntry.name, "FAIRNESS");
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
    assert.strictEqual(audit.selectionReason, "POLICY_BEST");

    const fatigueEntry = audit.selectedPolicyBreakdown.find((item) => item?.policy === "FATIGUE");
    const workloadEntry = audit.selectedPolicyBreakdown.find((item) => item?.policy === "WORKLOAD_BALANCE");
    assert.ok(fatigueEntry, "selected breakdown must include FATIGUE");
    assert.ok(workloadEntry, "selected breakdown must include WORKLOAD_BALANCE");
    assert.strictEqual(fatigueEntry.name, "FATIGUE");
    assert.strictEqual(workloadEntry.name, "WORKLOAD_BALANCE");
  });
}

function testSingleEligibleCandidateSkipsPolicyBreakdown() {
  withScheduler(null, (runScheduler) => {
    const context = createBaseContext({
      staff: [
        createRuntimePerson("p1", { active: true, serviceId: "svc-1" }),
      ],
      randomize: false,
    });

    const result = runScheduler(context);
    assert.strictEqual(result.assignments.length, 1, "single eligible candidate should be assigned");

    const audit = getSingleAudit(result);
    assert.strictEqual(audit.selectedCandidateId, "p1");
    assert.strictEqual(audit.selectionReason, "ONLY_ELIGIBLE_CANDIDATE");
    assert.strictEqual(audit.selectedPolicyScore, 0);
    assert.deepStrictEqual(audit.selectedPolicyBreakdown, []);
  });
}

function testHardRejectedCandidateNeverReachesPolicyLayer() {
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
        hardRejected: true,
        blockingRules: ["ACTIVE_REQUIRED"],
        status: "rejected",
      },
    ],
    candidates: [staff.find((item) => item.id === "p1") || null],
    evaluations: [],
  });

  const seen = [];
  const mockEvaluatePolicies = ({ person }) => {
    seen.push(person?.id || null);
    return { totalScore: 0, breakdown: [], policies: [] };
  };

  withScheduler(
    mockBuildCandidates,
    (runScheduler) => {
      const context = createBaseContext({
        staff: [
          createRuntimePerson("p1", { active: true, serviceId: "svc-1" }),
          createRuntimePerson("p2", { active: false, serviceId: "svc-1" }),
        ],
        randomize: false,
      });

      const result = runScheduler(context);
      assert.strictEqual(result.assignments.length, 1, "eligible candidate should still be assigned");
      assert.deepStrictEqual(seen, [], "single remaining candidate should be assigned without policy evaluation");
    },
    mockEvaluatePolicies
  );
}

function testNoCandidateBehaviorRemainsUnchanged() {
  withScheduler(null, (runScheduler) => {
    const context = createBaseContext({
      staff: [],
      randomize: false,
    });

    const result = runScheduler(context);
    assert.strictEqual(result.assignments.length, 0, "no staff means no assignments");
    assert.ok(Array.isArray(result.issues), "issues array must exist");
    assert.strictEqual(result.issues.length, 1, "no-candidate path should still emit one issue");
    assert.strictEqual(result.issues[0].reason, "NO_CANDIDATE");
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
    { name: "strict ROLE_ELIGIBILITY filters mismatched candidate", fn: testStrictRoleEligibilityFiltersMismatchedCandidate },
    { name: "fallback excludes ROLE_ELIGIBILITY hard-blocked candidates", fn: testFallbackExcludesRoleEligibilityHardBlockedCandidates },
    { name: "strict SECTION_ELIGIBILITY filters mismatched candidate", fn: testStrictSectionEligibilityFiltersMismatchedCandidate },
    { name: "fallback excludes SECTION_ELIGIBILITY hard-blocked candidates", fn: testFallbackExcludesSectionEligibilityHardBlockedCandidates },
    { name: "fairness policy influences ordering on tie", fn: testFairnessPolicyInfluencesOrderingOnTie },
    { name: "policy audit fields visible", fn: testPolicyAuditFieldsVisible },
    { name: "single eligible candidate skips policy breakdown", fn: testSingleEligibleCandidateSkipsPolicyBreakdown },
    { name: "hard-rejected candidate never reaches policy layer", fn: testHardRejectedCandidateNeverReachesPolicyLayer },
    { name: "no-candidate behavior remains unchanged", fn: testNoCandidateBehaviorRemainsUnchanged },
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
