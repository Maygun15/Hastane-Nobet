"use strict";

const COMPOSITE_SHADOW_RULE_CODE = "COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW";

function aggregateShadowObservations(observations = []) {
  const safeObservations = Array.isArray(observations) ? observations.filter(Boolean) : [];

  return {
    totals: buildTotals(safeObservations),
    ruleSummary: buildRuleSummary(safeObservations),
    personSummary: buildPersonSummary(safeObservations),
    serviceSummary: buildScopedSummary(safeObservations, "serviceId"),
    sectionSummary: buildScopedSummary(safeObservations, "section"),
    compositeTaskPlaceSummary: buildCompositeTaskPlaceSummary(safeObservations),
    compositeHotspotSummary: buildCompositeHotspotSummary(safeObservations),
  };
}

function buildTotals(observations) {
  return {
    observationCount: observations.length,
    triggeredCount: observations.filter((item) => item.triggered).length,
    wouldRejectCount: observations.filter((item) => item.wouldReject).length,
    missingDataRejectCount: observations.filter(isMissingDataReject).length,
  };
}

function buildRuleSummary(observations) {
  const grouped = new Map();

  for (const item of observations) {
    const key = item.ruleCode || "UNKNOWN_RULE";
    const entry = getOrCreateGroup(grouped, key, () => ({
      ruleCode: key,
      triggeredCount: 0,
      wouldRejectCount: 0,
      eligibleCount: 0,
      rejectedCount: 0,
      skippedCount: 0,
      missingDataRejectCount: 0,
    }));

    if (item.triggered) entry.triggeredCount += 1;
    if (item.wouldReject) entry.wouldRejectCount += 1;
    applyObservationOutcome(entry, item);
    if (isMissingDataReject(item)) entry.missingDataRejectCount += 1;
  }

  return Array.from(grouped.values()).sort(sortByKey("ruleCode"));
}

function buildPersonSummary(observations) {
  const grouped = new Map();

  for (const item of observations) {
    const key = item.personId || "UNKNOWN_PERSON";
    const entry = getOrCreateGroup(grouped, key, () => ({
      personId: key,
      triggeredRules: [],
      wouldReject: false,
    }));

    if (item.triggered && item.ruleCode && !entry.triggeredRules.includes(item.ruleCode)) {
      entry.triggeredRules.push(item.ruleCode);
    }

    if (item.wouldReject) {
      entry.wouldReject = true;
    }
  }

  return Array.from(grouped.values())
    .map((item) => ({
      personId: item.personId,
      triggeredRules: item.triggeredRules.sort(),
      wouldReject: item.wouldReject,
    }))
    .sort(sortByKey("personId"));
}

function buildScopedSummary(observations, field) {
  const grouped = new Map();

  for (const item of observations) {
    const scopeKey = item[field] || "UNKNOWN";
    const entry = getOrCreateGroup(grouped, scopeKey, () => ({
      [field]: scopeKey,
      rules: new Map(),
    }));

    const ruleKey = item.ruleCode || "UNKNOWN_RULE";
    const ruleEntry = getOrCreateGroup(entry.rules, ruleKey, () => ({
      ruleCode: ruleKey,
      triggeredCount: 0,
      wouldRejectCount: 0,
      eligibleCount: 0,
      rejectedCount: 0,
      skippedCount: 0,
      missingDataRejectCount: 0,
    }));

    if (item.triggered) ruleEntry.triggeredCount += 1;
    if (item.wouldReject) ruleEntry.wouldRejectCount += 1;
    applyObservationOutcome(ruleEntry, item);
    if (isMissingDataReject(item)) ruleEntry.missingDataRejectCount += 1;
  }

  return Array.from(grouped.values())
    .map((entry) => ({
      [field]: entry[field],
      rules: Array.from(entry.rules.values()).sort(sortByKey("ruleCode")),
    }))
    .sort(sortByKey(field));
}

