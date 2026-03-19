const { NIGHT_CODES, NIGHT_EQUIVALENT_CODES } = require('./utils/nightShift');

// Validator cleanup is intentionally broader than "true night":
// keep true night codes plus night-equivalent cleanup codes such as V2.
const NIGHT_CLEANUP_CODES = new Set([...NIGHT_CODES, ...NIGHT_EQUIVALENT_CODES]);
const HALF_DAY_A_HOURS = 4;

const normalizeCode = (s) => String(s || '').trim().toUpperCase();
const normalizeText = (s = '') =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const PLACEHOLDER_PATTERNS = [/^deneme$/i, /^nobet kurallari$/i, /^nöbet kuralları$/i];
const isServiceSupervisorLabel = (label = '') => normalizeText(label).includes('servis sorumlu');
const prevDateStr = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function buildLeaveSet(leavesByPerson = {}) {
  const out = new Map();
  for (const [pidRaw, dates] of Object.entries(leavesByPerson || {})) {
    const pid = String(pidRaw || '').trim();
    if (!pid) continue;
    const set = new Set();
    if (Array.isArray(dates)) {
      for (const d of dates) {
        const ds = String(d || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) set.add(ds);
      }
    } else if (dates && typeof dates === 'object') {
      for (const k of Object.keys(dates)) {
        const ds = String(k || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) set.add(ds);
      }
    }
    if (set.size) out.set(pid, set);
  }
  return out;
}

function applyHardConstraints(assignments = [], leavesByPerson = {}) {
  const nightByPerson = new Map();
  const leaveByPerson = buildLeaveSet(leavesByPerson);
  for (const a of assignments || []) {
    const pid = String(a?.personId || '').trim();
    const dateStr = String(a?.date || a?.day || '').slice(0, 10);
    if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    const code = normalizeCode(a?.shiftCode || a?.shiftId || a?.shift || a?.code || '');
    if (!code || !NIGHT_CLEANUP_CODES.has(code)) continue;
    if (!nightByPerson.has(pid)) nightByPerson.set(pid, new Set());
    nightByPerson.get(pid).add(dateStr);
  }

  const issues = [];
  const filtered = [];
  for (const a of assignments || []) {
    const pid = String(a?.personId || '').trim();
    const dateStr = String(a?.date || a?.day || '').slice(0, 10);
    if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      filtered.push(a);
      continue;
    }
    const leaveSet = leaveByPerson.get(pid);
    if (leaveSet && leaveSet.has(dateStr)) {
      issues.push({ date: dateStr, shiftId: a?.shiftId || a?.shiftCode || '', reason: 'LEAVE_BLOCK' });
      continue;
    }
    const prev = prevDateStr(dateStr);
    if (prev && nightByPerson.get(pid)?.has(prev)) {
      issues.push({ date: dateStr, shiftId: a?.shiftId || a?.shiftCode || '', reason: 'REST_AFTER_NIGHT' });
      continue;
    }
    filtered.push(a);
  }
  return { assignments: filtered, issues };
}

function buildSupervisorRowIdSet(defs = []) {
  const set = new Set();
  for (const row of defs || []) {
    const id = String(row?.id || row?.rowId || '').trim();
    const label = String(row?.label || row?.area || row?.name || '').trim();
    if (!id || !label) continue;
    if (isServiceSupervisorLabel(label)) set.add(id);
  }
  return set;
}

function sanitizeSupervisorAssignments(assignments = [], holidayKindByDate = {}, shiftMetaByCode = {}, defs = []) {
  const supervisorRowIds = buildSupervisorRowIdSet(defs);
  return (assignments || [])
    .map((item) => {
      const shiftId = String(item?.shiftId || item?.rowId || '').trim();
      const label = String(item?.roleLabel || item?.label || item?.area || '').trim();
      const isSupervisor = supervisorRowIds.has(shiftId) || isServiceSupervisorLabel(label);
      if (!isSupervisor) return item;
      const date = String(item?.date || item?.day || '').slice(0, 10);
      if (!date) return item;
      const dt = new Date(`${date}T00:00:00`);
      const weekday = Number.isNaN(dt.getTime()) ? NaN : dt.getDay();
      const kind = String(holidayKindByDate?.[date] || '').toLowerCase();
      if (weekday === 0 || weekday === 6 || kind === 'full') return null;
      if (kind === 'arife' || kind === 'half') {
        const aMeta = shiftMetaByCode.A || {};
        const arifeHours = Number.isFinite(Number(aMeta.hours)) ? Number(aMeta.hours) : HALF_DAY_A_HOURS;
        return {
          ...item,
          shiftCode: 'A',
          shiftId: 'A',
          hours: arifeHours,
        };
      }
      return item;
    })
    .filter(Boolean);
}

