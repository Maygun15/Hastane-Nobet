"use strict";

const fs = require("fs");
const path = require("path");

const {
  listShadowRuleCodes,
  getRuleActivationStrategy,
  COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW_CODE,
} = require("../services/scheduler/candidateBuilder");
const {
  collectShadowObservations,
  aggregateShadowObservations,
} = require("../services/scheduler/audit");

const DEFAULT_RULE_CODES = Object.freeze(listShadowRuleCodes());

function main() {
  const input = loadAuditInput(process.argv[2]);
  const report = buildShadowAuditReport(input);
  printReport(report);
}

function loadAuditInput(fileArg) {
  if (!fileArg) {
    return buildMockAuditInput();
  }

  const resolvedPath = path.resolve(process.cwd(), fileArg);
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);

  return {
    staff: Array.isArray(parsed?.staff) ? parsed.staff : [],
    assignments: Array.isArray(parsed?.assignments) ? parsed.assignments : [],
    date: parsed?.date || null,
    shift: parsed?.shift && typeof parsed.shift === "object" ? parsed.shift : null,
    serviceId: parsed?.serviceId ?? parsed?.shift?.serviceId ?? null,
    section: parsed?.section ?? parsed?.shift?.section ?? parsed?.shift?.area ?? null,
    ruleCodes: Array.isArray(parsed?.ruleCodes) && parsed.ruleCodes.length
      ? parsed.ruleCodes
      : DEFAULT_RULE_CODES,
  };
}

function buildMockAuditInput() {
  return {
    staff: [
      { id: "p1", name: "Ayse", role: "nurse", area: "ER" },
      { id: "p2", name: "Fatma", title: "assistant", areas: ["ICU"] },
      { id: "p3", name: "Zeynep", role: "nurse" },
      { id: "p4", name: "Elif", areas: ["ER"] },
    ],
    assignments: [
      { personId: "p1", assignmentDate: "2026-03-14", shiftId: "D" },
      { staffId: "p2", date: "2026-03-13", shiftType: "N" },
    ],
    date: "2026-03-14",
    shift: {
      id: "D",
      code: "D",
      requiredRole: "nurse",
      section: "ER",
      serviceId: "svc-er",
    },
    serviceId: "svc-er",
    section: "ER",
    ruleCodes: DEFAULT_RULE_CODES,
  };
}

function buildShadowAuditReport({
  staff = [],
  assignments = [],
  date = null,
  shift = null,
  serviceId = null,
  section = null,
  ruleCodes = DEFAULT_RULE_CODES,
} = {}) {
  const safeStaff = Array.isArray(staff) ? staff : [];
  const safeAssignments = Array.isArray(assignments) ? assignments : [];
  const safeRuleCodes = Array.isArray(ruleCodes) && ruleCodes.length ? ruleCodes : DEFAULT_RULE_CODES;
  const day = date ? { date } : null;

  const observations = collectShadowObservations({
    staff: safeStaff,
    day,
    shift,
    section,
    serviceId,
    schedulerContext: { assignments: safeAssignments },
    assignmentState: { assignments: safeAssignments },
    ruleCodes: safeRuleCodes,
    options: { enableCompositeTaskPlaceShadow: true },
  });
  const aggregate = aggregateShadowObservations(observations);

  const personSummaries = aggregate.personSummary.map((summary) => {
    const person = safeStaff.find((item) => normalizePersonId(item) === summary.personId) || null;
    const personObservations = observations.filter((item) => item.personId === summary.personId);
    return {
      personId: summary.personId,
      personName: person?.name || null,
      triggeredRules: summary.triggeredRules,
      wouldReject: summary.wouldReject,
      messages: personObservations
        .filter((item) => item.triggered)
        .map((item) => `${item.ruleCode}: ${item.message}`),
      observations: personObservations,
    };
  });

  const summaryRuleCodes = Array.from(
    new Set(safeRuleCodes.concat(observations.map((item) => item.ruleCode).filter(Boolean)))
  );
  const ruleSummary = summaryRuleCodes.map((ruleCode) => {
    const aggregateEntry = aggregate.ruleSummary.find((item) => item.ruleCode === ruleCode);
    return {
      ruleCode,
      triggeredCount: aggregateEntry?.triggeredCount || 0,
      wouldRejectCount: aggregateEntry?.wouldRejectCount || 0,
      eligibleCount: aggregateEntry?.eligibleCount || 0,
      rejectedCount: aggregateEntry?.rejectedCount || 0,
      skippedCount: aggregateEntry?.skippedCount || 0,
      missingDataRejectCount: aggregateEntry?.missingDataRejectCount || 0,
      activationStrategy:
        ruleCode === COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW_CODE
          ? null
          : getRuleActivationStrategy(ruleCode),
    };
  });

  return {
    context: {
      date,
      shiftCode: shift?.code || shift?.id || null,
      serviceId: serviceId || shift?.serviceId || null,
      section: section || shift?.section || shift?.area || null,
    },
    compositeTaskPlaceSummary: aggregate.compositeTaskPlaceSummary,
    compositeHotspotSummary: aggregate.compositeHotspotSummary,
    compositePolicySimulation: buildCompositePolicySimulation(observations),
    ruleSummary,
    personSummaries,
  };
}

