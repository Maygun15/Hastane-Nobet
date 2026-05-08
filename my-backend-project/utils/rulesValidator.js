// utils/rulesValidator.js
// All built-in rules are "soft" — an admin can override them with force:true.
// The response includes canForce:true so the client knows to offer an override option.
function validateAssignment(rules, assignment, existingAssignments) {
  if (!rules || !rules.enabled) return { valid: true, errors: [], canForce: false };

  const errors = [];
  const { personId, personName, date } = assignment || {};
  const pid = String(personId || '').trim();
  const pname = String(personName || '').trim();
  const assignDate = new Date(date);

  const matchesPerson = (a) => {
    const apid = String(a?.personId || '').trim();
    const apname = String(a?.personName || '').trim();
    if (pid && apid) return apid === pid;
    if (pname && apname) return apname === pname;
    return false;
  };

  // 1) Maksimum nöbet sayısı
  if (Number.isFinite(rules.maxShiftsPerPerson) && rules.maxShiftsPerPerson !== null) {
    const countInMonth = (existingAssignments || []).filter(matchesPerson).length;
    if (countInMonth >= rules.maxShiftsPerPerson) {
      errors.push(
        `Bu kişi ayda maksimum ${rules.maxShiftsPerPerson} nöbet alabilir. Şu an ${countInMonth} nöbeti var.`
      );
    }
  }

  // 2) Nöbetler arası minimum gün
  if (Number(rules.minRestDaysBetween || 0) > 0 && Number.isFinite(assignDate.getTime())) {
    const minDays = Number(rules.minRestDaysBetween || 0);
    const conflicts = (existingAssignments || []).filter((a) => {
      if (!matchesPerson(a)) return false;
      const existDate = new Date(a?.date || a?.day || '');
      if (!Number.isFinite(existDate.getTime())) return false;
      const daysDiff = Math.abs((assignDate - existDate) / (1000 * 60 * 60 * 24));
      return daysDiff < minDays;
    });

    if (conflicts.length > 0) {
      errors.push(
        `Bu kişinin son nöbetinden sonra en az ${minDays} gün ara olmalı. Önceki nöbetler: ${conflicts
          .map((c) => c?.date || c?.day)
          .filter(Boolean)
          .join(', ')}`
      );
    }
  }

  // 3) Maksimum ardışık nöbet
  if (Number.isFinite(rules.maxConsecutiveShifts) && rules.maxConsecutiveShifts !== null) {
    const maxConsecutive = Number(rules.maxConsecutiveShifts);
    if (Number.isFinite(assignDate.getTime())) {
      let consecutive = 1;
      for (let i = 1; i <= maxConsecutive + 1; i++) {
        const checkDate = new Date(assignDate);
        checkDate.setDate(checkDate.getDate() - i);
        const dateStr = checkDate.toISOString().split('T')[0];
        const hasShift = (existingAssignments || []).some(
          (a) => matchesPerson(a) && String(a?.date || a?.day || '').slice(0, 10) === dateStr
        );
        if (hasShift) consecutive++;
        else break;
      }
      if (consecutive > maxConsecutive) {
        errors.push(
          `Bu kişi ardışık maksimum ${maxConsecutive} nöbet alabilir. Şu an ${consecutive} ardışık nöbeti olacak.`
        );
      }
    }
  }

  // 4) Yasaklı günler (örn: weekend)
  if (Array.isArray(rules.restrictedDays) && rules.restrictedDays.includes('weekend')) {
    if (Number.isFinite(assignDate.getTime())) {
      const dayOfWeek = assignDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        errors.push('Hafta sonuna nöbet ataması kural olarak engellendi.');
      }
    }
  }

  return { valid: errors.length === 0, errors, canForce: errors.length > 0 };
}

module.exports = { validateAssignment };
