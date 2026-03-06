import { LS } from "./storage.js";

const pad2 = (n) => String(n).padStart(2, "0");
const canonName = (s = "") =>
  s
    .toString()
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");

/* ── 1) generatedRosterFlat ── */
function readGeneratedAssignments(year, month) {
  const ym = `${year}-${pad2(month)}`;
  const payload = LS.get("generatedRosterFlat", null);
  if (!payload || typeof payload !== "object") return [];

  const items = [];
  Object.values(payload).forEach((bucket) => {
    if (!bucket || typeof bucket !== "object") return;
    const monthItems = bucket?.[ym];
    if (Array.isArray(monthItems)) items.push(...monthItems);
  });
  return items;
}

/* ── 2) schedule::YYYY-MM / monthlySchedule::YYYY-MM (namedAssignments) ── */
function readNamedAssignments(year, month, day, targetPid, targetCanon) {
  const ym = `${year}-${pad2(month)}`;
  const keys = [`schedule::${ym}`, `monthlySchedule::${ym}`];
  for (const key of keys) {
    const data = LS.get(key, null);
    if (!data) continue;
    const named = data?.roster?.namedAssignments || data?.namedAssignments || {};
    const daySlot = named[day] || named[String(day)] || {};
    for (const [rowId, names] of Object.entries(daySlot)) {
      if (!Array.isArray(names)) continue;
      const hit = names.find((n) => {
        const c = canonName(n);
        return (targetCanon && c === targetCanon);
      });
      if (hit) return { rowId, name: hit };
    }
  }
  return null;
}

/* ── 3) scheduleRowsV2 ([{ label, "01 (Pzt)": "İSİM", … }]) ── */
function readScheduleRowsV2(year, month, day, targetCanon) {
  const rows = LS.get("scheduleRowsV2", null);
  if (!Array.isArray(rows)) return null;
  const colPrefix = pad2(day);
  for (const row of rows) {
    for (const [col, val] of Object.entries(row)) {
      if (
        col.startsWith(colPrefix) &&
        typeof val === "string" &&
        canonName(val) === targetCanon
      ) {
        return { label: row.label || row.GOREV || row["GÖREV"] || "", col };
      }
    }
  }
  return null;
}

/* ── Ana kontrol ── */
export function checkLeaveShiftConflict({ personId, personName, year, month, day }) {
  const targetPid = String(personId || "").trim();
  const targetCanon = canonName(personName);
  const targetDate = `${year}-${pad2(month)}-${pad2(day)}`;

  // 1) generatedRosterFlat
  const flatHits = readGeneratedAssignments(year, month).filter((item) => {
    if (!item) return false;
    const sameDay =
      Number(item.day) === Number(day) ||
      String(item.date || "").slice(0, 10) === targetDate;
    if (!sameDay) return false;

    const itemPid = String(item.personId || "").trim();
    const itemCanon = canonName(item.personName || item.name || "");
    if (targetPid && itemPid && itemPid === targetPid) return true;
    if (targetCanon && itemCanon && itemCanon === targetCanon) return true;
    return false;
  });

  if (flatHits.length) {
    const labels = flatHits
      .map((a) => a.shiftCode || a.roleLabel || a.rowId || "vardiya")
      .filter(Boolean)
      .join(", ");
    return {
      hasConflict: true,
      source: "generatedRosterFlat",
      assignments: flatHits,
      message: `${personName || "Personel"} — ${targetDate} tarihinde vardiyalı (${labels}).`,
    };
  }

  // 2) namedAssignments
  const namedHit = readNamedAssignments(year, month, day, targetPid, targetCanon);
  if (namedHit) {
    return {
      hasConflict: true,
      source: "namedAssignments",
      assignments: [namedHit],
      message: `${personName || "Personel"} — ${targetDate} tarihinde vardiyalı (${namedHit.rowId}).`,
    };
  }

  // 3) scheduleRowsV2
  const rowsHit = readScheduleRowsV2(year, month, day, targetCanon);
  if (rowsHit) {
    return {
      hasConflict: true,
      source: "scheduleRowsV2",
      assignments: [rowsHit],
      message: `${personName || "Personel"} — ${targetDate} tarihinde vardiyalı (${rowsHit.label || rowsHit.col}).`,
    };
  }

  return { hasConflict: false, assignments: [] };
}

export function scanMonthConflicts({ people, year, month }) {
  const out = [];
  (people || []).forEach((p) => {
    for (let day = 1; day <= 31; day++) {
      const result = checkLeaveShiftConflict({
        personId: p?.id,
        personName: p?.fullName || p?.name || "",
        year,
        month,
        day,
      });
      if (result.hasConflict) out.push(result);
    }
  });
  return out;
}
