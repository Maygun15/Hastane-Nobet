const HALF_DAY_A_HOURS = 4;

const normalizeText = (s = '') =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const isServiceSupervisorLabel = (label = '') => normalizeText(label).includes('servis sorumlu');

function applyHolidayPolicies({ days = [], holidayKindByDate = {}, shiftMetaByCode = {} } = {}) {
  return (days || []).map((day) => {
    const weekday = Number(day?.weekday);
    const date = String(day?.date || '').slice(0, 10);
    const holidayKind = String(holidayKindByDate?.[date] || '').toLowerCase();
    const blockSupervisor = weekday === 0 || weekday === 6 || holidayKind === 'full';
    const shifts = (day?.shifts || []).flatMap((shift) => {
      const label = shift?.area || shift?.label || shift?.name || '';
      if (!isServiceSupervisorLabel(label)) return [shift];
      if (blockSupervisor) return [];
      if (holidayKind === 'arife' || holidayKind === 'half') {
        const aMeta = shiftMetaByCode.A || {};
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
    });
    if (!blockSupervisor && holidayKind !== 'arife' && holidayKind !== 'half') return day;
    return { ...day, shifts };
  });
}

module.exports = {
  applyHolidayPolicies,
};
