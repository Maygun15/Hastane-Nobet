"use strict";

const fs = require("fs");
const path = require("path");

function main() {
  const input = loadAuditInput(process.argv[2]);
  const report = buildSectionMappingReport(input);
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
    shifts: extractShiftEntries(parsed),
    serviceId: parsed?.serviceId ?? parsed?.shift?.serviceId ?? null,
    section: parsed?.section ?? parsed?.shift?.section ?? parsed?.shift?.area ?? null,
  };
}

function extractShiftEntries(parsed) {
  if (Array.isArray(parsed?.shifts)) {
    return parsed.shifts.filter((item) => item && typeof item === "object");
  }

  if (Array.isArray(parsed?.slots)) {
    return parsed.slots.filter((item) => item && typeof item === "object");
  }

  if (parsed?.shift && typeof parsed.shift === "object") {
    return [parsed.shift];
  }

  return [];
}

function buildMockAuditInput() {
  return {
    staff: [
      { id: "p1", name: "Ayse", areas: ["Cocuk", "Triyaj"] },
      { id: "p2", name: "Fatma", area: "Kirmizi Alan" },
      { id: "p3", name: "Zeynep", section: "Resusitasyon" },
      { id: "p4", name: "Elif", sections: ["Triaj", "ER"] },
      { id: "p5", name: "Merve", meta: { areas: ["Cerrahi mudahale"] } },
      { id: "p6", name: "Gamze", meta: { section: "Sari Alan" } },
    ],
    assignments: [],
    date: "2026-03-14",
    shift: {
      id: "D",
      code: "D",
      section: "Cocuk",
      serviceId: "svc-er",
    },
    shifts: [
      { id: "D", code: "D", section: "Cocuk", serviceId: "svc-er" },
      { id: "E", code: "E", area: "TriAj", serviceId: "svc-er" },
      { id: "N", code: "N", section: "Resusitasyon", serviceId: "svc-er" },
      { id: "M", code: "M", section: "Kirmizi", serviceId: "svc-er" },
    ],
    serviceId: "svc-er",
    section: "Cocuk",
  };
}

function buildSectionMappingReport({
  staff = [],
  assignments = [],
  date = null,
  shift = null,
  shifts = [],
  serviceId = null,
  section = null,
} = {}) {
  const safeStaff = Array.isArray(staff) ? staff.filter(Boolean) : [];
  const shiftEntries = normalizeShiftEntries({ date, shift, shifts, serviceId, section });
  const rawShiftSections = buildRawShiftSections(shiftEntries);
  const rawPersonSections = buildRawPersonSections(safeStaff);
  const normalizedSummary = buildNormalizedSectionSummary(rawShiftSections, rawPersonSections);
  const mismatchSummary = buildMismatchSummary(shiftEntries, safeStaff);
  const suspectedSynonyms = buildSuspectedSynonymCandidates(normalizedSummary);

  return {
    context: {
      date: date || shiftEntries[0]?.date || null,
      shiftCode: shift?.code || shift?.id || shiftEntries[0]?.shiftCode || null,
      serviceId: serviceId || shift?.serviceId || shiftEntries[0]?.serviceId || null,
      section: section || shift?.section || shift?.area || shiftEntries[0]?.rawSection || null,
      shiftCount: shiftEntries.length,
      staffCount: safeStaff.length,
      assignmentCount: Array.isArray(assignments) ? assignments.length : 0,
    },
    rawShiftSections,
    rawPersonSections,
    normalizedSummary,
    mismatchSummary,
    suspectedSynonyms,
  };
}

function normalizeShiftEntries({ date = null, shift = null, shifts = [], serviceId = null, section = null } = {}) {
  const baseEntries = Array.isArray(shifts) && shifts.length
    ? shifts
    : shift && typeof shift === "object"
      ? [shift]
      : [];

  return baseEntries.map((item, index) => {
    const rawSection = extractRawShiftSection(item, section);
    return {
      slotIndex: index,
      date: date || null,
      shiftCode: item?.code || item?.id || item?.name || null,
      serviceId: item?.serviceId ?? serviceId ?? null,
      rawSection,
      normalizedSection: normalizeSectionValue(rawSection),
    };
  });
}

function buildRawShiftSections(shiftEntries) {
  const counts = new Map();

  for (const entry of shiftEntries) {
    incrementCount(counts, entry?.rawSection || "<missing>");
  }

  return mapToSortedList(counts, "rawSection", "count");
}

