"use strict";

/**
 * Shared V3 composite constants.
 */
const COMPOSITE_POLICY_ACTIONS = Object.freeze({
  NONE: "none",
  PENALTY: "penalty",
  REJECT: "reject",
});

const DEFAULT_COMPOSITE_SCORE_PENALTY = -10;
const COMPOSITE_OBSERVATION_CODE = "COMPOSITE_WORK_AREA_OBSERVATION_V3";

module.exports = {
  COMPOSITE_POLICY_ACTIONS,
  DEFAULT_COMPOSITE_SCORE_PENALTY,
  COMPOSITE_OBSERVATION_CODE,
};
