// src/utils/scheduleAdapter.js
// ============================================================
// İki farklı nöbet formatı arasında çift yönlü dönüşüm.
//
// FORMAT A: "namedAssignments" — DutyRowsEditor tarafından üretilir
//   { [günNumarası]: { [satırId]: [kişiAdı, ...] } }
//   Örn: { "1": { "row-sabah-v1": ["AYŞE YILMAZ", "FATİH DEMİR"] } }
//
// FORMAT B: "assignments[]" — AI scheduler / PlanTab tarafından üretilir
//   [{ day, personId, personName, shiftCode, roleLabel, hours, pinned? }]
//   Örn: [{ day: "2026-05-01", personId: "p1", personName: "AYŞE YILMAZ",
//           shiftCode: "V1", roleLabel: "SABAH", hours: 8 }]
//
// Bu çevirici sayesinde hangi motordan çıkarsa çıksın, tüm bileşenler
// (MonthlyHoursSheet, OvertimeTab, vb.) veriyi okuyabilir.
// ============================================================

const stripDiacritics = (str = "") =>
  str
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const canonName = (s = "") =>
  stripDiacritics(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("tr-TR");

/**
 * namedAssignments → assignments[] dönüşümü
 *
 * DutyRowsEditor'ün ürettiği namedAssignments nesnesini,
 * MonthlyHoursSheet ve OvertimeTab'ın okuyabileceği
 * flat assignments dizisine çevirir.
 * Çok kişili satırlar (sabah hemşiresi x3 gibi) tam olarak aktarılır.
 */
export function namedToAssignments(namedAssignments, defs = [], year, month1, options = {}) {
  // hoursForShift veya resolveHours — her iki ismi de kabul et
  const { people = [], hoursForShift, resolveHours } = options;
  const resolveHoursFn = (typeof hoursForShift === "function" ? hoursForShift : null)
    ?? (typeof resolveHours === "function" ? resolveHours : null);
  if (!namedAssignments || typeof namedAssignments !== "object") return [];

  // Personel haritası: canonName → { id, name }
  const personIndex = new Map();
  (Array.isArray(people) ? people : []).forEach((p) => {
    if (!p) return;
    const name = p.fullName || p.name || p.displayName || "";
    const canon = canonName(name);
    const id = String(p.id || p.personId || "").trim();
    if (canon && id) personIndex.set(canon, { id, name });
  });

  // Satır tanım haritası: rowId → def
  const defIndex = new Map();
  (Array.isArray(defs) ? defs : []).forEach((d) => {
    if (!d) return;
    const id = String(d.id || d.rowId || "").trim();
    if (id) defIndex.set(id, d);
  });

  const assignments = [];
  const pad2 = (n) => String(n).padStart(2, "0");

  for (const [dayKey, byRow] of Object.entries(namedAssignments)) {
    if (!byRow || typeof byRow !== "object") continue;
    const dayNum = Number(dayKey);
    if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) continue;

    const dateStr = `${year}-${pad2(month1)}-${pad2(dayNum)}`;

    for (const [rowId, namesList] of Object.entries(byRow)) {
      if (!Array.isArray(namesList)) continue;
      // Çok kişili satırlarda TÜM isimler aktarılır (slice(0,1) kaldırıldı)
      const safeNames = namesList.filter((item) => typeof item === "string" && item.trim());
      const def = defIndex.get(rowId);
      const shiftCode = def?.shiftCode || "";
      const roleLabel = def?.label || rowId;
      const shiftId = String(def?.id || def?.rowId || rowId || "").trim();

      let hours = 0;
      if (resolveHoursFn) {
        hours = resolveHoursFn(shiftCode, roleLabel) || 0;
      } else if (def?.hours != null) {
        hours = Number(def.hours) || 0;
      }

      for (const personName of safeNames) {
        const trimmed = personName.trim();
        if (!trimmed) continue;

        const canon = canonName(trimmed);
        const match = personIndex.get(canon);
        const personId = match?.id || "";
        const displayName = match?.name || trimmed;

        assignments.push({
          day: dateStr,
          date: dateStr,
          rowId: String(rowId || "").trim(),
          shiftId,
          personId,
          personName: displayName,
          shiftCode,
          roleLabel,
          hours,
        });
      }
    }
  }

  return assignments;
}

