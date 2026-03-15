"use strict";

const registry = require("./unifiedRuleRegistry");
const constants = require("./unifiedRuleConstants");

module.exports = Object.freeze({
  ...constants,
  ...registry,
});
