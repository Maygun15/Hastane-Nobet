const SCOPE_KEYS = ["sectionId", "serviceId", "role", "year", "month"];

function normalizedScopeValue(key, value) {
  if (key === "year" || key === "month") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return String(value ?? "").trim();
}

export function parseHealthTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getMaxAssignmentUpdatedAt(assignments = []) {
  let latestValue = null;
  let latestTimestamp = null;

  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const candidate =
      assignment?.updatedAt ||
      assignment?.updated_at ||
      assignment?.savedAt ||
      assignment?.createdAt ||
      null;
    const timestamp = parseHealthTimestamp(candidate);
    if (timestamp == null) continue;
    if (latestTimestamp == null || timestamp > latestTimestamp) {
      latestValue = candidate;
      latestTimestamp = timestamp;
    }
  }

  return latestValue;
}

export function collectSourceScheduleIds(assignments = []) {
  const ids = new Set();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const value = assignment?.sourceScheduleId;
    const id = typeof value === "object" && value !== null
      ? value?._id || value?.id
      : value;
    const normalized = String(id ?? "").trim();
    if (normalized) ids.add(normalized);
  }
  return Array.from(ids).sort();
}

export function compareScope(requestedScope = {}, returnedScope = {}) {
  const mismatches = [];
  const unverifiable = [];

  for (const key of SCOPE_KEYS) {
    const requested = normalizedScopeValue(key, requestedScope?.[key]);
    const returnedRaw = returnedScope?.[key];
    if (returnedRaw === undefined || returnedRaw === null) {
      unverifiable.push(key);
      continue;
    }
    const returned = normalizedScopeValue(key, returnedRaw);
    if (requested !== returned) mismatches.push({ key, requested, returned });
  }

  return {
    matches: mismatches.length === 0 && unverifiable.length === 0,
    mismatches,
    unverifiable,
  };
}

export function isTimestampOlder(candidate, reference) {
  const candidateTimestamp = parseHealthTimestamp(candidate);
  const referenceTimestamp = parseHealthTimestamp(reference);
  if (candidateTimestamp == null || referenceTimestamp == null) return false;
  return candidateTimestamp < referenceTimestamp;
}

export function eventScopeMatches(selectedScope = {}, eventScope = null) {
  if (!eventScope || typeof eventScope !== "object") return true;
  const availableKeys = SCOPE_KEYS.filter((key) => {
    const value = eventScope?.[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
  if (!availableKeys.length) return true;
  return availableKeys.every(
    (key) =>
      normalizedScopeValue(key, selectedScope?.[key]) ===
      normalizedScopeValue(key, eventScope?.[key])
  );
}

export function generateProjectionDiagnostics({
  monthly = null,
  generated = null,
  assignments = [],
  assignmentLatestUpdatedAt = null,
  assignmentSourceScheduleIds = [],
  generatedScopeComparison = null,
  errors = {},
} = {}) {
  const diagnostics = [];
  const monthlyId = String(monthly?.id || monthly?._id || "").trim();
  const generatedSourceScheduleId = String(generated?.sourceScheduleId || "").trim();
  const assignmentCount = Array.isArray(assignments) ? assignments.length : 0;

  const add = (code, label, message) => diagnostics.push({ code, label, message });

  if (errors.monthly) {
    add("MONTHLY_UNAVAILABLE", "Data unavailable", "MonthlySchedule data could not be observed for the selected scope.");
  }
  if (errors.generated) {
    add("GENERATED_UNAVAILABLE", "Data unavailable", "GeneratedSchedule data could not be observed for the selected scope.");
  }
  if (errors.assignments) {
    add("ASSIGNMENTS_UNAVAILABLE", "Data unavailable", "Assignment Projection data could not be observed for the selected scope.");
  }

  if (!errors.assignments && monthly && assignmentCount === 0) {
    add(
      "MONTHLY_WITHOUT_ASSIGNMENTS",
      "Check recommended",
      "MonthlySchedule is available, but no Assignment Projection records were observed."
    );
  }
  if (
    !errors.assignments &&
    monthly?.updatedAt &&
    assignmentLatestUpdatedAt &&
    isTimestampOlder(assignmentLatestUpdatedAt, monthly.updatedAt)
  ) {
    add(
      "ASSIGNMENTS_OLDER_THAN_MONTHLY",
      "May be stale",
      "The latest observed Assignment Projection update is older than MonthlySchedule."
    );
  }
  if (!errors.monthly && !monthly && !errors.assignments && assignmentCount > 0) {
    add(
      "ASSIGNMENTS_WITHOUT_MONTHLY",
      "Check recommended",
      "Assignment Projection records were observed, but MonthlySchedule was not observed."
    );
  }
  if (!errors.generated && generated && !errors.monthly && !monthly) {
    add(
      "GENERATED_WITHOUT_MONTHLY",
      "Check recommended",
      "GeneratedSchedule was observed, but MonthlySchedule was not observed."
    );
  }
  if (
    monthlyId &&
    assignmentSourceScheduleIds.some((sourceId) => String(sourceId) !== monthlyId)
  ) {
    add(
      "ASSIGNMENT_SOURCE_MISMATCH",
      "Check recommended",
      "One or more Assignment Projection sourceScheduleId values differ from the observed MonthlySchedule ID."
    );
  }
  if (monthlyId && generatedSourceScheduleId && generatedSourceScheduleId !== monthlyId) {
    add(
      "GENERATED_SOURCE_MISMATCH",
      "Check recommended",
      "GeneratedSchedule sourceScheduleId differs from the observed MonthlySchedule ID."
    );
  }
  if (generated && generatedScopeComparison && !generatedScopeComparison.matches) {
    add(
      "GENERATED_SCOPE_MISMATCH",
      generatedScopeComparison.mismatches.length ? "Check recommended" : "Scope could not be verified",
      generatedScopeComparison.mismatches.length
        ? "The returned GeneratedSchedule scope differs from the requested scope."
        : "The returned GeneratedSchedule scope could not be fully verified."
    );
  }

  return diagnostics;
}