function buildCompositePolicySimulation(observations = []) {
  const compositeObservations = Array.isArray(observations)
    ? observations.filter((item) => item?.ruleCode === COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW_CODE)
    : [];
  const rejectedObservations = compositeObservations.filter((item) => item?.wouldReject === true);
  const slotGroups = new Map();

  for (const item of compositeObservations) {
    const slotKey = [
      item?.date || "UNKNOWN_DATE",
      item?.shiftCode || "UNKNOWN_SHIFT",
      item?.serviceId || "UNKNOWN_SERVICE",
      item?.section || "UNKNOWN_SECTION",
      item?.targetLabel || "UNKNOWN_COMPOSITE",
    ].join("|");

    if (!slotGroups.has(slotKey)) {
      slotGroups.set(slotKey, {
        totalCandidates: 0,
        rejectedCandidates: 0,
      });
    }

    const slot = slotGroups.get(slotKey);
    slot.totalCandidates += 1;
    if (item?.wouldReject === true) {
      slot.rejectedCandidates += 1;
    }
  }

  let assignmentsPotentiallyImpacted = 0;
  let fallbackPotentiallyRequired = 0;

  for (const slot of slotGroups.values()) {
    if (slot.rejectedCandidates > 0) {
      assignmentsPotentiallyImpacted += 1;
    }

    if (slot.totalCandidates > 0 && slot.rejectedCandidates === slot.totalCandidates) {
      fallbackPotentiallyRequired += 1;
    }
  }

  return {
    candidatesRejectedByCompositeRule: rejectedObservations.length,
    assignmentsPotentiallyImpacted,
    fallbackPotentiallyRequired,
  };
}

