"use strict";

const assert = require("assert");
const path = require("path");

const policiesDir = path.join(__dirname, "..", "services", "scheduler", "policies");
const fairnessPolicy = require(path.join(policiesDir, "fairness.policy.js"));
const workloadBalancePolicy = require(path.join(policiesDir, "workloadBalance.policy.js"));
const fatiguePolicy = require(path.join(policiesDir, "fatigue.policy.js"));
const evaluatePolicies = require(path.join(policiesDir, "evaluatePolicies.js"));

function testFairnessWithStats() {
  const result = fairnessPolicy({ person: { stats: { assignmentsThisMonth: 4 } } }, {});

  assert.strictEqual(result.policy, "FAIRNESS");
  assert.strictEqual(result.score, -4);
  assert.strictEqual(result.reason, null);
  assert.strictEqual(result.meta.assignmentsThisMonth, 4);
  assert.strictEqual(result.meta.statsMissing, false);
}

function testFairnessMissingStats() {
  const result = fairnessPolicy({ person: {} }, {});

  assert.strictEqual(result.policy, "FAIRNESS");
  assert.ok(result.score === 0, "missing stats should produce a neutral score");
  assert.strictEqual(result.reason, "ASSIGNMENTS_THIS_MONTH_MISSING");
  assert.strictEqual(result.meta.neutral, true);
  assert.strictEqual(result.meta.statsMissing, true);
}

function testWorkloadBalanceBelowTarget() {
  const result = workloadBalancePolicy(
    { person: { totalHours: 40, totalShifts: 5 } },
    { targetHours: 80, targetShifts: 10 }
  );

  assert.strictEqual(result.policy, "WORKLOAD_BALANCE");
  assert.ok(result.score > 0, "below-target workload should produce a positive score");
  assert.strictEqual(result.reason, null);
  assert.strictEqual(result.meta.missingTargets, false);
}

function testWorkloadBalanceAboveTarget() {
  const result = workloadBalancePolicy(
    { person: { totalHours: 100, totalShifts: 12 } },
    { targetHours: 80, targetShifts: 10 }
  );

  assert.strictEqual(result.policy, "WORKLOAD_BALANCE");
  assert.ok(result.score < 0, "above-target workload should produce a negative score");
  assert.strictEqual(result.reason, null);
  assert.strictEqual(result.meta.missingTargets, false);
}

function testWorkloadBalanceMissingTargets() {
  const result = workloadBalancePolicy(
    { person: { totalHours: 20, totalShifts: 3 } },
    {}
  );

  assert.strictEqual(result.policy, "WORKLOAD_BALANCE");
  assert.ok(result.score === 0, "missing targets should produce a neutral score");
  assert.strictEqual(result.reason, "WORKLOAD_TARGETS_MISSING");
  assert.strictEqual(result.meta.neutral, true);
  assert.strictEqual(result.meta.missingTargets, true);
}

function testFatigueNightPenalty() {
  const result = fatiguePolicy(
    { person: { lastShift: { isNight: true, date: "2026-03-15", code: "N" }, consecutiveDays: 1 } },
    {}
  );

  assert.strictEqual(result.policy, "FATIGUE");
  assert.ok(result.score < 0, "recent night shift should produce a negative score");
  assert.strictEqual(result.reason, "RECENT_NIGHT_SHIFT");
  assert.strictEqual(result.meta.lastShiftIsNight, true);
}

function testFatigueConsecutivePenalty() {
  const result = fatiguePolicy(
    { person: { consecutiveDays: 4 } },
    {}
  );

  assert.strictEqual(result.policy, "FATIGUE");
  assert.ok(result.score < 0, "consecutive day load should produce a negative score");
  assert.strictEqual(result.reason, "CONSECUTIVE_DAYS_LOAD");
  assert.strictEqual(result.meta.consecutiveDays, 4);
}

function testFatigueMinimalData() {
  const result = fatiguePolicy({ person: {} }, {});

  assert.strictEqual(result.policy, "FATIGUE");
  assert.ok(result.score === 0, "minimal fatigue data should produce a neutral score");
  assert.strictEqual(result.reason, "FATIGUE_DATA_MINIMAL");
  assert.strictEqual(result.meta.neutral, true);
}

function testEvaluatePoliciesAggregationAndShape() {
  const result = evaluatePolicies(
    {
      person: {
        stats: { assignmentsThisMonth: 2 },
        lastShift: { isNight: true, date: "2026-03-15", code: "N" },
        consecutiveDays: 3,
        totalHours: 40,
        totalShifts: 5,
      },
    },
    { targetHours: 80, targetShifts: 10 }
  );

  assert.ok(Array.isArray(result.policies), "policies must be an array");
  assert.strictEqual(result.policies.length, 3, "all configured policies must be evaluated");
  for (const policy of result.policies) {
    assert.ok(typeof policy.policy === "string" && policy.policy.length > 0, "policy name is required");
    assert.ok(Number.isFinite(policy.score), "policy score must be numeric");
    assert.ok(policy.meta && typeof policy.meta === "object" && !Array.isArray(policy.meta), "policy meta must be an object");
    assert.ok(Object.prototype.hasOwnProperty.call(policy, "reason"), "policy reason field must exist");
  }

  const expectedTotal = result.policies.reduce((sum, policy) => sum + policy.score, 0);
  assert.strictEqual(result.totalScore, expectedTotal, "totalScore must equal sum of policy scores");
}

function run() {
  const tests = [
    { name: "FAIRNESS with stats", fn: testFairnessWithStats },
    { name: "FAIRNESS missing stats", fn: testFairnessMissingStats },
    { name: "WORKLOAD_BALANCE below target", fn: testWorkloadBalanceBelowTarget },
    { name: "WORKLOAD_BALANCE above target", fn: testWorkloadBalanceAboveTarget },
    { name: "WORKLOAD_BALANCE missing targets", fn: testWorkloadBalanceMissingTargets },
    { name: "FATIGUE night penalty", fn: testFatigueNightPenalty },
    { name: "FATIGUE consecutive penalty", fn: testFatigueConsecutivePenalty },
    { name: "FATIGUE minimal data", fn: testFatigueMinimalData },
    { name: "evaluatePolicies aggregation and shape", fn: testEvaluatePoliciesAggregationAndShape },
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
    console.log(`All policy layer checks passed (${passed}/${tests.length}).`);
  }
}

run();