function buildStaffMaps(staff = []) {
  const idSet = new Set();
  const nameToId = new Map();
  for (const person of staff || []) {
    const pid = String(person?.id || person?._id || person?.personId || '').trim();
    const name = String(person?.name || person?.fullName || person?.displayName || '').trim();
    const canon = normalizeText(name);
    if (pid) idSet.add(pid);
    if (pid && canon && !nameToId.has(canon)) nameToId.set(canon, pid);
  }
  return { idSet, nameToId };
}

function classifyInvalidAssignee(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return 'INVALID_ASSIGNEE';
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(raw))) return 'PLACEHOLDER_ASSIGNMENT';
  return 'UNKNOWN_PERSON_LABEL';
}

function sanitizeAssignees(assignments = [], staff = []) {
  const { idSet, nameToId } = buildStaffMaps(staff);
  if (!idSet.size && !nameToId.size) {
    return {
      assignments: Array.isArray(assignments) ? assignments.slice() : [],
      issues: [],
      debug: { invalidAssignmentCount: 0, invalidAssignments: [] },
    };
  }

  const issues = [];
  const invalidAssignments = [];
  const filtered = [];

  for (const item of assignments || []) {
    const pidRaw = String(item?.personId || '').trim();
    const nameRaw = String(item?.personName || item?.name || '').trim();
    const resolvedPid = pidRaw && idSet.has(pidRaw)
      ? pidRaw
      : (nameRaw ? nameToId.get(normalizeText(nameRaw)) || '' : '');

    if (!resolvedPid) {
      const detail = classifyInvalidAssignee(nameRaw);
      invalidAssignments.push({
        date: String(item?.date || item?.day || '').slice(0, 10) || null,
        shiftId: String(item?.shiftId || item?.shiftCode || item?.rowId || '').trim() || null,
        personName: nameRaw || null,
        invalidAssigneeReason: detail,
      });
      issues.push({
        date: String(item?.date || item?.day || '').slice(0, 10) || null,
        shiftId: item?.shiftId || item?.shiftCode || item?.rowId || '',
        reason: 'INVALID_ASSIGNEE',
        detail,
        personName: nameRaw || undefined,
      });
      continue;
    }

    filtered.push({
      ...item,
      personId: resolvedPid,
    });
  }

  return {
    assignments: filtered,
    issues,
    debug: {
      invalidAssignmentCount: invalidAssignments.length,
      invalidAssignments,
    },
  };
}

function validateAssignments({
  assignments = [],
  leavesByPerson = {},
  holidayKindByDate = {},
  shiftMetaByCode = {},
  defs = [],
  staff = [],
} = {}) {
  const sanitizedAssignments = sanitizeSupervisorAssignments(assignments, holidayKindByDate, shiftMetaByCode, defs);
  const assigneeGuard = sanitizeAssignees(sanitizedAssignments, staff);
  const hard = applyHardConstraints(assigneeGuard.assignments, leavesByPerson);
  const issues = [...(assigneeGuard.issues || []), ...(hard.issues || [])];
  return {
    assignments: hard.assignments || [],
    issues,
    debug: {
      hardFiltered: (assigneeGuard.assignments.length || 0) - ((hard.assignments || []).length || 0),
      invalidAssignmentCount: Number(assigneeGuard?.debug?.invalidAssignmentCount || 0),
      invalidAssignments: Array.isArray(assigneeGuard?.debug?.invalidAssignments)
        ? assigneeGuard.debug.invalidAssignments
        : [],
    },
  };
}

module.exports = {
  validateAssignments,
};
