// services/scheduler/scoring.js

const { isNightWorkShift } = require("./utils/nightShift");
const { fairnessBalancePenalty } = require("./fairnessCounters");

// Onaysız tercih ("çalışmak istemiyorum" / "gece istemiyorum") için kaçınma cezası.
// Saat dengesi (hourBalance=2) ile kıyaslanınca ~10 saatlik farka denk gelir:
// motor mümkünse kaçınır ama kadro yetmezse yine yazar.
const DEFAULT_PREFERENCE_AVOID_WEIGHT = 20;

function preferencePenalty(person, day, shift, context, weights) {
  const pref = context?.preferencesByPerson?.[person?.id];
  const date = day?.date;
  if (!pref || !date) return 0;
  const w = Number(weights.preferenceAvoid ?? DEFAULT_PREFERENCE_AVOID_WEIGHT);
  let penalty = 0;
  if (Array.isArray(pref.softOff) && pref.softOff.includes(date)) penalty += w;
  if (Array.isArray(pref.softNoNight) && pref.softNoNight.includes(date) && shift) {
    if (isNightWorkShift(shift)) penalty += w;
  }
  return penalty;
}

function calculateScore(person, day, shift, context) {
  let score = 0;

  const weights = context?.weights || {};
  const target = Number(context?.targetHours || 0);
  const targetShifts = Number(context?.targetShifts || 0);
  const totalHours = Number(person?.totalHours || 0);
  const totalShifts = Number(person?.totalShifts || 0);
  const weekday = Number(day?.weekday ?? -1);
  const weekdayCount = person?.weekdayCount || {};
  const pairHistory = person?.pairHistory || {};
  const assigned = shift?.assignedPersons || [];

  // Saat dengesi
  if (Number.isFinite(target) && target > 0) {
    const w = Number(weights.hourBalance ?? 2);
    score += (totalHours - target) * w;
  }

  // Nöbet sayısı dengesi (saat yoksa da dengeler)
  if (Number.isFinite(targetShifts) && targetShifts > 0) {
    const w = Number(weights.shiftBalance ?? 3);
    score += (totalShifts - targetShifts) * w;
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

  // Gece ve hafta sonu dengesi (hedefi aşan kişi geri itilir)
  score += fairnessBalancePenalty(person, day, shift, context, weights);

  // Onaysız tercih: kaçınma cezası
  score += preferencePenalty(person, day, shift, context, weights);

  // Ufak rastgelelik (opsiyonel)
  if (context?.randomize !== false) score += Math.random() * 0.5;

  return score;
}

module.exports = { calculateScore, preferencePenalty, DEFAULT_PREFERENCE_AVOID_WEIGHT };
