import { unassignSchedule } from "../api/apiAdapter.js";
import { LS } from "../utils/storage.js";
import { getPersonDayShift, getScheduleModelSync } from "../store/monthlyScheduleModel.js";

const pad2 = (n) => String(n).padStart(2, "0");
const canon = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();

function samePerson(item, personId, personNameCanon) {
  const itemPid = String(item?.personId || "").trim();
  if (personId && itemPid) return itemPid === personId;
  const itemNameCanon = canon(item?.personName || item?.name || "");
  return !!(personNameCanon && itemNameCanon && itemNameCanon === personNameCanon);
}

function removeFromNamedAssignments(named, day, personNameCanon) {
  if (!named || typeof named !== "object" || !personNameCanon) {
    return { next: named, changed: false };
  }

  const dayKey = String(day);
  const rows = named?.[dayKey];
  if (!rows || typeof rows !== "object") {
    return { next: named, changed: false };
  }

  let changed = false;
  const nextNamed = { ...named };
  const nextRows = { ...rows };

  for (const [rowId, names] of Object.entries(nextRows)) {
    if (!Array.isArray(names)) continue;
    const filtered = names.filter((nm) => canon(nm) !== personNameCanon);
    if (filtered.length !== names.length) {
      changed = true;
      if (filtered.length) nextRows[rowId] = filtered;
      else delete nextRows[rowId];
    }
  }

  if (!changed) return { next: named, changed: false };
  if (Object.keys(nextRows).length) nextNamed[dayKey] = nextRows;
  else delete nextNamed[dayKey];
  return { next: nextNamed, changed: true };
}

function removeFromScheduleCache({ year, month, day, personId, personName }) {
  const ym = `${year}-${pad2(month)}`;
  const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
  const pid = String(personId || "").trim();
  const pCanon = canon(personName || "");
  const cacheKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (
      key === `schedule::${ym}` ||
      key === `monthlySchedule::${ym}` ||
      key.startsWith(`schedule::${ym}::`) ||
      key.startsWith(`monthlySchedule::${ym}::`)
    ) {
      cacheKeys.push(key);
    }
  }

  for (const key of cacheKeys) {
    const payload = LS.get(key, null);
    if (!payload || typeof payload !== "object") continue;
    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
    let changed = false;

    let nextAssignments = assignments;
    if (assignments.length) {
      const filtered = assignments.filter((a) => {
        const itemDate = String(a?.date || a?.day || "").slice(0, 10);
        if (itemDate !== dateStr) return true;
        return !samePerson(a, pid, pCanon);
      });
      if (filtered.length !== assignments.length) {
        changed = true;
        nextAssignments = filtered;
      }
    }

    let nextData = data;
    const rosterNamed = data?.roster?.namedAssignments;
    const rosterRes = removeFromNamedAssignments(rosterNamed, day, pCanon);
    if (rosterRes.changed) {
      changed = true;
      nextData = {
        ...nextData,
        roster: {
          ...(nextData?.roster || {}),
          namedAssignments: rosterRes.next,
        },
      };
    }

    const namedRes = removeFromNamedAssignments(nextData?.namedAssignments, day, pCanon);
    if (namedRes.changed) {
      changed = true;
      nextData = {
        ...nextData,
        namedAssignments: namedRes.next,
      };
    }

    if (!changed) continue;
    nextData = {
      ...nextData,
      assignments: nextAssignments,
    };

    if (payload?.data && typeof payload.data === "object") {
      LS.set(key, { ...payload, data: nextData });
    } else {
      LS.set(key, nextData);
    }
  }

  // generatedRosterFlat (fallback kaynak)
  const flat = LS.get("generatedRosterFlat", null);
  if (flat && typeof flat === "object") {
    let changed = false;
    const nextFlat = { ...flat };
    for (const [bucketKey, bucket] of Object.entries(nextFlat)) {
      if (!bucket || typeof bucket !== "object") continue;
      const monthItems = Array.isArray(bucket?.[ym]) ? bucket[ym] : null;
      if (!monthItems) continue;
      const filtered = monthItems.filter((a) => {
        const itemDay = Number(a?.day ?? String(a?.date || "").slice(8, 10));
        if (itemDay !== Number(day)) return true;
        return !samePerson(a, pid, pCanon);
      });
      if (filtered.length !== monthItems.length) {
        changed = true;
        nextFlat[bucketKey] = { ...bucket, [ym]: filtered };
      }
    }
    if (changed) LS.set("generatedRosterFlat", nextFlat);
  }

  // scheduleRowsV2 (yalnız isim eşleşmesiyle)
  const rows = LS.get("scheduleRowsV2", null);
  if (Array.isArray(rows) && pCanon) {
    const dayColMatch = new RegExp(`^${pad2(day)}\\s`);
    let changed = false;
    const nextRows = rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      let rowChanged = false;
      const copy = { ...row };
      for (const [col, value] of Object.entries(copy)) {
        if (!dayColMatch.test(String(col))) continue;
        if (canon(value) !== pCanon) continue;
        copy[col] = "";
        rowChanged = true;
      }
      if (rowChanged) changed = true;
      return copy;
    });
    if (changed) LS.set("scheduleRowsV2", nextRows);
  }
}

export function checkLeaveShiftConflict({ personId, personName, year, month, day, people = [] }) {
  const model = getScheduleModelSync({ year, month, people });
  const shift = getPersonDayShift({ model, personId, personName, day });
  if (!shift) return { hasConflict: false, assignments: [] };

  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  return {
    hasConflict: true,
    assignments: [shift],
    message: `${personName || "Personel"} — ${date} tarihinde vardiyalı (${shift.rowLabel || shift.shiftCode || "vardiya"}).`,
  };
}

export function scanMonthConflicts({ people, year, month }) {
  const model = getScheduleModelSync({ year, month, people });
  const out = [];

  for (const person of people || []) {
    for (let day = 1; day <= 31; day += 1) {
      const result = checkLeaveShiftConflict({
        personId: String(person?.id || person?._id || person?.personId || "").trim(),
        personName: person?.fullName || person?.name || "",
        year,
        month,
        day,
        people,
      });
      if (result.hasConflict) out.push(result);
    }
  }

  return out;
}

export async function removeShiftOnDay({
  personId,
  personName,
  year,
  month,
  day,
  people = [],
  sectionId = "calisma-cizelgesi",
}) {
  const pid = String(personId || "").trim();
  if (!pid) return { removed: false, count: 0 };

  const model = getScheduleModelSync({ year, month, people });
  const shift = getPersonDayShift({ model, personId: pid, personName, day });
  if (!shift) return { removed: false, count: 0 };

  const shiftId = String(shift?.shiftId || shift?.shiftCode || shift?.shift || "").trim();
  const shiftCode = String(shift?.shiftCode || shift?.shiftId || shift?.shift || "").trim();
  const roleLabel = String(shift?.rowLabel || shift?.roleLabel || shift?.role || "").trim();
  const date = `${year}-${pad2(month)}-${pad2(day)}`;

  try {
    await unassignSchedule({
      sectionId,
      serviceId: "",
      role: "",
      date,
      shiftId: shiftId || shiftCode || "M",
      shiftCode: shiftCode || shiftId || "M",
      personId: pid,
      personName,
      roleLabel,
    });
  } catch {
    // API başarısız olsa bile local cache'i temizleyip UI tutarlılığını koru.
  }

  removeFromScheduleCache({ year, month, day, personId: pid, personName });
  try {
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("schedule:saved"));
    window.dispatchEvent(new Event("planner:changed"));
  } catch {}

  return { removed: true, count: 1 };
}