/**
 * assignments[] → namedAssignments dönüşümü
 *
 * AI scheduler / PlanTab'ın ürettiği flat assignments dizisini,
 * DutyRowsEditor'ün okuyabileceği namedAssignments nesnesine çevirir.
 * Çok kişili satırlarda tüm kişiler diziye eklenir.
 */
export function assignmentsToNamed(assignments, defs = []) {
  if (!Array.isArray(assignments)) return {};

  // label+shiftCode → rowId
  const rowIdIndex = new Map();
  (Array.isArray(defs) ? defs : []).forEach((d) => {
    if (!d) return;
    const key = `${canonName(d.label || "")}|${(d.shiftCode || "").toUpperCase().trim()}`;
    rowIdIndex.set(key, String(d.id || d.rowId || "").trim());
  });

  const named = {};

  for (const a of assignments) {
    if (!a) continue;
    const dateStr = String(a.day || a.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    const dayNum = Number(dateStr.slice(8, 10));
    const dayKey = String(dayNum);

    const roleLabel = a.roleLabel || a.label || a.area || "";
    const shiftCode = (a.shiftCode || a.shift || "").toUpperCase().trim();
    const matchKey = `${canonName(roleLabel)}|${shiftCode}`;
    const rowId = rowIdIndex.get(matchKey) || `${roleLabel}-${shiftCode}`.replace(/\s+/g, "-");

    const personName = a.personName || a.fullName || a.name || "";
    if (!personName) continue;

    if (!named[dayKey]) named[dayKey] = {};
    if (!named[dayKey][rowId]) named[dayKey][rowId] = [];

    // Çok kişili satırlar: aynı satırda birden fazla kişi olabilir
    if (!named[dayKey][rowId].includes(personName)) {
      named[dayKey][rowId].push(personName);
    }
  }

  return named;
}

/**
 * Backend'den dönen schedule verisinden assignments[] çıkar.
 * Her iki formatı da destekler:
 *   - data.assignments[] (AI scheduler / PlanTab formatı)
 *   - data.roster.namedAssignments (DutyRowsEditor formatı)
 *
 * data.assignments varsa, defs'ten roleLabel zenginleştirmesi yapılır
 * böylece OvertimeTab ve MonthlyHoursSheet doğru satır etiketini görür.
 */
export function extractAssignmentsFromSchedule(scheduleData, year, month1, options = {}) {
  if (!scheduleData || typeof scheduleData !== "object") return [];

  const defs = Array.isArray(scheduleData.defs)
    ? scheduleData.defs
    : Array.isArray(scheduleData.rows)
      ? scheduleData.rows
      : [];

  // def haritası: shiftId/rowId/shiftCode → def
  const defById = new Map();
  const defByCode = new Map();
  for (const def of defs) {
    if (!def) continue;
    const id = String(def.id || def.rowId || "").trim();
    const code = String(def.shiftCode || def.code || "").trim().toUpperCase();
    if (id) defById.set(id, def);
    if (code) defByCode.set(code, def);
  }

  // 1) Doğrudan assignments[] varsa — roleLabel eksikse defs'ten ekle
  const directAssignments = scheduleData.assignments;
  if (Array.isArray(directAssignments) && directAssignments.length > 0) {
    return directAssignments.map((a) => {
      if (!a) return null;
      const shiftId = String(a.shiftId || a.rowId || "").trim();
      const shiftCode = String(a.shiftCode || a.shift || a.code || "").trim().toUpperCase();
      const def = defById.get(shiftId) || defByCode.get(shiftCode) || null;
      if (!def) return a;
      const defShiftCode = String(def.shiftCode || def.code || "").trim();
      const hasUsefulRoleLabel = !!String(a.roleLabel || "").trim();
      const looksLikeRowId =
        /^\d{10,}$/.test(String(a.shiftCode || "").trim()) ||
        /^\d{10,}$/.test(String(a.shiftId || "").trim());
      return {
        ...a,
        roleLabel: hasUsefulRoleLabel ? a.roleLabel : (def.label || def.area || def.name || shiftId),
        shiftCode: looksLikeRowId ? (defShiftCode || shiftCode) : (shiftCode || defShiftCode),
      };
    }).filter(Boolean);
  }

  // 2) namedAssignments varsa dönüştür
  const named =
    scheduleData.roster?.namedAssignments ||
    scheduleData.namedAssignments ||
    null;
  if (named && typeof named === "object") {
    return namedToAssignments(named, defs, year, month1, options);
  }

  return [];
}