function buildCompositeTaskPlaceSummary(observations) {
  const grouped = new Map();

  for (const item of observations) {
    if (item?.taskPlaceKind !== "COMPOSITE_WORK_AREA") continue;
    const key = item?.targetLabel || item?.section || "UNKNOWN_COMPOSITE_TASK_PLACE";
    const entry = getOrCreateGroup(grouped, key, () => ({
      targetLabel: key,
      triggeredCount: 0,
      eligibleCount: 0,
      rejectedCount: 0,
      skippedCount: 0,
      wouldRejectCount: 0,
      eligibleWorkAreasAnyOf: [],
    }));

    if (item.triggered) entry.triggeredCount += 1;
    if (item.wouldReject) {
      entry.wouldRejectCount += 1;
    }
    applyObservationOutcome(entry, item);

    if (!entry.eligibleWorkAreasAnyOf.length && Array.isArray(item?.eligibleWorkAreasAnyOf)) {
      entry.eligibleWorkAreasAnyOf = item.eligibleWorkAreasAnyOf.filter(Boolean);
    }
  }

  return Array.from(grouped.values()).sort(sortByKey("targetLabel"));
}

function buildCompositeHotspotSummary(observations = []) {
  const compositeObservations = observations.filter(
    (item) => item?.ruleCode === COMPOSITE_SHADOW_RULE_CODE
  );
  const byService = new Map();
  const bySection = new Map();
  const byServiceSection = new Map();

  // Example mock observations:
  // [
  //   { ruleCode:"COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW", serviceId:"svc-a", section:"KIRMIZI VE SARI", targetLabel:"KIRMIZI VE SARI", wouldReject:false },
  //   { ruleCode:"COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW", serviceId:"svc-a", section:"KIRMIZI VE SARI", targetLabel:"KIRMIZI VE SARI", wouldReject:true },
  //   { ruleCode:"COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW", serviceId:"svc-b", section:"MAVI VE BEYAZ", targetLabel:"MAVI VE BEYAZ", wouldReject:true },
  // ]
  // =>
  // {
  //   compositeHotspotSummary: {
  //     byService: [
  //       { serviceId:"svc-a", triggeredCount:2, eligibleCount:1, rejectedCount:1 },
  //       { serviceId:"svc-b", triggeredCount:1, eligibleCount:0, rejectedCount:1 },
  //     ],
  //   }
  // }
  for (const item of compositeObservations) {
    const serviceId = item?.serviceId || "UNKNOWN_SERVICE";
    const sectionKey = item?.section || "UNKNOWN_SECTION";
    const compositeTaskKey = item?.targetLabel || sectionKey || "UNKNOWN_COMPOSITE";

    incrementCompositeCounters(
      ensureCounterEntry(byService, serviceId, () => ({
        serviceId,
        triggeredCount: 0,
        eligibleCount: 0,
        rejectedCount: 0,
        skippedCount: 0,
        eligibleWorkAreasAnyOf: [],
        _eligibleWorkAreasSet: new Set(),
        _rejectReasons: new Map(),
        topRejectReasons: [],
      })),
      item
    );

    incrementCompositeCounters(
      ensureCounterEntry(bySection, sectionKey, () => ({
        sectionKey,
        triggeredCount: 0,
        eligibleCount: 0,
        rejectedCount: 0,
        skippedCount: 0,
        eligibleWorkAreasAnyOf: [],
        _eligibleWorkAreasSet: new Set(),
        _rejectReasons: new Map(),
        topRejectReasons: [],
      })),
      item
    );

    incrementCompositeCounters(
      ensureCounterEntry(byServiceSection, `${serviceId}__${sectionKey}__${compositeTaskKey}`, () => ({
        serviceId,
        sectionKey,
        compositeTaskKey,
        triggeredCount: 0,
        eligibleCount: 0,
        rejectedCount: 0,
        skippedCount: 0,
        eligibleWorkAreasAnyOf: [],
        _eligibleWorkAreasSet: new Set(),
        _rejectReasons: new Map(),
        topRejectReasons: [],
      })),
      item
    );
  }

  return {
    byService: Array.from(byService.values())
      .map(finalizeCompositeHotspotEntry)
      .sort(sortByTriggeredCountThenKeys(["serviceId"])),
    bySection: Array.from(bySection.values())
      .map(finalizeCompositeHotspotEntry)
      .sort(sortByTriggeredCountThenKeys(["sectionKey"])),
    byServiceSection: Array.from(byServiceSection.values())
      .map(finalizeCompositeHotspotEntry)
      .sort(
      sortByTriggeredCountThenKeys(["serviceId", "sectionKey", "compositeTaskKey"])
    ),
  };
}

