import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const repoRoot = path.join(__dirname, "..");
const backendRoot = path.join(repoRoot, "my-backend-project");
const standardProfilePath = path.join(repoRoot, "config", "rules", "standard-profile.json");
const schedulerRoot = path.join(backendRoot, "services", "scheduler");
const candidateBuilderRoot = path.join(schedulerRoot, "candidateBuilder");
const inputBuilderPath = path.join(schedulerRoot, "inputBuilder.js");
const constraintsPath = path.join(schedulerRoot, "constraints.js");
const enginePath = path.join(schedulerRoot, "engine.js");

const { buildContext } = require(path.join(schedulerRoot, "index.js"));
const { runScheduler } = require(path.join(schedulerRoot, "engine.js"));
const { buildSchedulerInput } = require(inputBuilderPath);
const RuleEngine = require(path.join(backendRoot, "services", "ruleEngine.js"));
const { evaluateCandidate } = require(path.join(candidateBuilderRoot, "evaluateCandidate.js"));
const activeRequiredRule = require(path.join(candidateBuilderRoot, "rules", "activeRequired.rule.js"));
const serviceMatchRule = require(path.join(candidateBuilderRoot, "rules", "serviceMatch.rule.js"));
const fairnessPolicy = require(path.join(schedulerRoot, "policies", "fairness.policy.js"));
const { validateAssignments } = require(path.join(schedulerRoot, "validator.js"));
const {
  isNightCleanupCode,
  isNightEquivalentShiftCode,
  isNightShiftCode,
} = require(path.join(schedulerRoot, "utils", "nightShift.js"));

function buildUiStaffPayload(staff = []) {
  return (Array.isArray(staff) ? staff : []).map((s) => {
    const areas = Array.isArray(s.areas) ? s.areas : [];
    const shiftCodes = Array.isArray(s.shiftCodes) ? s.shiftCodes : [];
    const meta = { ...(s.meta || {}) };
    const active = s.active ?? s.isActive ?? meta.active ?? meta.isActive ?? null;
    const isActive = s.isActive ?? s.active ?? meta.isActive ?? meta.active ?? null;
    const status = s.status ?? meta.status ?? null;
    const stats = s.stats ?? meta.stats ?? null;
    const resolvedName = s.name || s.fullName || "";
    if (!meta.areas && areas.length) meta.areas = areas;
    if (!meta.shiftCodes && shiftCodes.length) meta.shiftCodes = shiftCodes;
    if (!meta.role && s.role) meta.role = s.role;
    if (!meta.serviceId && s.serviceId) meta.serviceId = s.serviceId;
    if (meta.active == null && active != null) meta.active = active;
    if (meta.isActive == null && isActive != null) meta.isActive = isActive;
    if (meta.status == null && status != null) meta.status = status;
    if (meta.stats == null && stats != null) meta.stats = stats;
    return {
      id: String(s.id || ""),
      name: resolvedName,
      fullName: resolvedName,
      role: s.role || "",
      active,
      isActive,
      status,
      serviceId: s.serviceId || "",
      stats,
      areas,
      shiftCodes,
      meta,
    };
  }).filter((s) => s.id && s.name);
}

