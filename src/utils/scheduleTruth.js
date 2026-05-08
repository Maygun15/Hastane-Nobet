import { getGeneratedSchedule, getMonthlySchedule, getAssignmentsForMonth } from "../api/apiAdapter.js";
import { extractAssignmentsFromSchedule } from "./scheduleAdapter.js";
import { LS } from "./storage.js";

const pad2 = (n) => String(n).padStart(2, "0");
const canonName = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("tr-TR");

function uniqueDefs(defs = []) {
  const out = [];
  const seen = new Set();
  for (const def of Array.isArray(defs) ? defs : []) {
    if (!def || typeof def !== "object") continue;
    const key = String(
      def.id ??
      def.rowId ??
      def._id ??
      `${def.label || ""}|${def.shiftCode || def.code || ""}`
    ).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(def);
  }
  return out;
}

// shiftCode is portable across all sources; rowId is source-specific.
// Excluding roleLabel prevents case/format differences from creating spurious duplicates.
function assignmentDedupeKey(item = {}) {
  const date = String(item.date || item.day || "").slice(0, 10);
  const personId = String(item.personId || item.pid || item.staffId || "").trim();
  const personName = canonName(item.personName || item.fullName || item.name || "");
  const shiftCode = String(item.shiftCode || item.shift || item.code || "").trim().toUpperCase();
  const rowId = String(item.rowId || item.shiftId || "").trim();
  return `${date}|${personId || personName}|${shiftCode || rowId}`;
}

