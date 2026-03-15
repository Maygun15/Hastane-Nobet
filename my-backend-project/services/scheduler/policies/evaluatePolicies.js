"use strict";

const fairnessPolicy = require("./fairness.policy");
const fatiguePolicy = require("./fatigue.policy");
const workloadBalancePolicy = require("./workloadBalance.policy");

function evaluatePolicies(candidate, context) {
  const policies = [
    fairnessPolicy(candidate, context),
    fatiguePolicy(candidate, context),
    workloadBalancePolicy(candidate, context),
  ].map(normalizePolicyResult);

  const totalScore = policies.reduce((sum, policy) => sum + policy.score, 0);

  return {
    totalScore,
    policies,
  };
}

function normalizePolicyResult(policyResult) {
  const raw = policyResult && typeof policyResult === "object" ? policyResult : {};
  const policy = normalizePolicyName(raw.policy);
  const numericScore = Number(raw.score);

  return {
    policy,
    score: Number.isFinite(numericScore) ? numericScore : 0,
    reason: normalizeOptionalString(raw.reason),
    meta: normalizeMeta(raw.meta),
  };
}

function normalizePolicyName(value) {
  const normalized = normalizeOptionalString(value);
  return normalized || "UNKNOWN_POLICY";
}

function normalizeOptionalString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

module.exports = evaluatePolicies;