function buildRawPersonSections(staff) {
  const counts = new Map();

  for (const person of staff) {
    const rawValues = extractPersonRawSectionValues(person);
    if (!rawValues.length) {
      incrementCount(counts, "<missing>");
      continue;
    }

    for (const value of rawValues) {
      incrementCount(counts, value);
    }
  }

  return mapToSortedList(counts, "rawSection", "count");
}

function buildNormalizedSectionSummary(rawShiftSections, rawPersonSections) {
  const groups = new Map();
  const combined = []
    .concat(rawShiftSections.map((item) => ({ rawSection: item.rawSection, count: item.count, source: "shift" })))
    .concat(rawPersonSections.map((item) => ({ rawSection: item.rawSection, count: item.count, source: "person" })));

  for (const item of combined) {
    const rawSection = item.rawSection;
    const normalizedSection = normalizeSectionValue(rawSection === "<missing>" ? null : rawSection) || "<missing>";
    const entry = getOrCreate(groups, normalizedSection, () => ({
      normalizedSection,
      totalCount: 0,
      rawValues: new Map(),
    }));

    entry.totalCount += Number(item.count || 0);
    const rawEntry = getOrCreate(entry.rawValues, rawSection, () => ({
      rawSection,
      count: 0,
      sources: new Set(),
    }));
    rawEntry.count += Number(item.count || 0);
    rawEntry.sources.add(item.source);
  }

  return Array.from(groups.values())
    .map((entry) => ({
      normalizedSection: entry.normalizedSection,
      totalCount: entry.totalCount,
      rawValues: Array.from(entry.rawValues.values())
        .map((rawEntry) => ({
          rawSection: rawEntry.rawSection,
          count: rawEntry.count,
          sources: Array.from(rawEntry.sources).sort(),
        }))
        .sort(sortByCountThenValue("count", "rawSection")),
    }))
    .sort(sortByCountThenValue("totalCount", "normalizedSection"));
}

function buildMismatchSummary(shiftEntries, staff) {
  const hotspots = new Map();

  for (const entry of shiftEntries) {
    if (!entry?.normalizedSection) continue;

    for (const person of staff) {
      const personId = normalizePersonId(person) || "<unknown>";
      const rawPersonSections = extractPersonRawSectionValues(person);
      const normalizedPersonSections = extractPersonNormalizedSections(person);
      if (normalizedPersonSections.includes(entry.normalizedSection)) continue;

      const signature = normalizedPersonSections.length
        ? normalizedPersonSections.join(" | ")
        : "<missing>";
      const key = `${entry.normalizedSection}__${signature}`;
      const hotspot = getOrCreate(hotspots, key, () => ({
        targetSection: entry.normalizedSection,
        targetRawValues: new Set(),
        personSectionSignature: signature,
        personRawExamples: new Set(),
        count: 0,
        personIds: new Set(),
      }));

      hotspot.targetRawValues.add(entry.rawSection || "<missing>");
      hotspot.count += 1;
      hotspot.personIds.add(personId);

      if (rawPersonSections.length) {
        for (const rawValue of rawPersonSections) {
          hotspot.personRawExamples.add(rawValue);
        }
      } else {
        hotspot.personRawExamples.add("<missing>");
      }
    }
  }

  return Array.from(hotspots.values())
    .map((item) => ({
      targetSection: item.targetSection,
      targetRawValues: Array.from(item.targetRawValues).sort(),
      personSectionSignature: item.personSectionSignature,
      personRawExamples: Array.from(item.personRawExamples).sort(),
      count: item.count,
      distinctPersonCount: item.personIds.size,
    }))
    .sort(sortByCountThenValue("count", "targetSection"));
}

function buildSuspectedSynonymCandidates(normalizedSummary) {
  const values = normalizedSummary
    .map((item) => item.normalizedSection)
    .filter((item) => item && item !== "<missing>");
  const candidates = [];
  const seen = new Set();

  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const left = values[i];
      const right = values[j];
      const match = detectSimilarity(left, right);
      if (!match) continue;

      const key = [left, right].sort().join("__");
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        left,
        right,
        similarityReason: match,
      });
    }
  }

  return candidates.sort((a, b) =>
    `${a.left}:${a.right}`.localeCompare(`${b.left}:${b.right}`)
  );
}

function extractRawShiftSection(shift, fallbackSection = null) {
  const value = shift?.section ?? shift?.area ?? shift?.unit ?? fallbackSection ?? null;
  return normalizeRawValue(value);
}

function extractPersonRawSectionValues(person) {
  if (!person || typeof person !== "object") return [];

  const value =
    person?.sections ??
    person?.section ??
    person?.area ??
    person?.areas ??
    person?.meta?.sections ??
    person?.meta?.areas ??
    person?.meta?.section ??
    person?.meta?.area ??
    null;

  return normalizeRawList(value);
}

