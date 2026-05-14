// services/swapSuggestionService.js — Find best swap partners for a given assignment
const Assignment = require('../models/Assignment');
const Setting = require('../models/Setting');
const Person = require('../models/Person');
const MonthlySchedule = require('../models/MonthlySchedule');
const ScheduleRules = require('../models/ScheduleRules');
const { validateAssignment } = require('../utils/rulesValidator');
const { checkAdjacentDayConflict } = require('./conflictService');

function parseYM(dateStr) {
  const m = String(dateStr || '').slice(0, 7).match(/^(\d{4})-(\d{2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function canonName(value) {
  return normalizeText(value);
}

function looksObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || '').trim());
}

function pickFirstString(...values) {
  for (const value of values) {
    const str = String(value || '').trim();
    if (str) return str;
  }
  return '';
}

function summarizeRuleErrors(errors = []) {
  const out = [];
  for (const raw of Array.isArray(errors) ? errors : []) {
    const msg = String(raw || '').trim();
    if (!msg) continue;
    const lower = msg.toLocaleLowerCase('tr-TR');
    if (lower.includes('ardişik') || lower.includes('ardışık')) {
      out.push('Ardışık nöbet kuralı');
    } else if (lower.includes('en az') && lower.includes('gün ara')) {
      out.push('Dinlenme aralığı');
    } else if (lower.includes('ayda maksimum')) {
      out.push('Aylık nöbet limiti');
    } else if (lower.includes('hafta sonu')) {
      out.push('Kısıtlı gün');
    } else {
      out.push(msg);
    }
  }
  return Array.from(new Set(out));
}

async function loadApplicableRules({ sectionId, serviceId, role, hospitalId }) {
  const sid = String(sectionId || '').trim();
  if (!sid) return { enabled: false };
  const svc = serviceId != null ? String(serviceId).trim() : '';
  const scopeRole = role != null ? String(role).trim() : '';
  const query = {
    sectionId: sid,
    $or: [
      { serviceId: svc, role: scopeRole },
      { serviceId: svc, role: '' },
      { serviceId: '', role: '' },
    ],
  };
  if (hospitalId) query.hospitalId = hospitalId;
  const rules = await ScheduleRules.findOne(query).lean();
  return rules || { enabled: false };
}

function toStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === 'string' ? item.split(/[,;]/) : [item]))
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  return String(value)
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesArea(workAreas = [], roleLabel = '') {
  const target = normalizeText(roleLabel);
  if (!target) return true;
  const areas = toStringArray(workAreas).map(normalizeText).filter(Boolean);
  if (!areas.length) return true;
  return areas.some((area) => area === target || area.includes(target) || target.includes(area));
}

function isNurseLike(text) {
  return /(hemsire|hemşire|ebe|att|s\.?\s*memuru|nurse)/.test(text);
}
function isDoctorLike(text) {
  return /(doktor|doctor|hekim|tabip|\bdr\b)/.test(text);
}

function matchesScheduleRole(candidate, scheduleRole = '') {
  const target = String(scheduleRole || '').trim().toLowerCase();
  if (!target) return true;
  const roleText = normalizeText(
    pickFirstString(
      candidate?.meta?.role,
      candidate?.meta?.roles,
      candidate?.meta?.title,
      candidate?.meta?.unvan,
      candidate?.role,
      candidate?.title
    )
  );
  if (!roleText) return true;
  const targetIsNurse = target === 'nurse' || isNurseLike(target);
  const targetIsDoctor = target === 'doctor' || isDoctorLike(target);
  if (targetIsNurse) return isNurseLike(roleText) || roleText === 'nurse';
  if (targetIsDoctor) return isDoctorLike(roleText) || roleText === 'doctor';
  return roleText.includes(target);
}

function resolvePersonTitle(candidate = {}) {
  return pickFirstString(
    candidate?.meta?.title,
    candidate?.meta?.unvan,
    candidate?.meta?.role,
    candidate?.title,
    candidate?.role
  );
}

