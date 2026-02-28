// services/ruleEngine.js
// Level-2 Rule Engine (minimal, non-breaking)

const normalizeCode = (s) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim();

const parseTime = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
};

const ymKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

class RuleEngine {
  constructor(ruleDoc = {}) {
    this.ruleDoc = ruleDoc || {};
    this.basicRules = ruleDoc.basicRules || {};
    this.leaveRules = ruleDoc.leaveRules || {};
    this.shiftRules = ruleDoc.shiftRules || {};
    this.taskRequirements = ruleDoc.taskRequirements || {};
    this.personnelRules = ruleDoc.personnelRules || {};
  }

  getShiftRule(shiftCode) {
    const code = normalizeCode(shiftCode);
    if (!code) return null;
    const direct = this.shiftRules[code] || this.shiftRules[shiftCode] || null;
    if (direct) return direct;
    const found = Object.values(this.shiftRules || {}).find(
      (r) => normalizeCode(r?.code || r?.id || "") === code
    );
    return found || null;
  }

  isNightShift(shift) {
    if (!shift) return false;
    if (shift.isNight) return true;
    const rule = this.getShiftRule(shift.code || shift.id || shift.shiftCode);
    if (rule?.isNight) return true;
    return String(shift.code || shift.id || "").toUpperCase().includes("N");
  }

  resolveLeaveCode({ personId, date, leavesByPerson }) {
    if (!personId || !date || !leavesByPerson) return null;
    const pid = String(personId);
    const entry = leavesByPerson[pid];
    if (!entry) return null;

    if (Array.isArray(entry)) {
      return entry.includes(date) ? "LEAVE" : null;
    }

    if (typeof entry === "object") {
      const ym = date.slice(0, 7);
      const day = date.slice(8, 10);
      const byYm = entry[ym];
      const raw = (byYm && (byYm[date] ?? byYm[String(Number(day))])) ?? entry[date];
      if (!raw) return null;
      if (typeof raw === "string") return raw;
      if (typeof raw === "object") return raw.code || raw.type || raw.kind || "LEAVE";
      return "LEAVE";
    }

    return null;
  }

  applyLeaveRules(person, date, context = {}) {
    const code = this.resolveLeaveCode({
      personId: person?.id,
      date,
      leavesByPerson: context.leavesByPerson || {},
    });
    if (!code) return { canWork: true, countsAsWorked: false, code: null };

    const rule = this.leaveRules?.[code] || null;
    const allowDuty = rule?.allowDuty === false ? false : rule?.allowDuty === true ? true : false;
    const countsAsWorked = rule?.countAsWorked === true;
    return {
      canWork: allowDuty,
      countsAsWorked,
      code,
      reason: allowDuty ? "" : `LEAVE_${code}`,
    };
  }

  checkConsecutiveDays(person, assignments = []) {
    const max = Number(this.basicRules?.maxConsecutiveDays || 0);
    if (!max || !person?.id) return { consecutive: 0, maxAllowed: max || 0, canAssign: true };
    const pid = String(person.id);
    const days = assignments
      .filter((a) => String(a?.personId) === pid)
      .map((a) => String(a?.date || a?.day || ""))
      .filter(Boolean)
      .sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const d of days) {
      const diff = prev ? daysBetween(prev, d) : null;
      run = diff === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    return { consecutive: best, maxAllowed: max, canAssign: best < max };
  }

  calculateHours(person, assignments = [], dateStr, shift) {
    const pid = String(person?.id || "");
    if (!pid) return { dailyHours: 0, weeklyHours: 0, monthlyHours: 0, withinLimits: true };
    const hoursOf = (a) =>
      Number(a?.hours) ||
      Number(this.getShiftRule(a?.shiftCode || a?.shiftId)?.hours) ||
      Number(shift?.hours) ||
      0;
    const monthKey = dateStr ? dateStr.slice(0, 7) : "";
    let daily = 0;
    let weekly = 0;
    let monthly = 0;
    for (const a of assignments) {
      if (String(a?.personId) !== pid) continue;
      const d = String(a?.date || a?.day || "");
      const h = hoursOf(a);
      if (d === dateStr) daily += h;
      if (monthKey && d.startsWith(monthKey)) monthly += h;
      if (dateStr && daysBetween(d, dateStr) <= 6 && daysBetween(d, dateStr) >= 0) weekly += h;
    }
    const maxWeekly = Number(this.basicRules?.maxWeeklyHours || 0);
    const maxDaily = Number(this.basicRules?.maxDailyHours || 0);
    const withinLimits =
      (!maxWeekly || weekly <= maxWeekly) && (!maxDaily || daily <= maxDaily);
    return { dailyHours: daily, weeklyHours: weekly, monthlyHours: monthly, withinLimits };
  }

  validateShift(person, shift, date, context = {}) {
    const conflicts = [];
    if (!shift || !date) return { valid: true, conflicts };
    if (this.basicRules?.nightShiftFollowUp && this.isNightShift(shift)) {
      // night follow-up checks are handled in scheduler constraints; keep as info
    }
    const rest = Number(this.basicRules?.minRestHours || 0);
    if (rest && person?.lastShift?.date && person?.lastShift?.end && shift?.start) {
      const prevEnd = parseTime(person.lastShift.end);
      const currStart = parseTime(shift.start);
      if (prevEnd != null && currStart != null) {
        const diff = daysBetween(person.lastShift.date, date);
        const restHours = diff === 0 ? (currStart - prevEnd) / 60 : diff * 24 + (currStart - prevEnd) / 60;
        if (restHours < rest) conflicts.push("MIN_REST_HOURS");
      }
    }
    return { valid: conflicts.length === 0, conflicts };
  }

  checkPersonEligibility(person, shift, date, context = {}) {
    const leave = this.applyLeaveRules(person, date, context);
    if (!leave.canWork) {
      return { eligible: false, reason: leave.reason || "LEAVE" };
    }
    const task = this.taskRequirements?.[shift?.label || shift?.name || ""];
    if (task?.allowedRoles?.length) {
      const role = (person?.meta?.role || person?.role || "").toLowerCase();
      const ok = task.allowedRoles.some((r) => role.includes(String(r).toLowerCase()));
      if (!ok) return { eligible: false, reason: "ROLE_MISMATCH" };
    }
    return { eligible: true, reason: "OK" };
  }

  getConflicts(person, shift, date, context = {}) {
    const conflicts = [];
    const elig = this.checkPersonEligibility(person, shift, date, context);
    if (!elig.eligible) conflicts.push({ rule: "eligibility", conflict: elig.reason });
    const v = this.validateShift(person, shift, date, context);
    v.conflicts.forEach((c) => conflicts.push({ rule: "shift", conflict: c }));
    const cons = this.checkConsecutiveDays(person, context.assignments || []);
    if (!cons.canAssign) conflicts.push({ rule: "maxConsecutiveDays", conflict: cons.consecutive });
    const hours = this.calculateHours(person, context.assignments || [], date, shift);
    if (!hours.withinLimits) conflicts.push({ rule: "hours", conflict: "LIMIT_EXCEEDED" });
    return conflicts;
  }

  testRules({ person, shifts = [], dates = [], context = {} } = {}) {
    const report = [];
    let passed = 0;
    let failed = 0;
    for (let i = 0; i < shifts.length; i++) {
      const shift = shifts[i];
      const date = dates[i] || dates[0];
      const conflicts = this.getConflicts(person, shift, date, context);
      if (conflicts.length) {
        failed += 1;
        report.push({ date, shift, conflicts });
      } else {
        passed += 1;
      }
    }
    return { passed, failed, report };
  }
}

module.exports = RuleEngine;
