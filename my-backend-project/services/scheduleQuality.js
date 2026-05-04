// services/scheduleQuality.js — Compute a 0-100 quality score for a generated schedule
// Higher is better. Used both in generate result and explain endpoint.

/**
 * @param {{ assignments: object[], issues: object[] }} data
 * @param {{ requiredSlots?: number }} meta
 */
function computeQualityScore({ assignments = [], issues = [], requiredSlots = 0 } = {}) {
  const totalSlots = requiredSlots || assignments.length || 1;
  const unfilled   = issues.filter((i) => Number(i?.missing || 0) > 0).reduce((s, i) => s + Number(i.missing), 0);

  const coverageScore = Math.max(0, 1 - unfilled / totalSlots);           // 0-1

  const personCounts = {};
  for (const a of assignments) {
    const k = String(a?.personId || a?.personName || '?');
    personCounts[k] = (personCounts[k] || 0) + 1;
  }
  const counts = Object.values(personCounts);
  let fairnessScore = 1;
  if (counts.length > 1) {
    const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
    const variance = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // coefficient of variation
    fairnessScore = Math.max(0, 1 - cv);
  }

  const score = Math.round((coverageScore * 0.65 + fairnessScore * 0.35) * 100);

  return {
    score,
    coverage:  Math.round(coverageScore  * 100),
    fairness:  Math.round(fairnessScore  * 100),
    unfilledSlots: unfilled,
    totalSlots,
  };
}

module.exports = { computeQualityScore };