function createMockPerson(id, overrides = {}) {
  return {
    id,
    name: `Person ${id}`,
    role: "nurse",
    active: true,
    serviceId: "X",
    areas: ["ER"],
    shiftCodes: ["D"],
    meta: {},
    ...overrides,
  };
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function logJson(label, value) {
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`);
}

function runShapeChecks() {
  const mockPeople = [
    createMockPerson("valid-person", {
      stats: { count: 5, assignmentsThisMonth: 5 },
    }),
    createMockPerson("missing-active", {
      active: undefined,
      stats: { count: 2, assignmentsThisMonth: 2 },
    }),
    createMockPerson("missing-stats", {
      stats: undefined,
    }),
    createMockPerson("stats-count-only", {
      stats: { count: 5 },
    }),
    createMockPerson("stats-empty", {
      stats: {},
    }),
    createMockPerson("stats-assignments-only", {
      stats: { assignmentsThisMonth: 5 },
    }),
  ];

  const payload = buildUiStaffPayload(mockPeople);
  logJson("uiPayloadSample", payload[0]);

  const context = buildContext({
    staff: payload,
    days: [],
    targetHours: 0,
    targetShifts: 0,
  });

  for (const person of context.staff) {
    const activeResult = activeRequiredRule({ person });
    const serviceResult = serviceMatchRule({ person, serviceId: "X" });
    const fairnessResult = fairnessPolicy({ person }, {});

    logJson(`runtimeShape:${person.id}`, {
      active: person.active,
      isActive: person.isActive,
      status: person.status,
      serviceId: person.serviceId,
      service: person.service,
      stats: person.stats,
    });
    logJson(`ACTIVE_REQUIRED:${person.id}`, {
      passed: activeResult?.passed,
      message: activeResult?.message,
      meta: activeResult?.meta,
    });
    logJson(`SERVICE_MATCH:${person.id}`, {
      passed: serviceResult?.passed,
      message: serviceResult?.message,
      meta: serviceResult?.meta,
    });
    logJson(`FAIRNESS:${person.id}`, fairnessResult);
  }
}

function runMultiDayProgressionCheck() {
  const context = {
    staff: [
      {
        id: "p1",
        name: "Alice",
        role: "nurse",
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
        stats: { assignmentsThisMonth: 0 },
      },
    ],
    days: [
      {
        date: "2026-03-14",
        weekday: 6,
        shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }],
      },
      {
        date: "2026-03-15",
        weekday: 0,
        shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }],
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
  };

  logJson("stateBefore", context.staff[0]);
  const result = runScheduler(context);
  logJson("stateAfter", result.staff[0]);
  logJson("assignmentsAfter", result.assignments);
}

function runRuleEngineCheck() {
  const passiveContext = {
    staff: [
      {
        id: "p1",
        name: "Doctor A",
        role: "doctor",
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
      },
    ],
    days: [
      {
        date: "2026-03-16",
        weekday: 1,
        shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }],
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
  };

  const activeContext = {
    ...passiveContext,
    staff: passiveContext.staff.map((person) => ({
      ...person,
      weekdayCount: { ...person.weekdayCount },
      pairHistory: {},
      assignedDays: [],
      weeklyCounts: {},
      taskCounts: {},
      lastShift: null,
    })),
    assignments: [],
    issues: [],
  };

  activeContext.ruleEngine = new RuleEngine({
    leaveRules: new Map(),
    taskRequirements: new Map([["D", { allowedRoles: ["nurse"] }]]),
  });

  const eligibility = activeContext.ruleEngine.checkPersonEligibility(
    activeContext.staff[0],
    "D",
    { isNightShift: false }
  );

  const passiveResult = runScheduler(passiveContext);
  const activeResult = runScheduler(activeContext);

  logJson("ruleEngineEligibility", {
    returnsPromise: Boolean(eligibility && typeof eligibility.then === "function"),
    eligible: eligibility?.eligible,
    reason: eligibility?.reason,
  });
  logJson("ruleEnginePassive", {
    assignments: passiveResult.assignments,
    issues: passiveResult.issues,
  });
  logJson("ruleEngineActive", {
    assignments: activeResult.assignments,
    issues: activeResult.issues,
  });
}

function runPayloadOnlySchedulerInputCheck() {
  const result = buildSchedulerInput({
    scheduleDoc: null,
    payload: {
      defs: [
        {
          id: "row-triage-day",
          label: "TRIAJ",
          shiftCode: "D",
          pattern: [1, 1, 1, 1, 1, 1, 1],
        },
      ],
      overrides: {
        "row-triage-day": {
          1: 2,
          2: 0,
        },
      },
      shiftOptions: [
        { id: "D", code: "D", hours: 8, start: "08:00", end: "16:00", isNight: false },
      ],
    },
    year: 2026,
    month: 3,
    hospitalId: null,
    holidays: [],
  });

  logJson("PAYLOAD_ONLY_SCHEDULER_INPUT", {
    effectiveDefs: result.effectiveDefs,
    effectiveOverrides: result.effectiveOverrides,
    dayCount: Array.isArray(result.days) ? result.days.length : 0,
    firstDay: result.days?.[0] || null,
    secondDay: result.days?.[1] || null,
  });
}

function runCandidateRuleChecks() {
  const maxWeekly = evaluateCandidate({
    person: {
      id: "p1",
      name: "Nurse A",
      weeklyCounts: { "2026-W12": 3 },
      consecutiveDays: 1,
      lastAssignedDate: "2026-03-18",
    },
    context: {
      person: {
        id: "p1",
        name: "Nurse A",
        weeklyCounts: { "2026-W12": 3 },
        consecutiveDays: 1,
        lastAssignedDate: "2026-03-18",
      },
      personId: "p1",
      date: "2026-03-20",
      rules: { MAX_SHIFTS_PER_WEEK: 3 },
      shift: { id: "D", code: "D" },
    },
    activeRuleCodes: ["MAX_WEEKLY_SHIFTS"],
  });

  const maxConsecutive = evaluateCandidate({
    person: {
      id: "p2",
      name: "Nurse B",
      consecutiveDays: 3,
      lastAssignedDate: "2026-03-19",
    },
    context: {
      person: {
        id: "p2",
        name: "Nurse B",
        consecutiveDays: 3,
        lastAssignedDate: "2026-03-19",
      },
      personId: "p2",
      date: "2026-03-20",
      rules: { MAX_CONSECUTIVE_DAYS: 3 },
      shift: { id: "D", code: "D" },
    },
    activeRuleCodes: ["MAX_CONSECUTIVE_DAYS"],
  });

  logJson("MAX_WEEKLY_SHIFTS", {
    status: maxWeekly.status,
    failedRules: maxWeekly.failedRules,
    ruleResults: maxWeekly.ruleResults,
  });
  logJson("MAX_CONSECUTIVE_DAYS", {
    status: maxConsecutive.status,
    failedRules: maxConsecutive.failedRules,
    ruleResults: maxConsecutive.ruleResults,
  });

  const weeklyAliasMatrix = {};
  for (const key of [
    "MAX_WEEKLY_SHIFTS",
    "MAX_SHIFTS_PER_WEEK",
    "WEEKLY_MAX_SHIFTS",
    "WEEKLY_MAX_DUTIES",
  ]) {
    const aliasResult = evaluateCandidate({
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

    weeklyAliasMatrix[key] = {
      status: aliasResult.status,
      hardRejected: aliasResult.hardRejected,
      blockingRules: aliasResult.blockingRules,
    };
  }

  logJson("MAX_WEEKLY_SHIFTS_ALIAS_MATRIX", weeklyAliasMatrix);
}

function runNightSemanticsChecks() {
  const usesLegacyNightMarker = (code) => String(code || "").trim().toUpperCase().includes("N");
  const standardProfile = JSON.parse(fs.readFileSync(standardProfilePath, "utf8"));
  const actualInventory = Array.from(
    new Set(
      [
        ...((Array.isArray(standardProfile?.shifts) ? standardProfile.shifts : [])
          .map((shift) => String(shift?.id || "").trim().toUpperCase())
          .filter(Boolean)),
        "NIGHT",
      ]
    )
  );

  const semanticsMatrix = {};
  for (const code of ["N", "NIGHT", "V2", "N-LEGACY", "D"]) {
    semanticsMatrix[code] = {
      trueNight: isNightShiftCode(code),
      nightEquivalent: isNightEquivalentShiftCode(code),
      cleanupCode: isNightCleanupCode(code),
      legacyNightMarker: usesLegacyNightMarker(code),
    };
  }

  const legacyFallbackMatrix = {};
  for (const code of ["N", "NIGHT", "V2", "V1", "SV", "GECE", "24", "N-LEGACY", "AN"]) {
    legacyFallbackMatrix[code] = {
      trueNight: isNightShiftCode(code),
      nightEquivalent: isNightEquivalentShiftCode(code),
      cleanupCode: isNightCleanupCode(code),
      legacyNightMarker: usesLegacyNightMarker(code),
      fallbackOnly: usesLegacyNightMarker(code) && !isNightShiftCode(code) && !isNightEquivalentShiftCode(code),
    };
  }

  const restAfterNightTrueNight = evaluateCandidate({
    person: { id: "p-night", name: "Night Nurse" },
    context: {
      person: { id: "p-night", name: "Night Nurse" },
      personId: "p-night",
      date: "2026-03-20",
      existingAssignments: [{ personId: "p-night", date: "2026-03-19", shiftCode: "NIGHT" }],
      shift: { id: "D", code: "D" },
      rules: {},
    },
    activeRuleCodes: ["REST_AFTER_NIGHT"],
  });

  const restAfterNightV2 = evaluateCandidate({
    person: { id: "p-v2", name: "V2 Nurse" },
    context: {
      person: { id: "p-v2", name: "V2 Nurse" },
      personId: "p-v2",
      date: "2026-03-20",
      existingAssignments: [{ personId: "p-v2", date: "2026-03-19", shiftCode: "V2" }],
      shift: { id: "D", code: "D" },
      rules: {},
    },
    activeRuleCodes: ["REST_AFTER_NIGHT"],
  });

  const validatorNightCleanup = validateAssignments({
    assignments: [
      { date: "2026-03-19", personId: "p-v2", shiftId: "V2", shiftCode: "V2" },
      { date: "2026-03-20", personId: "p-v2", shiftId: "D", shiftCode: "D" },
    ],
  });

  logJson("NIGHT_SHIFT_INVENTORY", {
    standardProfileShiftCodes: actualInventory,
    fallbackOnlyActualCodes: actualInventory.filter(
      (code) => usesLegacyNightMarker(code) && !isNightShiftCode(code) && !isNightEquivalentShiftCode(code)
    ),
  });
  logJson("NIGHT_SEMANTICS_MATRIX", semanticsMatrix);
  logJson("LEGACY_NIGHT_FALLBACK_MATRIX", legacyFallbackMatrix);
  logJson("REST_AFTER_NIGHT_TRUE_NIGHT", {
    status: restAfterNightTrueNight.status,
    hardRejected: restAfterNightTrueNight.hardRejected,
    blockingRules: restAfterNightTrueNight.blockingRules,
    failedRules: restAfterNightTrueNight.failedRules,
  });
  logJson("REST_AFTER_NIGHT_V2_EQUIVALENT", {
    status: restAfterNightV2.status,
    hardRejected: restAfterNightV2.hardRejected,
    blockingRules: restAfterNightV2.blockingRules,
    failedRules: restAfterNightV2.failedRules,
  });
  logJson("VALIDATOR_NIGHT_CLEANUP_V2", validatorNightCleanup);
}

function runCapacityGuardParityChecks() {
  const constraints = require(constraintsPath);
  const originalIsAvailable = constraints.isAvailable;

  const runWithOverride = (override) => {
    constraints.isAvailable = override;
    delete require.cache[require.resolve(enginePath)];
    const { runScheduler: overriddenRunScheduler } = require(enginePath);
    return overriddenRunScheduler;
  };

  try {
    const baseConsecutiveContext = {
      staff: [
        {
          id: "p1",
          name: "Nurse B",
          active: true,
          serviceId: "svc-1",
          totalHours: 0,
          totalShifts: 0,
          weekdayCount: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
          pairHistory: {},
          assignedDays: ["2026-03-17", "2026-03-18", "2026-03-19"],
          weeklyCounts: {},
          taskCounts: {},
          consecutiveDays: 3,
          lastAssignedDate: "2026-03-19",
          lastShift: null,
        },
      ],
      days: [
        {
          date: "2026-03-20",
          weekday: 5,
          shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }],
        },
      ],
      leavesByPerson: {},
      requestsByPerson: {},
      rules: { MAX_CONSECUTIVE_DAYS: 3 },
      weights: {},
      issues: [],
      assignments: [],
      targetHours: 0,
      targetShifts: 0,
      randomize: false,
    };

    const baseWeeklyContext = {
      staff: [
        {
          id: "p1",
          name: "Nurse A",
          active: true,
          serviceId: "svc-1",
          totalHours: 0,
          totalShifts: 0,
          weekdayCount: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
          pairHistory: {},
          assignedDays: [],
          weeklyCounts: { "2026-W12": 3 },
          taskCounts: {},
          consecutiveDays: 0,
          lastAssignedDate: null,
          lastShift: null,
        },
      ],
      days: [
        {
          date: "2026-03-20",
          weekday: 5,
          shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }],
        },
      ],
      leavesByPerson: {},
      requestsByPerson: {},
      rules: { MAX_SHIFTS_PER_WEEK: 3 },
      weights: {},
      issues: [],
      assignments: [],
      targetHours: 0,
      targetShifts: 0,
      randomize: false,
    };

    const consecutiveBaseline = runScheduler(structuredClone(baseConsecutiveContext));
    const consecutiveBuilderOnly = runWithOverride(() => true)(structuredClone(baseConsecutiveContext));

    logJson("MAX_CONSECUTIVE_DAYS_PARITY", {
      baseline: {
        assignments: consecutiveBaseline.assignments,
        issues: consecutiveBaseline.issues,
        audit: consecutiveBaseline.candidateAudit?.[0] || null,
      },
      builderOnly: {
        assignments: consecutiveBuilderOnly.assignments,
        issues: consecutiveBuilderOnly.issues,
        audit: consecutiveBuilderOnly.candidateAudit?.[0] || null,
      },
    });

    constraints.isAvailable = originalIsAvailable;
    delete require.cache[require.resolve(enginePath)];
    const { runScheduler: restoredRunScheduler } = require(enginePath);

    const weeklyBaseline = restoredRunScheduler(structuredClone(baseWeeklyContext));
    const weeklyBuilderOnly = runWithOverride(() => true)(structuredClone(baseWeeklyContext));

    logJson("MAX_WEEKLY_SHIFTS_PARITY", {
      baseline: {
        assignments: weeklyBaseline.assignments,
        issues: weeklyBaseline.issues,
        audit: weeklyBaseline.candidateAudit?.[0] || null,
      },
      builderOnly: {
        assignments: weeklyBuilderOnly.assignments,
        issues: weeklyBuilderOnly.issues,
        audit: weeklyBuilderOnly.candidateAudit?.[0] || null,
      },
    });
  } finally {
    constraints.isAvailable = originalIsAvailable;
    delete require.cache[require.resolve(enginePath)];
  }
}

async function runAuditPersistenceCheck() {
  const personModelPath = path.join(backendRoot, "models", "Person.js");
  const generatedSchedulePath = path.join(backendRoot, "models", "GeneratedSchedule.js");
  const monthlySchedulePath = path.join(backendRoot, "models", "MonthlySchedule.js");
  const holidayServicePath = path.join(backendRoot, "services", "holidayService.js");
  const schedulerIndexPath = path.join(backendRoot, "services", "scheduler", "index.js");
  const draftRosterPath = path.join(backendRoot, "services", "scheduler", "draftRoster.js");
  const ruleResolverPath = path.join(backendRoot, "services", "scheduler", "ruleResolver.js");
  const staffResolverPath = path.join(backendRoot, "services", "scheduler", "staffResolver.js");
  const validatorPath = path.join(backendRoot, "services", "scheduler", "validator.js");
  const holidayPolicyAdapterPath = path.join(backendRoot, "services", "scheduler", "holidayPolicyAdapter.js");
  const inputBuilderPath = path.join(backendRoot, "services", "scheduler", "inputBuilder.js");
  const schedulerServicePath = path.join(backendRoot, "services", "schedulerService.js");

  const originalCache = new Map();
  const touchedModules = [
    personModelPath,
    generatedSchedulePath,
    monthlySchedulePath,
    holidayServicePath,
    schedulerIndexPath,
    draftRosterPath,
    ruleResolverPath,
    staffResolverPath,
    validatorPath,
    holidayPolicyAdapterPath,
    inputBuilderPath,
    schedulerServicePath,
  ];

  for (const modulePath of touchedModules) {
    try {
      const resolved = require.resolve(modulePath);
      originalCache.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    } catch {
      // ignore missing cache entry
    }
  }

  let createdPayload = null;
  const putMock = (modulePath, exportsValue) => {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: exportsValue,
    };
  };

  try {
    putMock(personModelPath, {
      find: () => ({
        select: () => ({
          lean: async () => [],
        }),
      }),
    });
    putMock(generatedSchedulePath, {
      create: async (payload) => {
        createdPayload = payload;
        return { _id: "generated-1" };
      },
    });
    putMock(monthlySchedulePath, {
      findOne: () => ({
        select: () => ({
          lean: async () => null,
        }),
      }),
      findByIdAndUpdate: async () => null,
    });
    putMock(holidayServicePath, {
      listHolidays: async () => [],
    });
    putMock(schedulerIndexPath, {
      generateMonthlyPlan: async () => ({
        assignments: [{ date: "2026-03-15", shiftId: "D", personId: "p1", personName: "Alice", hours: 8 }],
        issues: [],
        candidateAudit: [
          {
            date: "2026-03-15",
            shiftId: "D",
            selectedCandidateId: "p1",
            selectedPolicyScore: -1,
            selectedPolicyBreakdown: [
              { policy: "FAIRNESS", score: -1, reason: null, meta: { assignmentsThisMonth: 1 } },
            ],
            selectionReason: "POLICY_TIE_BREAK",
            topCandidates: [
              { personId: "p1", schedulerScore: 0, policyScore: -1, selected: true },
            ],
          },
        ],
        shadowAudit: { summary: { observations: 1 } },
      }),
    });
    putMock(draftRosterPath, {
      generateDraftRoster: () => ({ assignments: [], issues: [] }),
    });
    putMock(ruleResolverPath, {
      fetchDutyRules: async () => ({ doc: null, rules: {}, weights: {} }),
      DEFAULT_RULES: {},
      DEFAULT_WEIGHTS: {},
    });
    putMock(staffResolverPath, {
      resolveStaff: async () => ({ staff: [], debug: { rawCount: 0, filteredCount: 0, usedFallback: false, roleTokens: [] } }),
    });
    putMock(validatorPath, {
      validateAssignments: ({ assignments }) => ({ assignments, issues: [], debug: { hardFiltered: 0 } }),
    });
    putMock(holidayPolicyAdapterPath, {
      applyHolidayPolicies: ({ days }) => days,
    });
    putMock(inputBuilderPath, {
      buildSchedulerInput: ({ payload }) => ({
        effectiveDefs: payload.defs || [],
        effectiveOverrides: {},
        effectiveShiftOptions: [],
        days: payload.days || [
          { date: "2026-03-15", weekday: 0, shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }] },
        ],
        holidayKindByDate: {},
        shiftMetaByCode: {},
      }),
    });

    const { generateSchedule } = require(schedulerServicePath);
    const result = await generateSchedule({
      sectionId: "sec-1",
      serviceId: "svc-1",
      role: "nurse",
      year: 2026,
      month: 3,
      dryRun: false,
      userId: "user-1",
      hospitalId: null,
      payload: {
        staff: [{ id: "p1", name: "Alice", active: true, serviceId: "svc-1", stats: { assignmentsThisMonth: 1 } }],
        days: [
          { date: "2026-03-15", weekday: 0, shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }] },
        ],
      },
    });

    logJson("persistedScheduleReturn", result);
    logJson("persistedScheduleData", createdPayload?.data || null);
  } finally {
    for (const modulePath of touchedModules) {
      const resolved = require.resolve(modulePath);
      delete require.cache[resolved];
      if (originalCache.has(resolved) && originalCache.get(resolved)) {
        require.cache[resolved] = originalCache.get(resolved);
      }
    }
  }
}

async function runMonthlyWriteBackDiagnosticCheck() {
  const personModelPath = path.join(backendRoot, "models", "Person.js");
  const generatedSchedulePath = path.join(backendRoot, "models", "GeneratedSchedule.js");
  const monthlySchedulePath = path.join(backendRoot, "models", "MonthlySchedule.js");
  const holidayServicePath = path.join(backendRoot, "services", "holidayService.js");
  const schedulerIndexPath = path.join(backendRoot, "services", "scheduler", "index.js");
  const draftRosterPath = path.join(backendRoot, "services", "scheduler", "draftRoster.js");
  const ruleResolverPath = path.join(backendRoot, "services", "scheduler", "ruleResolver.js");
  const staffResolverPath = path.join(backendRoot, "services", "scheduler", "staffResolver.js");
  const validatorPath = path.join(backendRoot, "services", "scheduler", "validator.js");
  const holidayPolicyAdapterPath = path.join(backendRoot, "services", "scheduler", "holidayPolicyAdapter.js");
  const inputBuilderPath = path.join(backendRoot, "services", "scheduler", "inputBuilder.js");
  const schedulerServicePath = path.join(backendRoot, "services", "schedulerService.js");

  const originalCache = new Map();
  const touchedModules = [
    personModelPath,
    generatedSchedulePath,
    monthlySchedulePath,
    holidayServicePath,
    schedulerIndexPath,
    draftRosterPath,
    ruleResolverPath,
    staffResolverPath,
    validatorPath,
    holidayPolicyAdapterPath,
    inputBuilderPath,
    schedulerServicePath,
  ];

  for (const modulePath of touchedModules) {
    try {
      const resolved = require.resolve(modulePath);
      originalCache.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    } catch {
      // ignore missing cache entry
    }
  }

  let createdPayload = null;
  let generatedUpdate = null;
  const putMock = (modulePath, exportsValue) => {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: exportsValue,
    };
  };

  try {
    putMock(personModelPath, {
      find: () => ({
        select: () => ({
          lean: async () => [],
        }),
      }),
    });
    putMock(generatedSchedulePath, {
      create: async (payload) => {
        createdPayload = payload;
        return { _id: "generated-writeback-failure" };
      },
      findByIdAndUpdate: async (_id, update) => {
        generatedUpdate = update;
        return null;
      },
    });
    putMock(monthlySchedulePath, {
      findOne: () => ({
        select: () => ({
          lean: async () => ({ _id: "monthly-1", data: {} }),
        }),
      }),
      findByIdAndUpdate: async () => {
        throw new Error("monthly write-back unavailable");
      },
    });
    putMock(holidayServicePath, {
      listHolidays: async () => [],
    });
    putMock(schedulerIndexPath, {
      generateMonthlyPlan: async () => ({
        assignments: [{ date: "2026-03-15", shiftId: "D", personId: "p1", personName: "Alice", hours: 8 }],
        issues: [],
        candidateAudit: [],
        shadowAudit: null,
      }),
    });
    putMock(draftRosterPath, {
      generateDraftRoster: () => ({ assignments: [], issues: [] }),
    });
    putMock(ruleResolverPath, {
      fetchDutyRules: async () => ({ doc: null, rules: {}, weights: {} }),
      DEFAULT_RULES: {},
      DEFAULT_WEIGHTS: {},
    });
    putMock(staffResolverPath, {
      resolveStaff: async () => ({ staff: [], debug: { rawCount: 0, filteredCount: 0, usedFallback: false, roleTokens: [] } }),
    });
    putMock(validatorPath, {
      validateAssignments: ({ assignments }) => ({ assignments, issues: [], debug: { hardFiltered: 0 } }),
    });
    putMock(holidayPolicyAdapterPath, {
      applyHolidayPolicies: ({ days }) => days,
    });
    putMock(inputBuilderPath, {
      buildSchedulerInput: ({ payload }) => ({
        effectiveDefs: payload.defs || [],
        effectiveOverrides: {},
        effectiveShiftOptions: [],
        days: payload.days || [
          { date: "2026-03-15", weekday: 0, shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }] },
        ],
        holidayKindByDate: {},
        shiftMetaByCode: {},
      }),
    });

    const { generateSchedule } = require(schedulerServicePath);
    const result = await generateSchedule({
      sectionId: "sec-1",
      serviceId: "svc-1",
      role: "nurse",
      year: 2026,
      month: 3,
      dryRun: false,
      userId: "user-1",
      hospitalId: null,
      payload: {
        staff: [{ id: "p1", name: "Alice", active: true, serviceId: "svc-1", stats: { assignmentsThisMonth: 1 } }],
        days: [
          { date: "2026-03-15", weekday: 0, shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }] },
        ],
      },
    });

    logJson("monthlyWriteBackFailureResult", result?.data?.debug?.monthlyWriteBack || null);
    logJson("monthlyWriteBackFailurePersistedData", createdPayload?.data?.debug?.monthlyWriteBack || null);
    logJson("monthlyWriteBackFailureGeneratedUpdate", generatedUpdate || null);
  } finally {
    for (const modulePath of touchedModules) {
      const resolved = require.resolve(modulePath);
      delete require.cache[resolved];
      if (originalCache.has(resolved) && originalCache.get(resolved)) {
        require.cache[resolved] = originalCache.get(resolved);
      }
    }
  }
}

async function runGeneratedOversizeRetryCheck() {
  const personModelPath = path.join(backendRoot, "models", "Person.js");
  const generatedSchedulePath = path.join(backendRoot, "models", "GeneratedSchedule.js");
  const monthlySchedulePath = path.join(backendRoot, "models", "MonthlySchedule.js");
  const holidayServicePath = path.join(backendRoot, "services", "holidayService.js");
  const schedulerIndexPath = path.join(backendRoot, "services", "scheduler", "index.js");
  const draftRosterPath = path.join(backendRoot, "services", "scheduler", "draftRoster.js");
  const ruleResolverPath = path.join(backendRoot, "services", "scheduler", "ruleResolver.js");
  const staffResolverPath = path.join(backendRoot, "services", "scheduler", "staffResolver.js");
  const validatorPath = path.join(backendRoot, "services", "scheduler", "validator.js");
  const holidayPolicyAdapterPath = path.join(backendRoot, "services", "scheduler", "holidayPolicyAdapter.js");
  const inputBuilderPath = path.join(backendRoot, "services", "scheduler", "inputBuilder.js");
  const schedulerServicePath = path.join(backendRoot, "services", "schedulerService.js");

  const originalCache = new Map();
  const touchedModules = [
    personModelPath,
    generatedSchedulePath,
    monthlySchedulePath,
    holidayServicePath,
    schedulerIndexPath,
    draftRosterPath,
    ruleResolverPath,
    staffResolverPath,
    validatorPath,
    holidayPolicyAdapterPath,
    inputBuilderPath,
    schedulerServicePath,
  ];

  for (const modulePath of touchedModules) {
    try {
      const resolved = require.resolve(modulePath);
      originalCache.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    } catch {
      // ignore missing cache entry
    }
  }

  let createCallCount = 0;
  let firstCreatePayload = null;
  let secondCreatePayload = null;
  const putMock = (modulePath, exportsValue) => {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: exportsValue,
    };
  };

  try {
    putMock(personModelPath, {
      find: () => ({
        select: () => ({
          lean: async () => [],
        }),
      }),
    });
    putMock(generatedSchedulePath, {
      create: async (payload) => {
        createCallCount += 1;
        if (createCallCount === 1) {
          firstCreatePayload = payload;
          throw new RangeError('The value of "offset" is out of range. It must be >= 0 && <= 17825792. Received 17825795');
        }
        secondCreatePayload = payload;
        return { _id: "generated-oversize-retry" };
      },
      findByIdAndUpdate: async () => null,
    });
    putMock(monthlySchedulePath, {
      findOne: () => ({
        select: () => ({
          lean: async () => null,
        }),
      }),
      findByIdAndUpdate: async () => null,
    });
    putMock(holidayServicePath, {
      listHolidays: async () => [],
    });
    putMock(schedulerIndexPath, {
      generateMonthlyPlan: async () => ({
        assignments: [{ date: "2026-03-15", shiftId: "D", personId: "p1", personName: "Alice", hours: 8 }],
        issues: [],
        candidateAudit: [
          {
            date: "2026-03-15",
            shiftId: "D",
            selectedCandidateId: "p1",
            selectionReason: "ONLY_ELIGIBLE_CANDIDATE",
            selectedPolicyBreakdown: [{ policy: "FAIRNESS", score: -1 }],
          },
        ],
        shadowAudit: { observations: [{ type: "shadow" }] },
      }),
    });
    putMock(draftRosterPath, {
      generateDraftRoster: () => ({ assignments: [], issues: [] }),
    });
    putMock(ruleResolverPath, {
      fetchDutyRules: async () => ({ doc: null, rules: {}, weights: {} }),
      DEFAULT_RULES: {},
      DEFAULT_WEIGHTS: {},
    });
    putMock(staffResolverPath, {
      resolveStaff: async () => ({ staff: [], debug: { rawCount: 0, filteredCount: 0, usedFallback: false, roleTokens: [] } }),
    });
    putMock(validatorPath, {
      validateAssignments: ({ assignments }) => ({ assignments, issues: [], debug: { hardFiltered: 0 } }),
    });
    putMock(holidayPolicyAdapterPath, {
      applyHolidayPolicies: ({ days }) => days,
    });
    putMock(inputBuilderPath, {
      buildSchedulerInput: ({ payload }) => ({
        effectiveDefs: payload.defs || [],
        effectiveOverrides: {},
        effectiveShiftOptions: [],
        days: payload.days || [
          { date: "2026-03-15", weekday: 0, shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }] },
        ],
        holidayKindByDate: {},
        shiftMetaByCode: {},
      }),
    });

    const { generateSchedule } = require(schedulerServicePath);
    const result = await generateSchedule({
      sectionId: "sec-1",
      serviceId: "svc-1",
      role: "nurse",
      year: 2026,
      month: 3,
      dryRun: false,
      userId: "user-1",
      hospitalId: null,
      payload: {
        staff: [{ id: "p1", name: "Alice", active: true, serviceId: "svc-1", stats: { assignmentsThisMonth: 1 } }],
        days: [
          { date: "2026-03-15", weekday: 0, shifts: [{ id: "D", code: "D", serviceId: "svc-1", requiredCount: 1, hours: 8 }] },
        ],
      },
    });

    logJson("generatedOversizeRetryResult", {
      generatedId: result?.generatedId || null,
      generatedWrite: result?.data?.debug?.generatedWrite || null,
      explainabilityTruncated: result?.data?.debug?.explainabilityTruncated || false,
      candidateAuditLength: Array.isArray(result?.data?.candidateAudit) ? result.data.candidateAudit.length : null,
      shadowAudit: result?.data?.shadowAudit || null,
    });
    logJson("generatedOversizeRetryCreateCalls", {
      createCallCount,
      firstCandidateAuditLength: Array.isArray(firstCreatePayload?.data?.candidateAudit) ? firstCreatePayload.data.candidateAudit.length : null,
      secondCandidateAuditLength: Array.isArray(secondCreatePayload?.data?.candidateAudit) ? secondCreatePayload.data.candidateAudit.length : null,
      secondShadowAudit: secondCreatePayload?.data?.shadowAudit || null,
      secondGeneratedWrite: secondCreatePayload?.data?.debug?.generatedWrite || null,
    });
  } finally {
    for (const modulePath of touchedModules) {
      const resolved = require.resolve(modulePath);
      delete require.cache[resolved];
      if (originalCache.has(resolved) && originalCache.get(resolved)) {
        require.cache[resolved] = originalCache.get(resolved);
      }
    }
  }
}

async function runMonthlyScheduleProjectionCheck() {
  const personModelPath = path.join(backendRoot, "models", "Person.js");
  const generatedSchedulePath = path.join(backendRoot, "models", "GeneratedSchedule.js");
  const monthlySchedulePath = path.join(backendRoot, "models", "MonthlySchedule.js");
  const holidayServicePath = path.join(backendRoot, "services", "holidayService.js");
  const schedulerIndexPath = path.join(backendRoot, "services", "scheduler", "index.js");
  const draftRosterPath = path.join(backendRoot, "services", "scheduler", "draftRoster.js");
  const ruleResolverPath = path.join(backendRoot, "services", "scheduler", "ruleResolver.js");
  const staffResolverPath = path.join(backendRoot, "services", "scheduler", "staffResolver.js");
  const validatorPath = path.join(backendRoot, "services", "scheduler", "validator.js");
  const holidayPolicyAdapterPath = path.join(backendRoot, "services", "scheduler", "holidayPolicyAdapter.js");
  const inputBuilderPath = path.join(backendRoot, "services", "scheduler", "inputBuilder.js");
  const schedulerServicePath = path.join(backendRoot, "services", "schedulerService.js");

  const originalCache = new Map();
  const touchedModules = [
    personModelPath,
    generatedSchedulePath,
    monthlySchedulePath,
    holidayServicePath,
    schedulerIndexPath,
    draftRosterPath,
    ruleResolverPath,
    staffResolverPath,
    validatorPath,
    holidayPolicyAdapterPath,
    inputBuilderPath,
    schedulerServicePath,
  ];

  for (const modulePath of touchedModules) {
    try {
      const resolved = require.resolve(modulePath);
      originalCache.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    } catch {
      // ignore missing cache entry
    }
  }

  let receivedProjection = null;
  const putMock = (modulePath, exportsValue) => {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: exportsValue,
    };
  };

  try {
    putMock(personModelPath, {
      find: () => ({
        select: () => ({
          lean: async () => [],
        }),
      }),
    });
    putMock(generatedSchedulePath, {
      create: async () => ({ _id: "generated-projection-check" }),
      findByIdAndUpdate: async () => null,
    });
    putMock(monthlySchedulePath, {
      findOne: () => ({
        select: (projection) => {
          receivedProjection = projection;
          return {
            lean: async () => ({ _id: "monthly-1", data: { defs: [] } }),
          };
        },
      }),
      findByIdAndUpdate: async () => null,
    });
    putMock(holidayServicePath, {
      listHolidays: async () => [],
    });
    putMock(schedulerIndexPath, {
      generateMonthlyPlan: async () => ({
        assignments: [],
        issues: [],
        candidateAudit: [],
        shadowAudit: null,
      }),
    });
    putMock(draftRosterPath, {
      generateDraftRoster: () => ({ assignments: [], issues: [] }),
    });
    putMock(ruleResolverPath, {
      fetchDutyRules: async () => ({ doc: null, rules: {}, weights: {} }),
      DEFAULT_RULES: {},
      DEFAULT_WEIGHTS: {},
    });
    putMock(staffResolverPath, {
      resolveStaff: async () => ({ staff: [], debug: { rawCount: 0, filteredCount: 0, usedFallback: false, roleTokens: [] } }),
    });
    putMock(validatorPath, {
      validateAssignments: ({ assignments }) => ({ assignments, issues: [], debug: { hardFiltered: 0 } }),
    });
    putMock(holidayPolicyAdapterPath, {
      applyHolidayPolicies: ({ days }) => days,
    });
    putMock(inputBuilderPath, {
      buildSchedulerInput: () => ({
        effectiveDefs: [],
        effectiveOverrides: {},
        effectiveShiftOptions: [],
        days: [{ date: "2026-03-15", weekday: 0, shifts: [] }],
        holidayKindByDate: {},
        shiftMetaByCode: {},
      }),
    });

    const { generateSchedule } = require(schedulerServicePath);
    await generateSchedule({
      sectionId: "sec-1",
      serviceId: "svc-1",
      role: "nurse",
      year: 2026,
      month: 3,
      dryRun: false,
      userId: "user-1",
      hospitalId: null,
      payload: {},
    });

    logJson("MONTHLY_SCHEDULER_INPUT_PROJECTION", receivedProjection);
  } finally {
    for (const modulePath of touchedModules) {
      const resolved = require.resolve(modulePath);
      delete require.cache[resolved];
      if (originalCache.has(resolved) && originalCache.get(resolved)) {
        require.cache[resolved] = originalCache.get(resolved);
      }
    }
  }
}

async function runIssueDiagnosticsCheck() {
  const personModelPath = path.join(backendRoot, "models", "Person.js");
  const generatedSchedulePath = path.join(backendRoot, "models", "GeneratedSchedule.js");
  const monthlySchedulePath = path.join(backendRoot, "models", "MonthlySchedule.js");
  const holidayServicePath = path.join(backendRoot, "services", "holidayService.js");
  const schedulerIndexPath = path.join(backendRoot, "services", "scheduler", "index.js");
  const draftRosterPath = path.join(backendRoot, "services", "scheduler", "draftRoster.js");
  const ruleResolverPath = path.join(backendRoot, "services", "scheduler", "ruleResolver.js");
  const staffResolverPath = path.join(backendRoot, "services", "scheduler", "staffResolver.js");
  const validatorPath = path.join(backendRoot, "services", "scheduler", "validator.js");
  const holidayPolicyAdapterPath = path.join(backendRoot, "services", "scheduler", "holidayPolicyAdapter.js");
  const inputBuilderPath = path.join(backendRoot, "services", "scheduler", "inputBuilder.js");
  const schedulerServicePath = path.join(backendRoot, "services", "schedulerService.js");

  const originalCache = new Map();
  const touchedModules = [
    personModelPath,
    generatedSchedulePath,
    monthlySchedulePath,
    holidayServicePath,
    schedulerIndexPath,
    draftRosterPath,
    ruleResolverPath,
    staffResolverPath,
    validatorPath,
    holidayPolicyAdapterPath,
    inputBuilderPath,
    schedulerServicePath,
  ];

  for (const modulePath of touchedModules) {
    try {
      const resolved = require.resolve(modulePath);
      originalCache.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    } catch {}
  }

  const putMock = (modulePath, exportsValue) => {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: exportsValue,
    };
  };

  try {
    putMock(personModelPath, {
      find: () => ({
        select: () => ({
          lean: async () => [],
        }),
      }),
    });
    putMock(generatedSchedulePath, {
      create: async (payload) => ({ _id: "generated-issue-diagnostics", data: payload.data }),
      findByIdAndUpdate: async () => null,
    });
    putMock(monthlySchedulePath, {
      findOne: () => ({
        select: () => ({
          lean: async () => null,
        }),
      }),
      findByIdAndUpdate: async () => null,
    });
    putMock(holidayServicePath, { listHolidays: async () => [] });
    putMock(schedulerIndexPath, {
      generateMonthlyPlan: async () => ({
        assignments: [],
        issues: [{ date: "2026-03-15", shiftId: "icu-red", missing: 1, reason: "NO_CANDIDATE" }],
        candidateAudit: [
          {
            date: "2026-03-15",
            shiftId: "icu-red",
            inputStaffCount: 12,
            candidateBuilderEligibleCount: 0,
            postConstraintCount: 0,
            hardFilteredBlockingRules: { SECTION_ELIGIBILITY: 8, ROLE_ELIGIBILITY: 4 },
            runtimeGuardBlockingRules: {},
            rejected: [
              { failedRuleCodes: ["SECTION_ELIGIBILITY"], reasonCodes: ["SECTION_ELIGIBILITY"] },
              { failedRuleCodes: ["ROLE_ELIGIBILITY"], reasonCodes: ["ROLE_ELIGIBILITY"] },
            ],
          },
        ],
        shadowAudit: null,
      }),
    });
    putMock(draftRosterPath, {
      generateDraftRoster: () => ({ assignments: [], issues: [] }),
    });
    putMock(ruleResolverPath, {
      fetchDutyRules: async () => ({ doc: null, rules: {}, weights: {} }),
      DEFAULT_RULES: {},
      DEFAULT_WEIGHTS: {},
    });
    putMock(staffResolverPath, {
      resolveStaff: async () => ({ staff: [], debug: { rawCount: 0, filteredCount: 0, usedFallback: false, roleTokens: [] } }),
    });
    putMock(validatorPath, {
      validateAssignments: ({ assignments, issues = [] }) => ({ assignments, issues, debug: { hardFiltered: 0 } }),
    });
    putMock(holidayPolicyAdapterPath, {
      applyHolidayPolicies: ({ days }) => days,
    });
    putMock(inputBuilderPath, {
      buildSchedulerInput: ({ payload }) => ({
        effectiveDefs: payload.defs || [],
        effectiveOverrides: {},
        effectiveShiftOptions: [],
        days: payload.days || [{ date: "2026-03-15", weekday: 0, shifts: [{ id: "icu-red", code: "N", requiredCount: 1 }] }],
        holidayKindByDate: {},
        shiftMetaByCode: {},
      }),
    });

    const { generateSchedule } = require(schedulerServicePath);
    const result = await generateSchedule({
      sectionId: "sec-1",
      serviceId: "svc-1",
      role: "nurse",
      year: 2026,
      month: 3,
      dryRun: false,
      userId: "user-1",
      hospitalId: null,
      payload: {
        days: [{ date: "2026-03-15", weekday: 0, shifts: [{ id: "icu-red", code: "N", requiredCount: 1 }] }],
      },
    });

    logJson("ISSUE_DIAGNOSTICS", result?.data?.issueDiagnostics || []);
  } finally {
    for (const modulePath of touchedModules) {
      const resolved = require.resolve(modulePath);
      delete require.cache[resolved];
      if (originalCache.has(resolved) && originalCache.get(resolved)) {
        require.cache[resolved] = originalCache.get(resolved);
      }
    }
  }
}

async function runPayloadStaffHydrationCheck() {
  const personModelPath = path.join(backendRoot, "models", "Person.js");
  const generatedSchedulePath = path.join(backendRoot, "models", "GeneratedSchedule.js");
  const monthlySchedulePath = path.join(backendRoot, "models", "MonthlySchedule.js");
  const holidayServicePath = path.join(backendRoot, "services", "holidayService.js");
  const schedulerIndexPath = path.join(backendRoot, "services", "scheduler", "index.js");
  const draftRosterPath = path.join(backendRoot, "services", "scheduler", "draftRoster.js");
  const ruleResolverPath = path.join(backendRoot, "services", "scheduler", "ruleResolver.js");
  const staffResolverPath = path.join(backendRoot, "services", "scheduler", "staffResolver.js");
  const validatorPath = path.join(backendRoot, "services", "scheduler", "validator.js");
  const holidayPolicyAdapterPath = path.join(backendRoot, "services", "scheduler", "holidayPolicyAdapter.js");
  const inputBuilderPath = path.join(backendRoot, "services", "scheduler", "inputBuilder.js");
  const schedulerServicePath = path.join(backendRoot, "services", "schedulerService.js");

  const originalCache = new Map();
  const touchedModules = [
    personModelPath,
    generatedSchedulePath,
    monthlySchedulePath,
    holidayServicePath,
    schedulerIndexPath,
    draftRosterPath,
    ruleResolverPath,
    staffResolverPath,
    validatorPath,
    holidayPolicyAdapterPath,
    inputBuilderPath,
    schedulerServicePath,
  ];

  for (const modulePath of touchedModules) {
    try {
      const resolved = require.resolve(modulePath);
      originalCache.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    } catch {}
  }

  let hydratedStaffSnapshot = [];
  const putMock = (modulePath, exportsValue) => {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: exportsValue,
    };
  };

  try {
    putMock(personModelPath, {
      find: () => ({
        select: () => ({
          lean: async () => [
            {
              _id: "p-hydrate-1",
              name: "Hydrated Nurse",
              active: true,
              serviceId: "svc-db",
              meta: {
                areas: ["RESUSITASYON"],
                shiftCodes: ["N", "V2"],
                role: "nurse",
                title: "Uzman",
              },
            },
          ],
        }),
      }),
    });
    putMock(generatedSchedulePath, {
      create: async (payload) => ({ _id: "generated-hydration-check", data: payload.data }),
      findByIdAndUpdate: async () => null,
    });
    putMock(monthlySchedulePath, {
      findOne: () => ({
        select: () => ({
          lean: async () => null,
        }),
      }),
      findByIdAndUpdate: async () => null,
    });
    putMock(holidayServicePath, { listHolidays: async () => [] });
    putMock(schedulerIndexPath, {
      generateMonthlyPlan: async ({ getActiveStaff }) => {
        hydratedStaffSnapshot = await getActiveStaff();
        return {
          assignments: [],
          issues: [],
          candidateAudit: [],
          shadowAudit: null,
        };
      },
    });
    putMock(draftRosterPath, {
      generateDraftRoster: () => ({ assignments: [], issues: [] }),
    });
    putMock(ruleResolverPath, {
      fetchDutyRules: async () => ({ doc: null, rules: {}, weights: {} }),
      DEFAULT_RULES: {},
      DEFAULT_WEIGHTS: {},
    });
    putMock(staffResolverPath, {
      resolveStaff: async () => ({ staff: [], debug: { rawCount: 0, filteredCount: 0, usedFallback: false, roleTokens: [] } }),
    });
    putMock(validatorPath, {
      validateAssignments: ({ assignments, issues = [] }) => ({ assignments, issues, debug: { hardFiltered: 0 } }),
    });
    putMock(holidayPolicyAdapterPath, {
      applyHolidayPolicies: ({ days }) => days,
    });
    putMock(inputBuilderPath, {
      buildSchedulerInput: ({ payload }) => ({
        effectiveDefs: payload.defs || [],
        effectiveOverrides: {},
        effectiveShiftOptions: [],
        days: payload.days || [{ date: "2026-03-15", weekday: 0, shifts: [] }],
        holidayKindByDate: {},
        shiftMetaByCode: {},
      }),
    });

    const { generateSchedule } = require(schedulerServicePath);
    const result = await generateSchedule({
      sectionId: "sec-1",
      serviceId: "svc-ui",
      role: "nurse",
      year: 2026,
      month: 3,
      dryRun: false,
      userId: "user-1",
      hospitalId: null,
      payload: {
        staff: [
          {
            id: "p-hydrate-1",
            name: "UI Nurse",
            active: true,
            serviceId: "svc-ui",
            stats: { assignmentsThisMonth: 4 },
            meta: {},
          },
        ],
        days: [{ date: "2026-03-15", weekday: 0, shifts: [] }],
      },
    });

    logJson("PAYLOAD_STAFF_HYDRATION", {
      debug: result?.data?.debug?.staff || null,
      hydratedStaff: hydratedStaffSnapshot.map((person) => ({
        id: person?.id,
        name: person?.name,
        serviceId: person?.serviceId,
        areas: person?.areas,
        shiftCodes: person?.shiftCodes,
        role: person?.role,
        title: person?.title,
        stats: person?.stats,
        meta: person?.meta,
      })),
    });
  } finally {
    for (const modulePath of touchedModules) {
      const resolved = require.resolve(modulePath);
      delete require.cache[resolved];
      if (originalCache.has(resolved) && originalCache.get(resolved)) {
        require.cache[resolved] = originalCache.get(resolved);
      }
    }
  }
}

async function main() {
  printSection("UI PAYLOAD + SHAPE CHECKS");
  runShapeChecks();

  printSection("MULTI-DAY STATE PROGRESSION");
  runMultiDayProgressionCheck();

  printSection("RULE ENGINE PATH");
  runRuleEngineCheck();

  printSection("PAYLOAD ONLY SCHEDULER INPUT");
  runPayloadOnlySchedulerInputCheck();

  printSection("CANDIDATE BUILDER SOFT RULES");
  runCandidateRuleChecks();

  printSection("NIGHT SEMANTICS");
  runNightSemanticsChecks();

  printSection("CAPACITY GUARD PARITY");
  runCapacityGuardParityChecks();

  printSection("AUDIT PERSISTENCE");
  await runAuditPersistenceCheck();

  printSection("MONTHLY WRITE-BACK DIAGNOSTIC");
  await runMonthlyWriteBackDiagnosticCheck();

  printSection("GENERATED OVERSIZE RETRY");
  await runGeneratedOversizeRetryCheck();

  printSection("MONTHLY SCHEDULER INPUT PROJECTION");
  await runMonthlyScheduleProjectionCheck();

  printSection("ISSUE DIAGNOSTICS");
  await runIssueDiagnosticsCheck();

  printSection("PAYLOAD STAFF HYDRATION");
  await runPayloadStaffHydrationCheck();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
