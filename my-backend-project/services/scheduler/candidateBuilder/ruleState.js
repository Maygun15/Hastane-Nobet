"use strict";

const ruleCatalog = require("./ruleCatalog");

function listRuleStates() {
  return ruleCatalog.RULE_CATALOG.map((item) => ({
    code: item.code,
    severity: item.severity,
    enabled: Boolean(item.enabled),
    rolloutStage: item.rolloutStage || (item.enabled ? "active" : "planned"),
    shadowMode: Boolean(item.shadowMode),
  }));
}

module.exports = Object.freeze({
  listRuleStates,
});