function resolvePersonService(candidate = {}) {
  const label = pickFirstString(
    candidate?.meta?.serviceName,
    candidate?.meta?.serviceLabel,
    candidate?.meta?.service,
    candidate?.meta?.department,
    candidate?.service,
    candidate?.department
  );
  if (label) return label;
  const fallbackId = pickFirstString(candidate?.serviceId);
  return looksObjectId(fallbackId) ? '' : fallbackId;
}

function findMatchingDef(defs = [], target = {}) {
  const wantedShiftId = String(target?.shiftId || target?.rowId || '').trim();
  const wantedShiftCode = String(target?.shiftCode || '').trim().toUpperCase();
  return (Array.isArray(defs) ? defs : []).find((def) => {
    const defId = String(def?.id || def?.rowId || '').trim();
    const defCode = String(def?.shiftCode || def?.code || '').trim().toUpperCase();
    if (wantedShiftId && defId && defId === wantedShiftId) return true;
    if (wantedShiftCode && defCode && defCode === wantedShiftCode) return true;
    return false;
  }) || null;
}

async function findScheduleReadModel({ sectionId, serviceId, role, year, month, hospitalId }) {
  const candidates = [
    { sectionId, serviceId, role, year, month },
    { sectionId, serviceId, role: '', year, month },
    { sectionId, serviceId: '', role, year, month },
    { sectionId, serviceId: '', role: '', year, month },
  ];
  for (const base of candidates) {
    const query = { ...base };
    if (hospitalId) query.hospitalId = hospitalId;
    const doc = await MonthlySchedule.findOne(query).lean();
    if (doc) return doc;
  }
  return null;
}

function findSlotFromReadModel(scheduleDoc, { date, shiftId, personId, currentPersonName }) {
  const data = scheduleDoc?.data && typeof scheduleDoc.data === 'object' ? scheduleDoc.data : {};
  const defs = Array.isArray(data?.defs) ? data.defs : Array.isArray(data?.rows) ? data.rows : [];
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const targetName = canonName(currentPersonName);
  const match = assignments.find((item) => {
    const itemDate = String(item?.date || item?.day || '').slice(0, 10);
    if (itemDate !== date) return false;
    const itemShiftId = String(item?.shiftId || item?.rowId || '').trim();
    const itemShiftCode = String(item?.shiftCode || item?.shift || item?.code || '').trim().toUpperCase();
    const wantedShiftId = String(shiftId || '').trim();
    if (wantedShiftId && itemShiftId !== wantedShiftId && itemShiftCode !== wantedShiftId.toUpperCase()) return false;
    const itemPersonId = String(item?.personId || '').trim();
    const itemPersonName = canonName(item?.personName || item?.name || '');
    if (personId && itemPersonId) return itemPersonId === String(personId).trim();
    if (targetName && itemPersonName) return itemPersonName === targetName;
    return true;
  }) || null;

  const def = findMatchingDef(defs, {
    shiftId: match?.shiftId || match?.rowId || shiftId,
    rowId: match?.rowId || shiftId,
    shiftCode: match?.shiftCode || shiftId,
  });

  const taskLabel = pickFirstString(
    match?.roleLabel,
    def?.label,
    def?.roleLabel
  );
  const resolvedShiftCode = pickFirstString(
    match?.shiftCode,
    def?.shiftCode,
    def?.code,
    shiftId
  );
  const resolvedRowId = pickFirstString(
    match?.rowId,
    def?.rowId,
    def?.id,
    shiftId
  );
  const currentName = pickFirstString(match?.personName, currentPersonName);
  const currentId = pickFirstString(match?.personId, personId);

  return {
    slot: {
      date,
      taskLabel,
      shiftCode: resolvedShiftCode,
      rowId: resolvedRowId,
      serviceId: pickFirstString(scheduleDoc?.serviceId),
    },
    currentPerson: {
      id: currentId,
      name: currentName,
    },
  };
}

