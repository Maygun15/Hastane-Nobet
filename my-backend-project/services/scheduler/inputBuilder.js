const normalizeCode = (s) => String(s || '').trim().toUpperCase();
const pad2 = (n) => String(n).padStart(2, '0');
const monIndex = (wdSun0) => (wdSun0 + 6) % 7; // 0=Mon

function buildShiftMetaLookup(shiftOptions = []) {
  const out = Object.create(null);
  for (const item of shiftOptions || []) {
    const code = normalizeCode(item?.code || item?.id || '');
    if (!code) continue;
    out[code] = {
      hours: item?.hours,
      start: item?.start || null,
      end: item?.end || null,
      isNight: !!item?.isNight,
    };
  }
  return out;
}

function buildShiftMetaMap(data) {
  const map = new Map();
  const src = Array.isArray(data?.shiftOptions) ? data.shiftOptions : [];
  for (const s of src) {
    const code = String(s.code || s.id || '').trim();
    if (!code) continue;
    map.set(code, {
      hours: Number(s.hours || 0) || undefined,
      start: s.start || null,
      end: s.end || null,
      isNight: !!s.isNight,
    });
  }
  return map;
}

function buildDaysFromScheduleData({ year, month, data }) {
  const defs = Array.isArray(data?.defs)
    ? data.defs
    : Array.isArray(data?.rows)
    ? data.rows
    : [];
  if (!defs.length) return null;

  const shiftMeta = buildShiftMetaMap(data);

  const isDailyDefs = defs.some(
    (d) => d && (d.date || d.day) && Array.isArray(d.shifts)
  );

  if (isDailyDefs) {
    const last = new Date(year, month, 0).getDate();
    const byDate = new Map();
    for (const def of defs) {
      if (!def || !Array.isArray(def.shifts)) continue;
      let y = year;
      let m = month;
      let d = null;
      if (def.date) {
        const parts = String(def.date).split("-");
        if (parts.length === 3) {
          y = Number(parts[0]);
          m = Number(parts[1]);
          d = Number(parts[2]);
        }
      } else if (def.day) {
        d = Number(def.day);
      }
      if (!d || y !== year || m !== month) continue;

      const key = `${year}-${pad2(month)}-${pad2(d)}`;
      const arr = byDate.get(key) || [];
      for (const sh of def.shifts) {
        if (!sh) continue;
        const code = String(sh.code || sh.shiftCode || sh.id || sh.label || sh.name || "").trim();
        const area = String(sh.area || sh.label || def.label || def.area || def.name || "").trim();
        const need = Math.max(
          0,
          Number(sh.requiredCount ?? sh.count ?? sh.need ?? sh.required ?? sh.qty ?? 0) || 0
        );
        if (!code || need <= 0) continue;
        const meta = shiftMeta.get(code) || {};
        arr.push({
          id: String(sh.id || code),
          code,
          area,
          requiredCount: need,
          hours: meta.hours,
          start: meta.start,
          end: meta.end,
          isNight: meta.isNight || false,
        });
      }
      byDate.set(key, arr);
    }

    const days = [];
    for (let d = 1; d <= last; d++) {
      const dt = new Date(year, month - 1, d);
      const wd = dt.getDay();
      const date = `${year}-${pad2(month)}-${pad2(d)}`;
      days.push({
        date,
        weekday: wd,
        shifts: byDate.get(date) || [],
      });
    }
    return days;
  }

  const overrides = data?.overrides && typeof data.overrides === 'object' ? data.overrides : {};

  const last = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const dt = new Date(year, month - 1, d);
    const wd = dt.getDay(); // 0=Sun
    const patIdx = monIndex(wd);
    const shifts = [];

    for (const def of defs) {
      const rowId = String(def?.id ?? def?.rowId ?? '');
      const shiftCode = def?.shiftCode || def?.label || def?.code || '';
      const area = String(def?.label || def?.area || def?.name || '').trim();
      if (!rowId) continue;

      let v = overrides?.[rowId]?.[d];
      if (v == null) {
        const pat = Array.isArray(def.pattern) ? def.pattern : Array(7).fill(def.defaultCount || 0);
        v = pat[patIdx] ?? def.defaultCount ?? 0;
      }

      if (def.weekendOff && (wd === 0 || wd === 6)) v = 0;
      const need = Math.max(0, Number(v) || 0);
      if (need <= 0) continue;

      const meta = shiftMeta.get(String(shiftCode)) || {};
      shifts.push({
        id: rowId,
        code: shiftCode,
        area,
        requiredCount: need,
        hours: meta.hours,
        start: meta.start,
        end: meta.end,
        isNight: meta.isNight || false,
      });
    }

    days.push({
      date: `${year}-${pad2(month)}-${pad2(d)}`,
      weekday: wd,
      shifts,
    });
  }

  return days;
}

function buildSchedulerInput({
  scheduleDoc,
  payload = {},
  year,
  month,
  hospitalId,
  holidays = [],
} = {}) {
  const scheduleData = scheduleDoc?.data || {};
  const defs = Array.isArray(scheduleData?.defs)
    ? scheduleData.defs
    : Array.isArray(scheduleData?.rows)
    ? scheduleData.rows
    : [];
  const overrides = scheduleData?.overrides && typeof scheduleData.overrides === 'object' ? scheduleData.overrides : {};
  const shiftOptions = Array.isArray(scheduleData?.shiftOptions) ? scheduleData.shiftOptions : [];
  const payloadDefs = Array.isArray(payload?.defs)
    ? payload.defs
    : Array.isArray(payload?.rows)
    ? payload.rows
    : null;
  const effectiveDefs = payloadDefs || defs;
  const effectiveOverrides =
    payload?.overrides && typeof payload.overrides === 'object' ? payload.overrides : overrides;
  const effectiveShiftOptions = Array.isArray(payload?.shiftOptions)
    ? payload.shiftOptions
    : shiftOptions;
  const days =
    Array.isArray(payload.days) && payload.days.length
      ? payload.days
      : scheduleDoc
      ? buildDaysFromScheduleData({ year, month, data: scheduleDoc.data || {} })
      : null;

  const holidayKindByDate = Object.fromEntries(
    (holidays || []).map((row) => [String(row.date || '').slice(0, 10), String(row.kind || 'full').toLowerCase()])
  );
  const shiftMetaByCode = buildShiftMetaLookup(effectiveShiftOptions);

  return {
    scheduleData,
    defs,
    overrides,
    shiftOptions,
    effectiveDefs,
    effectiveOverrides,
    effectiveShiftOptions,
    days,
    holidayKindByDate,
    shiftMetaByCode,
  };
}

module.exports = {
  buildShiftMetaMap,
  buildDaysFromScheduleData,
  buildShiftMetaLookup,
  buildSchedulerInput,
};
