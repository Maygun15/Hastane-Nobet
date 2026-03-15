"use strict";

/**
 * Centralized composite activation modes for V3.
 */
const COMPOSITE_MODES = Object.freeze({
  SHADOW_ONLY: "shadow_only",
  SOFT_PENALTY: "soft_penalty",
  HARD_REJECT: "hard_reject",
});

const DEFAULT_COMPOSITE_MODE = COMPOSITE_MODES.SHADOW_ONLY;

function resolveCompositeMode(mode) {
  const normalized = normalizeValue(mode);
  if (normalized === COMPOSITE_MODES.SOFT_PENALTY) return COMPOSITE_MODES.SOFT_PENALTY;
  if (normalized === COMPOSITE_MODES.HARD_REJECT) return COMPOSITE_MODES.HARD_REJECT;
  return DEFAULT_COMPOSITE_MODE;
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = {
  COMPOSITE_MODES,
  DEFAULT_COMPOSITE_MODE,
  resolveCompositeMode,
};
