"use strict";

function normalizeObjectMap(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  return { ...value };
}

function normalizeRules(rules = {}) {
  return normalizeObjectMap(rules, {});
}

function normalizeWeights(weights = {}) {
  return normalizeObjectMap(weights, {});
}

module.exports = {
  normalizeRules,
  normalizeWeights,
};
