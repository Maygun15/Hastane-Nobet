import { getPersonDayShift, getScheduleModelSync } from "../store/monthlyScheduleModel.js";

const pad2 = (n) => String(n).padStart(2, "0");

export function checkLeaveShiftConflict({ personId, personName, year, month, day, people = [] }) {
  const model = getScheduleModelSync({ year, month, people });
  const shift = getPersonDayShift({ model, personId, personName, day });
  if (!shift) return { hasConflict: false, assignments: [] };

  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  return {
    hasConflict: true,
    assignments: [shift],
    message: `${personName || "Personel"} — ${date} tarihinde vardiyalı (${shift.rowLabel || shift.shiftCode || "vardiya"}).`,
  };
}

export function scanMonthConflicts({ people, year, month }) {
  const model = getScheduleModelSync({ year, month, people });
  const out = [];

  for (const person of people || []) {
    for (let day = 1; day <= 31; day += 1) {
      const result = checkLeaveShiftConflict({
        personId: person?.id || person?._id,
        personName: person?.fullName || person?.name || "",
        year,
        month,
        day,
        people,
      });
      if (result.hasConflict) out.push(result);
    }
  }

  return out;
}