function extractPersonNormalizedSections(person) {
  return Array.from(new Set(
    extractPersonRawSectionValues(person)
      .map((item) => normalizeSectionValue(item))
      .filter(Boolean)
  ));
}

function normalizeSectionValue(value) {
  if (value == null) return null;

  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”"']/g, "")
    .replace(/[(){}[\],.;:/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c") || null;
}

function normalizeRawList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRawValue(item)).filter(Boolean);
  }

  if (typeof value === "string" && value.includes(",")) {
    return value
      .split(",")
      .map((item) => normalizeRawValue(item))
      .filter(Boolean);
  }

  const one = normalizeRawValue(value);
  return one ? [one] : [];
}

function normalizeRawValue(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizePersonId(person) {
  const value = person?.id ?? person?._id ?? person?.personId ?? null;
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function detectSimilarity(left, right) {
  if (!left || !right || left === right) return null;

  const compactLeft = left.replace(/\s+/g, "");
  const compactRight = right.replace(/\s+/g, "");
  if (compactLeft === compactRight) return "SPACE_VARIATION";

  if (compactLeft.startsWith(compactRight) || compactRight.startsWith(compactLeft)) {
    return "PREFIX_VARIATION";
  }

  const distance = levenshteinDistance(compactLeft, compactRight);
  if (distance <= 2 && Math.min(compactLeft.length, compactRight.length) >= 4) {
    return "SMALL_EDIT_DISTANCE";
  }

  return null;
}

function levenshteinDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function incrementCount(map, key) {
  map.set(key, Number(map.get(key) || 0) + 1);
}

function mapToSortedList(map, keyName, countName) {
  return Array.from(map.entries())
    .map(([key, count]) => ({
      [keyName]: key,
      [countName]: count,
    }))
    .sort(sortByCountThenValue(countName, keyName));
}

function getOrCreate(map, key, factory) {
  if (!map.has(key)) {
    map.set(key, factory());
  }

  return map.get(key);
}

function sortByCountThenValue(countKey, valueKey) {
  return (a, b) => {
    const countDiff = Number(b?.[countKey] || 0) - Number(a?.[countKey] || 0);
    if (countDiff !== 0) return countDiff;
    return String(a?.[valueKey] || "").localeCompare(String(b?.[valueKey] || ""));
  };
}

function printReport(report) {
  console.log("=== Section Mapping Audit ===");
  console.log("");
  console.log("Context");
  console.log(`date: ${report.context.date || "-"}`);
  console.log(`shiftCode: ${report.context.shiftCode || "-"}`);
  console.log(`serviceId: ${report.context.serviceId || "-"}`);
  console.log(`section: ${report.context.section || "-"}`);
  console.log(`shiftCount: ${report.context.shiftCount}`);
  console.log(`staffCount: ${report.context.staffCount}`);
  console.log("");

  console.log("Raw shift sections");
  printCountList(report.rawShiftSections, "rawSection");
  console.log("");

  console.log("Raw person sections");
  printCountList(report.rawPersonSections, "rawSection");
  console.log("");

  console.log("Normalized sections");
  if (!report.normalizedSummary.length) {
    console.log("-");
  }
  for (const item of report.normalizedSummary) {
    console.log(`${item.normalizedSection} -> total:${item.totalCount}`);
    for (const rawValue of item.rawValues) {
      console.log(`  raw: ${rawValue.rawSection} | count:${rawValue.count} | sources:${rawValue.sources.join(",")}`);
    }
  }
  console.log("");

  console.log("Mismatch hotspots");
  if (!report.mismatchSummary.length) {
    console.log("-");
  }
  for (const item of report.mismatchSummary.slice(0, 20)) {
    console.log(`target: ${item.targetSection} | count:${item.count} | persons:${item.distinctPersonCount}`);
    console.log(`  targetRaw: ${item.targetRawValues.join(", ")}`);
    console.log(`  personSide: ${item.personSectionSignature}`);
    console.log(`  rawExamples: ${item.personRawExamples.join(", ")}`);
  }
  console.log("");

  console.log("Suspected synonym candidates");
  if (!report.suspectedSynonyms.length) {
    console.log("-");
  }
  for (const item of report.suspectedSynonyms) {
    console.log(`${item.left} <-> ${item.right} | reason:${item.similarityReason}`);
  }
}

function printCountList(items, valueKey) {
  if (!Array.isArray(items) || !items.length) {
    console.log("-");
    return;
  }

  for (const item of items) {
    console.log(`${item[valueKey]}: ${item.count}`);
  }
}

main();
