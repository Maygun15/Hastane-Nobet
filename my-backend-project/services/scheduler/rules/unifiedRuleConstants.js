"use strict";

/**
 * Shared constants for the unified scheduler rule registry.
 * Keep these values stable so legacy-to-unified mappings stay predictable.
 */
const UNIFIED_RULE_TYPES = Object.freeze({
  HARD: "HARD",
  STRONG: "STRONG",
  FAIRNESS: "FAIRNESS",
  SOFT: "SOFT",
});

const UNIFIED_RULE_BEHAVIORS = Object.freeze({
  BLOCK: "BLOCK",
  PENALTY: "PENALTY",
  WARNING: "WARNING",
  SHADOW: "SHADOW",
});

module.exports = Object.freeze({
  UNIFIED_RULE_TYPES,
  UNIFIED_RULE_BEHAVIORS,
});
