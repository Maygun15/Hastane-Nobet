"use strict";

const path = require("path");

const constraintsPath = path.join(__dirname, "..", "services", "scheduler", "constraints.js");
const enginePath = path.join(__dirname, "..", "services", "scheduler", "engine.js");
const validatorPath = path.join(__dirname, "..", "services", "scheduler", "validator.js");
const candidateBuilderPath = path.join(
  __dirname,
  "..",
  "services",
  "scheduler",
  "candidateBuilder",
  "index.js"
);

const { explainAvailability } = require(constraintsPath);
const { validateAssignments } = require(validatorPath);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function getISOWeekKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

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
    meta: {},
    ...overrides,
  };
}

function createShift(overrides = {}) {
  return {
    id: "D",
    code: "D",
    label: "TRIAJ",
    area: "TRIAJ",
    serviceId: "svc-1",
    requiredCount: 1,
    hours: 8,
    start: "08:00",
    end: "16:00",
    ...overrides,
  };
}

function createDay(overrides = {}) {
  return {
    date: "2026-03-18",
    weekday: 3,
    shifts: [createShift()],
    ...overrides,
  };
}

function createBaseContext(overrides = {}) {
  return {
    staff: [createRuntimePerson("p1")],
    days: [createDay()],
    leavesByPerson: {},
    requestsByPerson: {},
    rules: {},
    weights: {},
    issues: [],
    assignments: [],
    candidateAudit: [],
    audit: { observations: [] },
    targetHours: 0,
    targetShifts: 0,
    randomize: false,
    debug: {},
    auditOptions: {},
    ...overrides,
  };
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function withScheduler(mockBuildCandidates, fn) {
  const candidateBuilder = require(candidateBuilderPath);
  const originalBuildCandidates = candidateBuilder.buildCandidates;

  if (typeof mockBuildCandidates === "function") {
    candidateBuilder.buildCandidates = mockBuildCandidates;
  }

  clearModule(enginePath);
  const { runScheduler } = require(enginePath);

  try {
    fn(runScheduler);
  } finally {
    candidateBuilder.buildCandidates = originalBuildCandidates;
    clearModule(enginePath);
  }
}

function testOneShiftPerDay() {
  const person = createRuntimePerson("p1", {
    assignedDays: ["2026-03-18"],
  });
  const day = createDay({ date: "2026-03-18" });
  const shift = createShift();
  const context = createBaseContext({ rules: { ONE_SHIFT_PER_DAY: true } });

  const result = explainAvailability(person, day, context, shift);
  assertEqual(result.allowed, false, "ONE_SHIFT_PER_DAY ihlali bloklanmalı");
  assertEqual(result.reason, "ONE_SHIFT_PER_DAY", "ONE_SHIFT_PER_DAY reason bekleniyor");
}

function testLeaveBlockFallbackBypass() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [],
    candidates: [],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 0 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [createRuntimePerson("p1", { name: "Izinli Personel" })],
      rules: { LEAVE_BLOCK: true },
      leavesByPerson: { p1: ["2026-03-18"] },
    });

    const result = runScheduler(context);
    const audit = result.candidateAudit[0] || {};

    assertEqual(result.assignments.length, 0, "LEAVE_BLOCK fallback ile by-pass edilmemeli");
    assertEqual(audit.fallbackUsed, true, "Fallback kullanıldı bilgisi korunmalı");
    assertEqual(audit.postConstraintCount, 0, "Constraint sonrası aday kalmamalı");
    assertEqual(audit.constraintRejectedByReason?.LEAVE_BLOCK, 1, "LEAVE_BLOCK reason sayılmalı");
  });
}

function testNight24hNextDayBlock() {
  const person = createRuntimePerson("p1", {
    lastShift: {
      date: "2026-03-17",
      code: "V2",
      start: "20:00",
      end: "08:00",
    },
  });
  const day = createDay({ date: "2026-03-18" });
  const shift = createShift({ code: "A", id: "A" });
  const context = createBaseContext();

  const result = explainAvailability(person, day, context, shift);
  assertEqual(result.allowed, false, "24 saat kuralı ertesi günü bloklamalı");
  assertEqual(result.reason, "NIGHT_24H_NEXT_DAY_BLOCK", "24 saat reason bekleniyor");
}

function testMaxConsecutiveDays() {
  const person = createRuntimePerson("p1", {
    consecutiveDays: 3,
    lastAssignedDate: "2026-03-17",
  });
  const day = createDay({ date: "2026-03-18" });
  const shift = createShift();
  const context = createBaseContext({ rules: { MAX_CONSECUTIVE_DAYS: 3 } });

  const result = explainAvailability(person, day, context, shift);
  assertEqual(result.allowed, false, "MAX_CONSECUTIVE_DAYS bloklamalı");
  assertEqual(result.reason, "MAX_CONSECUTIVE_DAYS", "MAX_CONSECUTIVE_DAYS reason bekleniyor");
}

function testMaxShiftsPerWeek() {
  const date = "2026-03-18";
  const weekKey = getISOWeekKey(date);
  const person = createRuntimePerson("p1", {
    weeklyCounts: { [weekKey]: 2 },
  });
  const day = createDay({ date });
  const shift = createShift();
  const context = createBaseContext({ rules: { MAX_SHIFTS_PER_WEEK: 2 } });

  const result = explainAvailability(person, day, context, shift);
  assertEqual(result.allowed, false, "MAX_SHIFTS_PER_WEEK bloklamalı");
  assertEqual(result.reason, "MAX_SHIFTS_PER_WEEK", "MAX_SHIFTS_PER_WEEK reason bekleniyor");
}

