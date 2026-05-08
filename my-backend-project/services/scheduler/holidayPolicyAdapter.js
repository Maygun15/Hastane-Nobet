const HALF_DAY_A_HOURS = 4;

const normalizeText = (s = '') =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const isServiceSupervisorLabel = (label = '') => normalizeText(label).includes('servis sorumlu');

// Bir shift'in tatil politikasını döndürür.
// Önce explicit holidayPolicy alanı; yoksa label bazlı eski davranış.
function resolveHolidayPolicy(shift) {
  const explicit = String(shift?.holidayPolicy || '').trim();
  if (explicit) return explicit;
  const label = shift?.area || shift?.label || shift?.name || '';
  if (isServiceSupervisorLabel(label)) return 'supervisor';
  return 'none';
}

// Politikaya ve tatil tipine göre shiftleri filtrele/dönüştür.
//   policy:
//     'none'       → her zaman çalış (etkilenme)
//     'full_off'   → tam tatilde (bayram, resmi tatil) çalışma yok
//     'all_off'    → tüm tatil türlerinde (arife dahil) çalışma yok
//     'supervisor' → hafta sonu + tam tatil = yok; arife = yarım gün "A" vardiyası
function applyPolicyToShift({ shift, weekday, holidayKind, shiftMetaByCode }) {
  const policy = resolveHolidayPolicy(shift);
  const isWeekend = weekday === 0 || weekday === 6;
  const isFull = holidayKind === 'full';
  const isArife = holidayKind === 'arife' || holidayKind === 'half';

  if (policy === 'none') return [shift];

  if (policy === 'full_off') {
    if (isFull) return [];
    return [shift];
  }

  if (policy === 'all_off') {
    if (isFull || isArife) return [];
    return [shift];
  }

  if (policy === 'supervisor') {
    if (isWeekend || isFull) return [];
    if (isArife) {
      const aMeta = shiftMetaByCode?.A || {};
      const arifeHours = Number.isFinite(Number(aMeta.hours)) ? Number(aMeta.hours) : HALF_DAY_A_HOURS;
      return [{
        ...shift,
        id: String(shift?.id || shift?.code || 'A'),
        code: 'A',
        hours: arifeHours,
        start: aMeta.start ?? shift?.start ?? null,
        end: aMeta.end ?? shift?.end ?? null,
        isNight: aMeta.isNight ?? false,
      }];
    }
    return [shift];
  }

  return [shift];
}

function applyHolidayPolicies({ days = [], holidayKindByDate = {}, shiftMetaByCode = {} } = {}) {
  return (days || []).map((day) => {
    const weekday = Number(day?.weekday);
    const date = String(day?.date || '').slice(0, 10);
    const holidayKind = String(holidayKindByDate?.[date] || '').toLowerCase();

    const hasHolidayContext = weekday === 0 || weekday === 6 || !!holidayKind;
    if (!hasHolidayContext) return day;

    const shifts = (day?.shifts || []).flatMap((shift) =>
      applyPolicyToShift({ shift, weekday, holidayKind, shiftMetaByCode })
    );

    const unchanged =
      shifts.length === (day?.shifts || []).length &&
      shifts.every((s, i) => s === (day?.shifts || [])[i]);
    if (unchanged) return day;

    return { ...day, shifts };
  });
}

module.exports = { applyHolidayPolicies };