function isMissingDataReject(item) {
  return Boolean(item?.wouldReject) && String(item?.reasonCode || "").includes("MISSING");
}

function incrementCompositeCounters(entry, item) {
  entry.triggeredCount += 1;
  applyObservationOutcome(entry, item);

  mergeEligibleWorkAreas(entry, item?.eligibleWorkAreasAnyOf);
  addRejectReason(entry, item);
}

function applyObservationOutcome(entry, item) {
  if (item?.triggered) {
    if (item?.wouldReject) {
      entry.rejectedCount += 1;
    } else {
      entry.eligibleCount += 1;
    }
    return;
  }

  entry.skippedCount += 1;
}

function getOrCreateGroup(map, key, factory) {
  if (!map.has(key)) {
    map.set(key, factory());
  }

  return map.get(key);
}

function ensureCounterEntry(map, key, factory) {
  return getOrCreateGroup(map, key, factory);
}

function mergeEligibleWorkAreas(entry, eligibleWorkAreasAnyOf) {
  const items = Array.isArray(eligibleWorkAreasAnyOf) ? eligibleWorkAreasAnyOf : [];
  for (const item of items) {
    const value = normalizeDisplayValue(item);
    if (!value || entry._eligibleWorkAreasSet.has(value)) continue;
    entry._eligibleWorkAreasSet.add(value);
    entry.eligibleWorkAreasAnyOf.push(value);
  }
}

function addRejectReason(entry, item) {
  if (!item?.wouldReject) return;

  const reason = pickObservationReason(item);
  if (!reason) return;

  const current = entry._rejectReasons.get(reason) || 0;
  entry._rejectReasons.set(reason, current + 1);
}

function pickObservationReason(item) {
  return normalizeDisplayValue(
    item?.rejectReasonCode ||
    item?.rejectReason ||
    item?.reasonCode ||
    item?.reason
  );
}

function finalizeCompositeHotspotEntry(entry) {
  const topRejectReasons = Array.from(entry?._rejectReasons?.entries?.() || [])
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      const countDiff = Number(b?.count || 0) - Number(a?.count || 0);
      if (countDiff !== 0) return countDiff;
      return String(a?.reason || "").localeCompare(String(b?.reason || ""));
    });

  return {
    serviceId: entry?.serviceId,
    sectionKey: entry?.sectionKey,
    compositeTaskKey: entry?.compositeTaskKey,
    triggeredCount: Number(entry?.triggeredCount || 0),
    eligibleCount: Number(entry?.eligibleCount || 0),
    rejectedCount: Number(entry?.rejectedCount || 0),
    skippedCount: Number(entry?.skippedCount || 0),
    eligibleWorkAreasAnyOf: Array.isArray(entry?.eligibleWorkAreasAnyOf)
      ? [...entry.eligibleWorkAreasAnyOf]
      : [],
    topRejectReasons,
  };
}

function normalizeDisplayValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function sortByKey(key) {
  return (a, b) => String(a?.[key] || "").localeCompare(String(b?.[key] || ""));
}

function sortByTriggeredCountThenKeys(keys = []) {
  return (a, b) => {
    const countDiff = Number(b?.triggeredCount || 0) - Number(a?.triggeredCount || 0);
    if (countDiff !== 0) return countDiff;

    for (const key of keys) {
      const diff = String(a?.[key] || "").localeCompare(String(b?.[key] || ""));
      if (diff !== 0) return diff;
    }

    return 0;
  };
}

module.exports = {
  aggregateShadowObservations,
};