/**
 * Suggest up to `limit` swap partners for a given person+date+shift.
 *
 * A candidate is eligible if on `targetDate` they:
 *   - Are NOT on leave
 *   - Are NOT already assigned to another shift
 *   - Are active
 *
 * They are ranked by how many fewer shifts they have than the requester.
 *
 * @param {object} opts
 * @param {string} opts.personId       — person who wants to swap
 * @param {string} opts.date           — YYYY-MM-DD
 * @param {string} opts.shiftId        — shift code/id being offered
 * @param {string} [opts.serviceId]    — restrict candidates to same service
 * @param {string} [opts.hospitalId]
 * @param {number} [opts.limit]        — max suggestions (default 5)
 */
// Check shift+area eligibility. Both gates are backward-compatible (no restriction if absent).
function isShiftEligible(candidate, shiftId, roleLabel) {
  const code = String(shiftId || '').trim().toUpperCase();

  // Gate 1: eligibleShiftCodes — explicit shift whitelist
  const eligibleCodes = toStringArray(candidate?.meta?.eligibleShiftCodes);
  if (eligibleCodes.length > 0) {
    if (!eligibleCodes.some((s) => String(s || '').trim().toUpperCase() === code)) return false;
  }

  // Gate 2: workAreas — area/role whitelist (match against roleLabel if provided)
  const workAreas = []
    .concat(toStringArray(candidate?.meta?.workAreas))
    .concat(toStringArray(candidate?.meta?.areas))
    .concat(toStringArray(candidate?.workAreas))
    .concat(toStringArray(candidate?.areas));
  if (!matchesArea(workAreas, roleLabel)) {
    return false;
  }

  return true;
}