function printReport(report) {
  console.log("=== Shadow Rule Audit ===");
  console.log("");
  console.log("Context");
  console.log(`date: ${report.context.date || "-"}`);
  console.log(`shiftCode: ${report.context.shiftCode || "-"}`);
  console.log(`serviceId: ${report.context.serviceId || "-"}`);
  console.log(`section: ${report.context.section || "-"}`);
  console.log("");
  console.log("Rule summary");

  for (const item of report.ruleSummary) {
    console.log(item.ruleCode);
    console.log(`triggered: ${item.triggeredCount}`);
    console.log(`wouldReject: ${item.wouldRejectCount}`);
    console.log(`eligible: ${item.eligibleCount}`);
    console.log(`rejected: ${item.rejectedCount}`);
    console.log(`skipped: ${item.skippedCount}`);
    console.log(`missingDataReject: ${item.missingDataRejectCount}`);
    if (item.activationStrategy) {
      console.log(`recommendedActivationStage: ${item.activationStrategy.recommendedActivationStage}`);
      console.log(`recommendedScope: ${item.activationStrategy.recommendedScope}`);
    }
    console.log("");
  }

  console.log("Composite task place summary");
  if (!Array.isArray(report.compositeTaskPlaceSummary) || !report.compositeTaskPlaceSummary.length) {
    console.log("-");
    console.log("");
  } else {
    for (const item of report.compositeTaskPlaceSummary) {
      console.log(item.targetLabel);
      console.log(`triggered: ${item.triggeredCount}`);
      console.log(`eligible: ${item.eligibleCount}`);
      console.log(`wouldReject: ${item.wouldRejectCount}`);
      console.log(`skipped: ${item.skippedCount || 0}`);
      if (Array.isArray(item.eligibleWorkAreasAnyOf) && item.eligibleWorkAreasAnyOf.length) {
        console.log(`eligibleWorkAreasAnyOf: ${item.eligibleWorkAreasAnyOf.join(", ")}`);
      }
      console.log("");
    }
  }

  console.log("Composite hotspot summary by service");
  printCompositeHotspotList(report?.compositeHotspotSummary?.byService, (item) => {
    console.log(`${item.serviceId}`);
    console.log(`triggered: ${item.triggeredCount}`);
    console.log(`eligible: ${item.eligibleCount}`);
    console.log(`rejected: ${item.rejectedCount}`);
    console.log(`skipped: ${item.skippedCount}`);
    printCompositeHotspotContext(item);
  });
  console.log("");

  console.log("Composite hotspot summary by section");
  printCompositeHotspotList(report?.compositeHotspotSummary?.bySection, (item) => {
    console.log(`${item.sectionKey}`);
    console.log(`triggered: ${item.triggeredCount}`);
    console.log(`eligible: ${item.eligibleCount}`);
    console.log(`rejected: ${item.rejectedCount}`);
    console.log(`skipped: ${item.skippedCount}`);
    printCompositeHotspotContext(item);
  });
  console.log("");

  console.log("Composite hotspot summary by service + section + composite task");
  printCompositeHotspotList(report?.compositeHotspotSummary?.byServiceSection, (item) => {
    console.log(`${item.serviceId} | ${item.sectionKey} | ${item.compositeTaskKey}`);
    console.log(`triggered: ${item.triggeredCount}`);
    console.log(`eligible: ${item.eligibleCount}`);
    console.log(`rejected: ${item.rejectedCount}`);
    console.log(`skipped: ${item.skippedCount}`);
    printCompositeHotspotContext(item);
  });
  console.log("");

  console.log("Person details");
  for (const item of report.personSummaries) {
    const triggered = item.triggeredRules.length ? item.triggeredRules.join(", ") : "-";
    console.log(`${item.personId || "-"} -> wouldReject:${String(item.wouldReject)}`);
    console.log(`triggeredRules: ${triggered}`);

    if (item.messages.length) {
      for (const message of item.messages) {
        console.log(`message: ${message}`);
      }
    }

    console.log("");
  }

  console.log("Composite policy simulation");
  console.log("");
  console.log(
    `Candidates rejected by composite rule: ${report?.compositePolicySimulation?.candidatesRejectedByCompositeRule || 0}`
  );
  console.log(
    `Assignments potentially impacted: ${report?.compositePolicySimulation?.assignmentsPotentiallyImpacted || 0}`
  );
  console.log(
    `Fallback potentially required: ${report?.compositePolicySimulation?.fallbackPotentiallyRequired || 0}`
  );
  console.log("");
}

function normalizePersonId(person) {
  const raw = person?.id ?? person?._id ?? person?.personId ?? null;
  if (raw == null) return null;
  const normalized = String(raw).trim();
  return normalized || null;
}

function printCompositeHotspotList(items, printer) {
  if (!Array.isArray(items) || !items.length) {
    console.log("-");
    return;
  }

  for (const item of items) {
    printer(item);
    console.log("");
  }
}

function printCompositeHotspotContext(item) {
  const eligibleWorkAreasAnyOf = Array.isArray(item?.eligibleWorkAreasAnyOf)
    ? item.eligibleWorkAreasAnyOf.filter(Boolean)
    : [];
  const topRejectReasons = Array.isArray(item?.topRejectReasons)
    ? item.topRejectReasons.filter((reason) => reason && reason.reason)
    : [];

  if (eligibleWorkAreasAnyOf.length) {
    console.log(`eligibleWorkAreasAnyOf: ${eligibleWorkAreasAnyOf.join(", ")}`);
  }

  if (topRejectReasons.length) {
    const summary = topRejectReasons.map((reason) => `${reason.reason}(${reason.count})`).join(", ");
    console.log(`topRejectReasons: ${summary}`);
  }
}

main();
