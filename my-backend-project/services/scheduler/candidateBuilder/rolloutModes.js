"use strict";

// Internal rollout contract only. Runtime behavior is unchanged in this stabilization step.
const ROLLOUT_MODES = Object.freeze({
  SAFE: "safe",
  STRICT: "strict",
});

const ROLLOUT_MODE_CONTRACT = Object.freeze({
  [ROLLOUT_MODES.SAFE]: Object.freeze({
    mode: ROLLOUT_MODES.SAFE,
    fallbackPolicy: "enabled",
    description: "Fallback remains enabled; hard rejects may be bypassed by legacy fallback.",
  }),
  [ROLLOUT_MODES.STRICT]: Object.freeze({
    mode: ROLLOUT_MODES.STRICT,
    fallbackPolicy: "disabled",
    description: "Fallback is disabled; hard rejects are not reintroduced into candidate selection.",
  }),
});

function getRolloutModeContract(mode = ROLLOUT_MODES.SAFE) {
  return ROLLOUT_MODE_CONTRACT[mode] || ROLLOUT_MODE_CONTRACT[ROLLOUT_MODES.SAFE];
}

module.exports = Object.freeze({
  ROLLOUT_MODES,
  ROLLOUT_MODE_CONTRACT,
  getRolloutModeContract,
});
