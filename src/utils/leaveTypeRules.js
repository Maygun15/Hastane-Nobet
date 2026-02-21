// src/utils/leaveTypeRules.js

const upTR = (s) => (s ?? "").toString().trim().toLocaleUpperCase("tr");

const toBool = (v) => {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "evet", "yes", "y", "t", "on"].includes(s)) return true;
  if (["0", "false", "hayir", "hayır", "no", "n", "f", "off"].includes(s)) return false;
  return null;
};

const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// Çalışılmış sayılan izinler (overtime hesapları için)
export function buildLeaveCreditRules(leaveTypes = [], baseRules = {}) {
  const out = { ...(baseRules || {}) };
  for (const t of leaveTypes || []) {
    const code = upTR(t?.code ?? t?.kisaltma ?? t?.abbr ?? t?.short ?? "");
    if (!code) continue;
    const def = out[code] || {};

    const hasCounts = hasOwn(t, "countsAsWorked");
    const hasHours = hasOwn(t, "hoursPerDay");
    if (!hasCounts && !hasHours) {
      if (!out[code]) out[code] = { countsAsWorked: false, hoursPerDay: 0 };
      continue;
    }

    const counts = hasCounts ? toBool(t.countsAsWorked) : (def.countsAsWorked ?? false);
    let hours = hasHours ? toNum(t.hoursPerDay) : def.hoursPerDay;
    if (!Number.isFinite(hours)) hours = counts ? 8 : 0;

    out[code] = {
      ...def,
      countsAsWorked: !!counts,
      hoursPerDay: counts ? hours : 0,
    };
  }
  return out;
}

// Aylık hedef saat düşümü (solver için)
export function buildLeaveTargetRules(leaveTypes = [], baseRules = {}) {
  const out = { ...(baseRules || {}) };
  for (const t of leaveTypes || []) {
    const code = upTR(t?.code ?? t?.kisaltma ?? t?.abbr ?? t?.short ?? "");
    if (!code) continue;
    const def = out[code] || {};

    const hasCounts = hasOwn(t, "countsAsWorked");
    const hasHours = hasOwn(t, "hoursPerDay");
    if (!hasCounts && !hasHours) {
      if (!out[code]) {
        out[code] = { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 };
      }
      continue;
    }

    const counts = hasCounts
      ? toBool(t.countsAsWorked)
      : ((def.countsAsWorkHours || def.reduceMonthlyTarget) > 0);
    let hours = hasHours ? toNum(t.hoursPerDay) : (def.reduceMonthlyTarget ?? def.countsAsWorkHours);
    if (!Number.isFinite(hours)) hours = counts ? 8 : 0;

    out[code] = {
      ...def,
      blocksShift: def.blocksShift ?? true,
      countsAsWorkHours: counts ? hours : 0,
      reduceMonthlyTarget: counts ? hours : 0,
    };
  }
  return out;
}
