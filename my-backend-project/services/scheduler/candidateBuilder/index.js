"use strict";

const RULE_CODES = require("./ruleCodes");
const RULE_CATALOG = require("./ruleCatalog");
const { createRuleRegistry } = require("./ruleRegistry");
const { buildCandidates } = require("./buildCandidates");
const { evaluateCandidate, DEFAULT_RULE_ORDER } = require("./evaluateCandidate");
const { evaluateCandidateShadow } = require("./shadowEvaluateRules");
const activationStrategy = require("./activationStrategy");
const contextContract = require("./contextContract");
const rolloutModes = require("./rolloutModes");
const ruleState = require("./ruleState");
const REASON_CODES = require("./reasonCodes");
const { DEFAULT_RULE_EXECUTION_ORDER } = require("./ruleExecutionOrder");
const taskPlaceTaxonomy = require("./taskPlaceTaxonomy");
const compositeTaskPlaceShadow = require("./evaluateCompositeTaskPlaceShadow");

/**
 * Public API for Candidate Builder module.
 * Current phase exposes only modular skeleton interfaces.
 */
module.exports = {
  RULE_CODES,
  REASON_CODES,
  RULE_CATALOG,
  listShadowRuleCodes: RULE_CATALOG.listShadowRuleCodes,
  getRuleReadiness: RULE_CATALOG.getRuleReadiness,
  listRuleStates: RULE_CATALOG.listRuleStates || ruleState.listRuleStates,
  getRuleActivationStrategy: activationStrategy.getRuleActivationStrategy,
  listRuleActivationStrategies: activationStrategy.listRuleActivationStrategies,
  CANDIDATE_CONTEXT_FIELDS: contextContract.CANDIDATE_CONTEXT_FIELDS,
  ROLE_REQUIRED_ROLE_PRECEDENCE: contextContract.ROLE_REQUIRED_ROLE_PRECEDENCE,
  SECTION_TARGET_PRECEDENCE: contextContract.SECTION_TARGET_PRECEDENCE,
  SERVICE_ID_PRECEDENCE: contextContract.SERVICE_ID_PRECEDENCE,
  ROLLOUT_MODES: rolloutModes.ROLLOUT_MODES,
  getRolloutModeContract: rolloutModes.getRolloutModeContract,
  TASK_PLACE_KINDS: taskPlaceTaxonomy.TASK_PLACE_KINDS,
  normalizeTaskPlaceKey: taskPlaceTaxonomy.normalizeTaskPlaceKey,
  resolveTaskPlaceDefinition: taskPlaceTaxonomy.resolveTaskPlaceDefinition,
  classifyTaskPlace: taskPlaceTaxonomy.classifyTaskPlace,
  isWorkAreaTaskPlace: taskPlaceTaxonomy.isWorkAreaTaskPlace,
  isSectionTaskPlace: taskPlaceTaxonomy.isSectionTaskPlace,
  isCompositeTaskPlace: taskPlaceTaxonomy.isCompositeTaskPlace,
  isEligibleForCompositeTaskPlace: taskPlaceTaxonomy.isEligibleForCompositeTaskPlace,
  listTaskPlaceDefinitions: taskPlaceTaxonomy.listTaskPlaceDefinitions,
  listTaskPlaceKinds: taskPlaceTaxonomy.listTaskPlaceKinds,
  COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW_CODE:
    compositeTaskPlaceShadow.COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW_CODE,
  COMPOSITE_ACTIVATION_STRATEGIES:
    compositeTaskPlaceShadow.COMPOSITE_ACTIVATION_STRATEGIES,
  resolveCompositeActivationStrategy:
    compositeTaskPlaceShadow.resolveCompositeActivationStrategy,
  evaluateCompositeTaskPlacePolicy:
    compositeTaskPlaceShadow.evaluateCompositeTaskPlacePolicy,
  evaluateCompositeTaskPlaceShadow: compositeTaskPlaceShadow.evaluateCompositeTaskPlaceShadow,
  DEFAULT_RULE_EXECUTION_ORDER,
  DEFAULT_RULE_ORDER,
  createRuleRegistry,
  buildCandidates,
  evaluateCandidate,
  evaluateCandidateShadow,
};
