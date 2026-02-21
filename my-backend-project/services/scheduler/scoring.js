// services/scheduler/scoring.js

function calculateScore(person, day, shift, context) {
  let score = 0;

  const weights = context?.weights || {};
  const target = Number(context?.targetHours || 0);
  const totalHours = Number(person?.totalHours || 0);
  const weekday = Number(day?.weekday ?? -1);
  const weekdayCount = person?.weekdayCount || {};
  const pairHistory = person?.pairHistory || {};
  const assigned = shift?.assignedPersons || [];

  // Saat dengesi
  if (Number.isFinite(target) && target > 0) {
    const w = Number(weights.hourBalance ?? 2);
    score += (totalHours - target) * w;
  }

  // Haftanın günü dengesi
  if (weekday >= 0 && weekday <= 6) {
    const w = Number(weights.weekdayBalance ?? 3);
    score += Number(weekdayCount[weekday] || 0) * w;
  }

  // Aynı kişilerle eşleşme cezası
  for (const p of assigned) {
    if (!p?.id) continue;
    const key = `${person.id}-${p.id}`;
    const rev = `${p.id}-${person.id}`;
    const w = Number(weights.pairPenalty ?? 5);
    score += Number(pairHistory[key] || pairHistory[rev] || 0) * w;
  }

  // İstek bonusu
  const req = context?.requestsByPerson || {};
  const wants = req[person.id];
  if (wants && (wants instanceof Set ? wants.has(day.date) : Array.isArray(wants) && wants.includes(day.date))) {
    const w = Number(weights.requestBonus ?? -5);
    score += w;
  }

  // Ufak rastgelelik (opsiyonel)
  if (context?.randomize !== false) score += Math.random() * 0.5;

  return score;
}

module.exports = { calculateScore };
