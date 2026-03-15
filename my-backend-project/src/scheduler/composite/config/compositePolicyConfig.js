"use strict";

const { DEFAULT_COMPOSITE_MODE } = require("../policy/compositeModes");

/**
 * V3 composite policy config skeleton.
 * Service-level policy can grow here later without changing V2 behavior.
 */
const COMPOSITE_POLICY_CONFIG = Object.freeze({
  defaultMode: DEFAULT_COMPOSITE_MODE,
  defaultScorePenalty: -10,
  services: Object.freeze({}),
});

function getCompositePolicyConfig(serviceId = null) {
  const normalizedServiceId = normalizeValue(serviceId);
  const serviceConfig = normalizedServiceId
    ? COMPOSITE_POLICY_CONFIG.services[normalizedServiceId] || null
    : null;

  return {
    defaultMode: COMPOSITE_POLICY_CONFIG.defaultMode,
    scorePenalty:
      serviceConfig?.scorePenalty ?? COMPOSITE_POLICY_CONFIG.defaultScorePenalty,
    mode: serviceConfig?.mode ?? COMPOSITE_POLICY_CONFIG.defaultMode,
    serviceId: normalizedServiceId,
  };
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = {
  COMPOSITE_POLICY_CONFIG,
  getCompositePolicyConfig,
};