async function suggestSwaps({
  personId,
  currentPersonName,
  date,
  shiftId,
  roleLabel,
  serviceId,
  role,
  sectionId,
  hospitalId,
  limit = 5,
}) {
  const ym = parseYM(date);
  if (!ym) return { ok: false, message: 'Geçersiz tarih formatı' };
  const requesterNameCanon = canonName(currentPersonName);
  const scheduleRules = await loadApplicableRules({
    sectionId,
    serviceId,
    role,
    hospitalId,
  });

  const scheduleDoc = sectionId
    ? await findScheduleReadModel({
        sectionId: String(sectionId || '').trim(),
        serviceId: String(serviceId || '').trim(),
        role: String(role || '').trim(),
        year: ym.year,
        month: ym.month,
        hospitalId,
      })
    : null;
  const slotMeta = findSlotFromReadModel(scheduleDoc, {
    date,
    shiftId,
    personId,
    currentPersonName,
  });
  const effectiveTaskLabel = pickFirstString(slotMeta?.slot?.taskLabel, roleLabel);
  const effectiveShiftCode = pickFirstString(slotMeta?.slot?.shiftCode, shiftId);

  const personQuery = { active: { $ne: false } };
  if (serviceId) personQuery.serviceId = serviceId;
  if (hospitalId) personQuery.hospitalId = hospitalId;
  if (personId) personQuery._id = { $ne: personId };

  const candidates = await Person.find(personQuery)
    .select('_id name serviceId meta')
    .lean();

  // SSOT: use Assignment collection for counting and conflict detection
  const assignQuery = { year: ym.year, month: ym.month };
  if (hospitalId) assignQuery.hospitalId = hospitalId;
  const monthAssignments = await Assignment.find(assignQuery)
    .select('personId personName date day shiftId shiftCode roleLabel')
    .lean();

  const assignCountByPerson = {};
  const assignedOnDateByPerson = new Set();
  const assignedOnDateByName = new Set();
  for (const a of monthAssignments) {
    const pid = String(a.personId || '');
    const pname = canonName(a.personName || a.fullName || a.name || '');
    if (pid) {
      assignCountByPerson[pid] = (assignCountByPerson[pid] || 0) + 1;
    }
    if (String(a.date || '').slice(0, 10) === date) {
      if (pid) assignedOnDateByPerson.add(pid);
      if (pname) assignedOnDateByName.add(pname);
    }
    if (!personId && requesterNameCanon && pname === requesterNameCanon) {
      assignCountByPerson.__requesterByName = (assignCountByPerson.__requesterByName || 0) + 1;
    }
  }

  const ownCount = personId
    ? (assignCountByPerson[String(personId)] || 0)
    : (assignCountByPerson.__requesterByName || 0);

  // Leaves: fetch for service
  const leaveDocs = await Setting.find({
    key: 'leavesV2',
    serviceId: { $in: Array.from(new Set([String(serviceId || ''), ''])) },
    ...(hospitalId ? { hospitalId } : {}),
  }).lean();
  const leaveValue = leaveDocs.reduce((acc, doc) => {
    const value = doc?.value && typeof doc.value === 'object' ? doc.value : {};
    return { ...acc, ...value };
  }, {});
  const dayNum = String(parseInt(date.slice(8, 10), 10));
  const monthKey = date.slice(0, 7);

  const suggestions = [];
  const samePositionBlocked = [];
  const otherBlocked = [];
  const blocked = [];
  for (const c of candidates) {
    const cid = String(c._id);
    const candidateNameCanon = canonName(c.name || '');
    if (!personId && requesterNameCanon && candidateNameCanon && candidateNameCanon === requesterNameCanon) continue;
    const warnings = [];
    const assignedSameDay =
      assignedOnDateByPerson.has(cid) ||
      (candidateNameCanon && assignedOnDateByName.has(candidateNameCanon));
    const onLeave = !!leaveValue[cid]?.[monthKey]?.[dayNum];
    const roleMatch = matchesScheduleRole(c, role);
    const areaShiftMatch = isShiftEligible(c, effectiveShiftCode, effectiveTaskLabel);
    const samePositionFit = roleMatch && areaShiftMatch;

    if (assignedSameDay) warnings.push('Aynı gün başka nöbeti var');
    if (onLeave) warnings.push('İzinli');
    if (!roleMatch) warnings.push('Rol uyumsuz');
    if (!areaShiftMatch) warnings.push('Alan/vardiya uyumsuz');
    if (warnings.length === 0) {
      const adjacentConflicts = await checkAdjacentDayConflict({
        personId: cid,
        personName: c.name || cid,
        date,
      });
      if (adjacentConflicts.length > 0) {
        warnings.push('Peş peşe nöbet');
      }
    }
    if (warnings.length === 0 && scheduleRules?.enabled) {
      const validation = validateAssignment(
        scheduleRules,
        {
          date,
          personId: cid,
          personName: c.name || cid,
          shiftId: effectiveShiftCode,
          shiftCode: effectiveShiftCode,
          roleLabel: effectiveTaskLabel,
        },
        monthAssignments
      );
      if (!validation.valid) {
        warnings.push(...summarizeRuleErrors(validation.errors));
      }
    }

    const shiftCount = assignCountByPerson[cid] || 0;
    const delta = ownCount - shiftCount;
    const recommendationTier = warnings.length === 0
      ? 'recommended'
      : samePositionFit
        ? 'same_position_blocked'
        : 'mismatch';
    const candidateInfo = {
      id: cid,
      name: c.name || cid,
      title: resolvePersonTitle(c),
      service: resolvePersonService(c),
      monthlyShiftCount: shiftCount,
      eligible: warnings.length === 0,
      warnings,
      delta,
      recommendationTier,
      samePositionFit,
    };
    const hardBlocked = warnings.some((warning) =>
      warning === 'Aynı gün başka nöbeti var' ||
      warning === 'Peş peşe nöbet' ||
      warning === 'İzinli'
    );
    if (warnings.length === 0) {
      suggestions.push(candidateInfo);
    } else if (!hardBlocked && samePositionFit) {
      samePositionBlocked.push(candidateInfo);
    } else if (!hardBlocked) {
      otherBlocked.push(candidateInfo);
    }
    blocked.push(candidateInfo);
  }

  suggestions.sort((a, b) => b.delta - a.delta || (a.name > b.name ? 1 : -1));
  samePositionBlocked.sort((a, b) => b.delta - a.delta || (a.name > b.name ? 1 : -1));
  otherBlocked.sort((a, b) => {
    if (a.samePositionFit !== b.samePositionFit) return a.samePositionFit ? -1 : 1;
    return b.delta - a.delta || (a.name > b.name ? 1 : -1);
  });
  blocked.sort((a, b) => {
    const order = { recommended: 0, same_position_blocked: 1, mismatch: 2 };
    const tierCmp = (order[a.recommendationTier] ?? 9) - (order[b.recommendationTier] ?? 9);
    if (tierCmp !== 0) return tierCmp;
    return b.delta - a.delta || (a.name > b.name ? 1 : -1);
  });

  const orderedCandidates = [...suggestions, ...samePositionBlocked, ...otherBlocked];
  const candidateList = orderedCandidates.slice(0, Math.max(1, Number(limit) || 100));
  const recommendedNames = suggestions.slice(0, 3).map((item) => item.name).filter(Boolean);
  const alternativeNames = samePositionBlocked.slice(0, 3).map((item) => item.name).filter(Boolean);
  let recommendationText = '';
  if (recommendedNames.length > 0) {
    recommendationText = `Bu slot için öncelikle şunları yazabilirsiniz: ${recommendedNames.join(', ')}.`;
  } else if (alternativeNames.length > 0) {
    recommendationText = `Tam uygun aday yok. Aynı pozisyona en yakın alternatifler: ${alternativeNames.join(', ')}. Kural uyarılarını inceleyin.`;
  } else if (candidateList.length > 0) {
    recommendationText = 'Tam uygun aday yok. Aşağıda, nedenleriyle birlikte tüm değerlendirilebilir adaylar gösteriliyor.';
  }

  return {
    ok: true,
    slot: {
      date,
      taskLabel: effectiveTaskLabel,
      shiftCode: effectiveShiftCode,
      rowId: slotMeta?.slot?.rowId || String(shiftId || '').trim(),
      serviceId: slotMeta?.slot?.serviceId || String(serviceId || '').trim(),
    },
    currentPerson: {
      id: slotMeta?.currentPerson?.id || String(personId || '').trim(),
      name: slotMeta?.currentPerson?.name || String(currentPersonName || '').trim(),
    },
    candidates: candidateList.map(({ delta: _delta, ...item }) => item),
    recommendedCandidates: suggestions.slice(0, Math.max(1, Number(limit) || 100)).map(({ delta: _delta, ...item }) => item),
    samePositionAlternatives: samePositionBlocked.slice(0, Math.max(1, Number(limit) || 100)).map(({ delta: _delta, ...item }) => item),
    recommendationText,
    message: suggestions.length > 0
      ? ''
      : samePositionBlocked.length > 0
        ? 'Bu slot için tamamen uygun aday bulunamadı. Aynı pozisyona yakın alternatifler gösteriliyor.'
        : 'Bu slot için tamamen uygun aday bulunamadı. Aşağıda nedenleriyle birlikte tüm değerlendirilebilir adaylar gösteriliyor.',
    // Backward-compatible fields
    requesterShiftCount: ownCount,
    date,
    shiftId: effectiveShiftCode,
    suggestions: candidateList.map((item) => ({
      personId: item.id,
      personName: item.name,
      serviceId: item.service,
      shiftCount: item.monthlyShiftCount,
      eligible: item.eligible,
      warnings: item.warnings,
    })),
  };
}

module.exports = { suggestSwaps };
