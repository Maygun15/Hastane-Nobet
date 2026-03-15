"use strict";

const collector = require("./shadowAuditCollector");
const aggregator = require("./shadowAuditAggregator");

module.exports = {
  ...collector,
  ...aggregator,
};
