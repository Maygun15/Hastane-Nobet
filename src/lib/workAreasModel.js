const clean = (s) => (s ?? "").toString().trim();

const slugifyTR = (s = "") => {
  const tr = {
    ğ: "g", ü: "u", ş: "s", ı: "i", ö: "o", ç: "c",
    Ğ: "g", Ü: "u", Ş: "s", İ: "i", I: "i", Ö: "o", Ç: "c",
  };
  return (s || "")
    .trim()
    .replace(/[ĞÜŞİIÖÇğüşıiöç]/g, (m) => tr[m] || m)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
};

const uniqByTR = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = clean(value);
    const key = normalized.toLocaleLowerCase("tr-TR");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

const uniqIds = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

function normalizeWorkAreaMasterList(workAreas) {
  const raw = Array.isArray(workAreas) ? workAreas : [];
  const seen = new Set();
  const out = [];

  for (const item of raw) {
    const name =
      typeof item === "string"
        ? clean(item)
        : clean(item?.name || item?.label || item?.title || item?.id);
    if (!name) continue;

    const id =
      typeof item === "object" && item?.id
        ? String(item.id).trim()
        : slugifyTR(name);
    if (!id) continue;

    const dedupeKey = `${id.toLocaleLowerCase("tr-TR")}::${name.toLocaleLowerCase("tr-TR")}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ id, name, key: slugifyTR(name) || id });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
}

function resolvePersonWorkAreaIds(person, masterAreas = []) {
  const rawIds = [
    person?.workAreaIds,
    person?.areaIds,
    person?.meta?.workAreaIds,
    person?.meta?.areaIds,
  ];

  const explicitIds = [];
  for (const source of rawIds) {
    const items = Array.isArray(source) ? source : source ? [source] : [];
    for (const item of items) {
      const id = typeof item === "string" ? item : item?.id;
      if (id != null) explicitIds.push(String(id));
    }
  }

  const normalizedIds = uniqIds(explicitIds);
  if (normalizedIds.length) return normalizedIds;

  const master = normalizeWorkAreaMasterList(masterAreas);
  if (!master.length) return [];

  const idByName = new Map(
    master.map((item) => [item.name.toLocaleLowerCase("tr-TR"), item.id])
  );

  const derivedNames = [
    person?.areas,
    person?.meta?.areas,
    person?.workAreas,
    person?.workareas,
    person?.meta?.workAreas,
    person?.meta?.workareas,
  ];

  const names = [];
  for (const source of derivedNames) {
    const items = Array.isArray(source) ? source : source ? [source] : [];
    for (const item of items) {
      const name =
        typeof item === "string"
          ? clean(item)
          : clean(item?.name || item?.label || item?.title || item?.id);
      if (name) names.push(name);
    }
  }

  return uniqIds(
    uniqByTR(names)
      .map((name) => idByName.get(name.toLocaleLowerCase("tr-TR")))
      .filter(Boolean)
  );
}

function resolvePersonWorkAreaNames(person, masterAreas = []) {
  const rawNames = [
    person?.areas,
    person?.meta?.areas,
    person?.workAreas,
    person?.workareas,
    person?.meta?.workAreas,
    person?.meta?.workareas,
  ];

  const names = [];
  for (const source of rawNames) {
    const items = Array.isArray(source) ? source : source ? [source] : [];
    for (const item of items) {
      const name =
        typeof item === "string"
          ? clean(item)
          : clean(item?.name || item?.label || item?.title || item?.id);
      if (name) names.push(name);
    }
  }

  const normalizedNames = uniqByTR(names);
  if (normalizedNames.length) return normalizedNames;

  const master = normalizeWorkAreaMasterList(masterAreas);
  if (!master.length) return [];

  const ids = resolvePersonWorkAreaIds(person, master);
  const nameById = new Map(master.map((item) => [String(item.id), item.name]));
  return uniqByTR(ids.map((id) => nameById.get(String(id))).filter(Boolean));
}

export {
  normalizeWorkAreaMasterList,
  resolvePersonWorkAreaNames,
  resolvePersonWorkAreaIds,
};