function dedupeAssignments(assignments = []) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(assignments) ? assignments : []) {
    if (!item || typeof item !== "object") continue;
    const key = assignmentDedupeKey(item);
    const date = String(item.date || item.day || "").slice(0, 10);
    if (!date || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function slotKey(item = {}) {
  return assignmentDedupeKey(item);
}

function mergeAssignments(base = [], override = []) {
  const merged = new Map();
  for (const item of Array.isArray(base) ? base : []) {
    if (!item || typeof item !== "object") continue;
    merged.set(slotKey(item), item);
  }
  for (const item of Array.isArray(override) ? override : []) {
    if (!item || typeof item !== "object") continue;
    merged.set(slotKey(item), item);
  }
  return dedupeAssignments(Array.from(merged.values()));
}

function buildTruthSnapshot(scheduleLike, year, month, options = {}) {
  const data = scheduleLike?.data || scheduleLike || {};
  const defs = uniqueDefs(data?.defs || data?.rows || []);
  const assignments = dedupeAssignments(
    extractAssignmentsFromSchedule(data, year, month, options)
  );
  return { defs, assignments };
}

function buildPersonIndex(people = []) {
  const map = new Map();
  for (const person of Array.isArray(people) ? people : []) {
    if (!person || typeof person !== "object") continue;
    const name = person.fullName || person.name || person.displayName || "";
    const id = String(person.id || person.personId || person.pid || person.staffId || "").trim();
    const canon = canonName(name);
    if (!canon) continue;
    map.set(canon, { id, name: name || canon });
  }
  return map;
}

function toLocalRowDefs(rows = []) {
  return uniqueDefs(
    (Array.isArray(rows) ? rows : []).map((row, idx) => {
      const label = String(row?.label || row?.GOREV || row?.["GÖREV"] || "").trim();
      const shiftCode = String(row?.vardiya || row?.shiftCode || row?.code || "").trim();
      const id = String(row?.id || row?.rowId || `${label}|${shiftCode}|${idx + 1}`).trim();
      return label || shiftCode ? { id, rowId: id, label, shiftCode } : null;
    }).filter(Boolean)
  );
}

function extractLocalAssignmentsFromRows(rows, year, month, options = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const hoursForShift =
    typeof options?.hoursForShift === "function"
      ? options.hoursForShift
      : typeof options?.resolveHours === "function"
        ? options.resolveHours
        : null;
  const peopleIndex = buildPersonIndex(options?.people || []);
  const out = [];

  rows.forEach((row, idx) => {
    if (!row || typeof row !== "object") return;
    const label = String(row?.label || row?.GOREV || row?.["GÖREV"] || "").trim();
    const shiftCode = String(row?.vardiya || row?.shiftCode || row?.code || "").trim();
    const rowId = String(row?.id || row?.rowId || `${label}|${shiftCode}|${idx + 1}`).trim();
    const hours = hoursForShift ? Number(hoursForShift(shiftCode, label) || 0) : Number(row?.hours || 0);

    for (const [key, rawValue] of Object.entries(row)) {
      const match = String(key).match(/^(\d{1,2})(?:\s|$)/);
      if (!match) continue;
      const day = Number(match[1]);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      const names = Array.isArray(rawValue) ? rawValue : [rawValue];
      names
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .forEach((personName) => {
          const canon = canonName(personName);
          const person = peopleIndex.get(canon);
          const date = `${year}-${pad2(month)}-${pad2(day)}`;
          out.push({
            day: date,
            date,
            rowId,
            shiftId: rowId,
            personId: person?.id || "",
            personName: person?.name || personName,
            shiftCode,
            roleLabel: label || rowId,
            hours,
            source: "scheduleRowsV2",
          });
        });
    }
  });

  return dedupeAssignments(out);
}

function extractLocalAssignmentsFromGeneratedFlat(flat, year, month) {
  if (!flat || typeof flat !== "object") return [];
  const ym = `${year}-${pad2(month)}`;
  const out = [];

  for (const bucket of Object.values(flat)) {
    const items = bucket?.[ym];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const date = String(item.date || item.day || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      out.push({
        ...item,
        date,
        day: date,
        rowId: String(item.rowId || item.shiftId || "").trim(),
        shiftId: String(item.shiftId || item.rowId || item.shiftCode || item.shift || "").trim(),
        personId: String(item.personId || item.pid || item.staffId || "").trim(),
        personName: item.personName || item.fullName || item.name || "",
        shiftCode: String(item.shiftCode || item.shift || item.code || "").trim(),
        roleLabel: String(item.roleLabel || item.rowLabel || item.label || item.area || "").trim(),
        source: "generatedRosterFlat",
      });
    }
  }

  return dedupeAssignments(out);
}

function readLocalScheduleTruth(year, month, options = {}) {
  const rowsPayload = LS.get("scheduleRowsV2", null);
  const rows =
    Array.isArray(rowsPayload)
      ? rowsPayload
      : Array.isArray(rowsPayload?.rows)
        ? rowsPayload.rows
        : [];
  const payloadYear = Number(rowsPayload?.year || 0);
  const payloadMonth = Number(rowsPayload?.month || 0);
  const rowsMatchMonth =
    !payloadYear ||
    !payloadMonth ||
    (payloadYear === Number(year) && payloadMonth === Number(month));

  const localAssignments = rowsMatchMonth
    ? extractLocalAssignmentsFromRows(rows, year, month, options)
    : [];
  const localDefs = rowsMatchMonth ? toLocalRowDefs(rows) : [];

  const generatedFlat = LS.get("generatedRosterFlat", null);
  const flatAssignmentsRaw = extractLocalAssignmentsFromGeneratedFlat(generatedFlat, year, month);
  // Skip draft items that have already been evicted (cleared) by the save flow.
  // Items marked _draft:true are AI-generated previews; they're valid fallback but not authoritative.
  const flatAssignments = flatAssignmentsRaw.filter((a) => !a._evicted);

  return {
    defs: uniqueDefs([...localDefs]),
    assignments: dedupeAssignments([...localAssignments, ...flatAssignments]),
    _source: "local",
  };
}

export async function fetchScheduleTruth({
  sectionId = "calisma-cizelgesi",
  serviceId = "",
  role = "",
  year,
  month,
  options = {},
} = {}) {
  const preferScheduleReadModel = options?.preferScheduleReadModel === true;

  // 1) Assignment koleksiyonu — SSOT okuma ucu
  if (!preferScheduleReadModel) {
    try {
      const canonicalAssignments = await getAssignmentsForMonth({ sectionId, serviceId, role, year, month });
      if (Array.isArray(canonicalAssignments) && canonicalAssignments.length > 0) {
        return {
          source: "assignments",
          serviceId,
          role,
          defs: [],
          assignments: dedupeAssignments(canonicalAssignments),
          schedule: null,
        };
      }
    } catch {
      // Assignment endpoint yoksa veya hata varsa eski yoldan devam et
    }
  }

  // 2) Fallback: MonthlySchedule + GeneratedSchedule + localStorage
  let monthly = null;
  let generated = null;
  try {
    monthly = await getMonthlySchedule({ sectionId, serviceId, role, year, month });
  } catch (err) {
    if (err?.status !== 404) throw err;
  }
  try {
    generated = await getGeneratedSchedule({ sectionId, serviceId, role, year, month });
  } catch (err) {
    if (err?.status !== 404) throw err;
  }

  const monthlyTruth = monthly ? buildTruthSnapshot(monthly, year, month, options) : { defs: [], assignments: [] };
  const generatedTruth = generated ? buildTruthSnapshot(generated, year, month, options) : { defs: [], assignments: [] };
  const localTruth = readLocalScheduleTruth(year, month, options);

  if (preferScheduleReadModel) {
    const monthlyUsable = monthlyTruth.assignments.length > 0 || monthlyTruth.defs.length > 0;
    if (monthlyUsable) {
      return {
        source: "monthly",
        serviceId,
        role,
        defs: uniqueDefs(monthlyTruth.defs || []),
        assignments: dedupeAssignments(monthlyTruth.assignments || []),
        schedule: monthly,
      };
    }

    const generatedUsable = generatedTruth.assignments.length > 0 || generatedTruth.defs.length > 0;
    if (generatedUsable) {
      return {
        source: "generated",
        serviceId,
        role,
        defs: uniqueDefs(generatedTruth.defs || []),
        assignments: dedupeAssignments(generatedTruth.assignments || []),
        schedule: generated,
      };
    }

    return {
      source: localTruth.assignments.length || localTruth.defs.length ? "local" : "empty",
      serviceId,
      role,
      defs: uniqueDefs(localTruth.defs || []),
      assignments: dedupeAssignments(localTruth.assignments || []),
      schedule: null,
    };
  }

  const mergedAssignments = mergeAssignments(
    mergeAssignments(localTruth.assignments, generatedTruth.assignments),
    monthlyTruth.assignments
  );
  const mergedDefs = uniqueDefs([
    ...(localTruth.defs || []),
    ...(generatedTruth.defs || []),
    ...(monthlyTruth.defs || []),
  ]);

  return {
    source:
      monthlyTruth.assignments.length
        ? "monthly+generated"
        : (
            generatedTruth.assignments.length || generatedTruth.defs.length
              ? "generated"
              : (localTruth.assignments.length || localTruth.defs.length ? "local" : "empty")
          ),
    serviceId,
    role,
    defs: mergedDefs,
    assignments: mergedAssignments,
    schedule: monthly || generated,
  };
}

export async function fetchMergedScheduleTruth({
  sectionId = "calisma-cizelgesi",
  serviceId = "",
  roles = ["Nurse", "Doctor"],
  year,
  month,
  options = {},
} = {}) {
  const mergedDefs = [];
  const mergedAssignments = [];
  const snapshots = [];
  for (const role of Array.isArray(roles) ? roles : []) {
    const snapshot = await fetchScheduleTruth({
      sectionId,
      serviceId,
      role: String(role || ""),
      year,
      month,
      options,
    });
    snapshots.push(snapshot);
    mergedDefs.push(...(snapshot.defs || []));
    mergedAssignments.push(...(snapshot.assignments || []));
  }
  return {
    defs: uniqueDefs(mergedDefs),
    assignments: dedupeAssignments(mergedAssignments),
    snapshots,
  };
}