function testShiftCodeNotAllowed() {
  const person = createRuntimePerson("p1", {
    shiftCodes: ["A"],
  });
  const day = createDay();
  const shift = createShift({ code: "D", id: "D" });
  const context = createBaseContext();

  const result = explainAvailability(person, day, context, shift);
  assertEqual(result.allowed, false, "SHIFT_CODE_NOT_ALLOWED bloklamalı");
  assertEqual(result.reason, "SHIFT_CODE_NOT_ALLOWED", "SHIFT_CODE_NOT_ALLOWED reason bekleniyor");
}

function testAreaNotAllowed() {
  const person = createRuntimePerson("p1", {
    areas: ["ECZANE"],
  });
  const day = createDay();
  const shift = createShift({ label: "TRIAJ", area: "TRIAJ" });
  const context = createBaseContext();

  const result = explainAvailability(person, day, context, shift);
  assertEqual(result.allowed, false, "AREA_NOT_ALLOWED bloklamalı");
  assertEqual(result.reason, "AREA_NOT_ALLOWED", "AREA_NOT_ALLOWED reason bekleniyor");
}

function testMinRestHours() {
  const person = createRuntimePerson("p1", {
    lastShift: {
      date: "2026-03-17",
      code: "A",
      start: "16:00",
      end: "23:00",
    },
  });
  const day = createDay({ date: "2026-03-18" });
  const shift = createShift({ start: "06:00", end: "14:00" });
  const context = createBaseContext({ rules: { MIN_REST_HOURS: 12 } });

  const result = explainAvailability(person, day, context, shift);
  assertEqual(result.allowed, false, "MIN_REST_HOURS bloklamalı");
  assertEqual(result.reason, "MIN_REST_HOURS", "MIN_REST_HOURS reason bekleniyor");
}

function testInvalidAssignee() {
  const result = validateAssignments({
    assignments: [
      { date: "2026-03-18", shiftId: "D", personId: "p1", personName: "Gercek Personel" },
      { date: "2026-03-18", shiftId: "D", personName: "deneme" },
    ],
    staff: [{ id: "p1", name: "Gercek Personel" }],
  });

  assertEqual(result.assignments.length, 1, "Geçersiz assignee temizlenmeli");
  assertEqual(result.assignments[0].personId, "p1", "Geçerli personel korunmalı");
  assertEqual(result.debug.invalidAssignmentCount, 1, "Invalid assignment sayısı 1 olmalı");
  assertEqual(result.debug.invalidAssignmentByReason.RAW_LABEL, 1, "RAW_LABEL reason sayılmalı");
  assertEqual(result.issues[0].reason, "INVALID_ASSIGNEE", "Issue INVALID_ASSIGNEE olmalı");
}

function testNoCandidateReasonSummaryCorrectness() {
  const mockBuildCandidates = ({ staff }) => ({
    eligible: [],
    rejected: [],
    candidates: [],
    stats: { totalStaff: Array.isArray(staff) ? staff.length : 0, eligibleCount: 0, rejectedCount: 0 },
  });

  withScheduler(mockBuildCandidates, (runScheduler) => {
    const context = createBaseContext({
      staff: [createRuntimePerson("p1", { name: "Izinli Personel" })],
      rules: { LEAVE_BLOCK: true },
      leavesByPerson: { p1: ["2026-03-18"] },
    });

    const result = runScheduler(context);
    const observation = result.audit?.observations?.[0];
    const summary = observation?.noCandidateReasonSummary;

    assert(result.assignments.length === 0, "NO_CANDIDATE senaryosunda atama olmamalı");
    assert(observation, "Observation üretilmeli");
    assertEqual(observation.selectedCandidateId, null, "Seçilen aday olmamalı");
    assert(summary && typeof summary === "object", "noCandidateReasonSummary dolmalı");
    assertEqual(summary.fallbackUsed, true, "Fallback bilgisi summary içinde korunmalı");
    assertEqual(summary.constraints?.LEAVE_BLOCK, 1, "Constraint summary içinde LEAVE_BLOCK görünmeli");
  });
}

const tests = [
  { name: "ONE_SHIFT_PER_DAY", fn: testOneShiftPerDay },
  { name: "LEAVE_BLOCK fallback bypass", fn: testLeaveBlockFallbackBypass },
  { name: "NIGHT_24H_NEXT_DAY_BLOCK", fn: testNight24hNextDayBlock },
  { name: "MAX_CONSECUTIVE_DAYS", fn: testMaxConsecutiveDays },
  { name: "MAX_SHIFTS_PER_WEEK", fn: testMaxShiftsPerWeek },
  { name: "SHIFT_CODE_NOT_ALLOWED", fn: testShiftCodeNotAllowed },
  { name: "AREA_NOT_ALLOWED", fn: testAreaNotAllowed },
  { name: "MIN_REST_HOURS", fn: testMinRestHours },
  { name: "INVALID_ASSIGNEE", fn: testInvalidAssignee },
  { name: "NO_CANDIDATE reason summary correctness", fn: testNoCandidateReasonSummaryCorrectness },
];

function run() {
  let failed = 0;

  for (const test of tests) {
    try {
      test.fn();
      console.log(`[PASS] ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`[FAIL] ${test.name} -> ${error.message}`);
      if (error?.stack) {
        const stackLines = String(error.stack).split("\n").slice(1, 4);
        stackLines.forEach((line) => console.error(line));
      }
    }
  }

  if (failed > 0) {
    console.error(`\nToplam hata: ${failed}`);
    process.exit(1);
  }

  console.log(`\nTüm Kural 3 üretim testleri geçti (${tests.length}/${tests.length}).`);
}

run();
