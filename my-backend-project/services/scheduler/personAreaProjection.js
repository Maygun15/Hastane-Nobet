const normalizeLabelKey = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”"']/g, "")
    .replace(/[(){}[\].;:/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("tr-TR");

const toList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/[;,|/]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const EXCLUDED_LABELS = new Set([
  "DENEME",
].map(normalizeLabelKey));

function resolveSchedulerAreas(person, meta = {}) {
  const rawSources = [
    person?.areas,
    person?.workAreas,
    person?.workareas,
    person?.area,
    person?.section,
    person?.sections,
    meta?.areas,
    meta?.workAreas,
    meta?.workareas,
    meta?.area,
    meta?.section,
    meta?.sections,
  ];

  const schedulerAreas = [];
  const excludedLabels = [];
  const seen = new Set();
  let hadAreaSource = false;

  for (const source of rawSources) {
    const values = toList(source);
    if (values.length) hadAreaSource = true;

    for (const value of values) {
      const label = String(value || "").trim();
      if (!label) continue;
      const key = normalizeLabelKey(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      if (EXCLUDED_LABELS.has(key)) {
        excludedLabels.push(label);
        continue;
      }

      schedulerAreas.push(label);
    }
  }

  return { schedulerAreas, excludedLabels, hadAreaSource };
}

module.exports = {
  resolveSchedulerAreas,
};
