// src/utils/scheduleAdapter.js
// ============================================================
// İki farklı nöbet formatı arasında çift yönlü dönüşüm.
//
// FORMAT A: "namedAssignments" — DutyRowsEditor tarafından üretilir
//   { [günNumarası]: { [satırId]: [kişiAdı, ...] } }
//   Örn: { "1": { "row-kirmizi-v1": ["AYŞE YILMAZ"] } }
//
// FORMAT B: "assignments[]" — PlanTab/runPlannerOnce tarafından üretilir
//   [{ day, personId, personName, shiftCode, roleLabel, hours, pinned? }]
//   Örn: [{ day: "2026-05-01", personId: "p1", personName: "AYŞE YILMAZ",
//           shiftCode: "V1", roleLabel: "KIRMIZI", hours: 8 }]
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
 *
 * @param {Object} namedAssignments - { [gün]: { [satırId]: [isim, ...] } }
 * @param {Array}  defs             - Görev satırı tanımları: [{ id, label, shiftCode }]
 * @param {number} year             - Yıl (ör. 2026)
 * @param {number} month1           - 1-bazlı ay (1..12)
 * @param {Object} options
 * @param {Array}  options.people   - Personel listesi (id eşleştirme için)
 * @param {Function} options.hoursForShift - Vardiya kodundan saat hesaplayan fonksiyon
 * @returns {Array} assignments dizisi
 */
export function namedToAssignments(namedAssignments, defs = [], year, month1, options = {}) {
  const { people = [], hoursForShift } = options;
  if (!namedAssignments || typeof namedAssignments !== "object") return [];

  // Personel haritası: canonName → personId
  const personIndex = new Map();
  (Array.isArray(people) ? people : []).forEach((p) => {
    if (!p) return;
    const name = p.fullName || p.name || p.displayName || "";
    const canon = canonName(name);
    const id = String(p.id || p.personId || "").trim();
    if (canon && id) personIndex.set(canon, { id, name });
  });

  // Satır tanım haritası: rowId → { label, shiftCode }
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
      const def = defIndex.get(rowId);
      const shiftCode = def?.shiftCode || "";
      const roleLabel = def?.label || rowId;

      // Saat hesapla
      let hours = 0;
      if (typeof hoursForShift === "function") {
        hours = hoursForShift(shiftCode) || 0;
      } else if (def?.hours != null) {
        hours = Number(def.hours) || 0;
      }

      for (const personName of namesList) {
        if (!personName || typeof personName !== "string") continue;
        const trimmed = personName.trim();
        if (!trimmed) continue;

        const canon = canonName(trimmed);
        const match = personIndex.get(canon);
        const personId = match?.id || "";
        const displayName = match?.name || trimmed;

        assignments.push({
          day: dateStr,
          date: dateStr,
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
 * PlanTab/runPlannerOnce'ın ürettiği flat assignments dizisini,
 * DutyRowsEditor'ün okuyabileceği namedAssignments nesnesine çevirir.
 *
 * @param {Array}  assignments - [{ day|date, personName, shiftCode, roleLabel }]
 * @param {Array}  defs        - Görev satırı tanımları: [{ id, label, shiftCode }]
 * @returns {Object} namedAssignments nesnesi
 */
export function assignmentsToNamed(assignments, defs = []) {
  if (!Array.isArray(assignments)) return {};

  // label+shiftCode → rowId eşleştirmesi
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

    // Aynı kişiyi aynı gün+satır'a iki kez ekleme
    const existing = named[dayKey][rowId];
    const canon = canonName(personName);
    const alreadyExists = existing.some((n) => canonName(n) === canon);
    if (!alreadyExists) {
      existing.push(personName);
    }
  }

  return named;
}

/**
 * Backend'den dönen schedule verisinden assignments[] çıkar.
 * Her iki formatı da destekler:
 * - data.assignments (PlanTab formatı)
 * - data.roster.namedAssignments (DutyRowsEditor formatı)
 *
 * @param {Object} scheduleData - Backend'den dönen schedule.data
 * @param {number} year
 * @param {number} month1 - 1-bazlı ay
 * @param {Object} options - { people, hoursForShift }
 * @returns {Array} Normalize edilmiş assignments dizisi
 */
export function extractAssignmentsFromSchedule(scheduleData, year, month1, options = {}) {
  if (!scheduleData || typeof scheduleData !== "object") return [];

  // 1) Doğrudan assignments[] varsa onu kullan
  const directAssignments = scheduleData.assignments;
  if (Array.isArray(directAssignments) && directAssignments.length > 0) {
    return directAssignments;
  }

  // 2) namedAssignments varsa dönüştür
  const named =
    scheduleData.roster?.namedAssignments ||
    scheduleData.namedAssignments ||
    null;
  if (named && typeof named === "object") {
    const defs = scheduleData.defs || scheduleData.rows || [];
    return namedToAssignments(named, defs, year, month1, options);
  }

  return [];
}
