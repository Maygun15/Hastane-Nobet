function stripDiacritics(value = "") {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeServiceToken(value = "") {
  return stripDiacritics(value)
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function addToken(set, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return;
  set.add(normalizeServiceToken(raw));
}

export function buildServiceAliasSet(serviceLike) {
  const out = new Set();
  if (!serviceLike) return out;

  if (typeof serviceLike === "string" || typeof serviceLike === "number") {
    addToken(out, serviceLike);
    return out;
  }

  addToken(out, serviceLike.id);
  addToken(out, serviceLike._id);
  addToken(out, serviceLike.code);
  addToken(out, serviceLike.name);
  addToken(out, serviceLike.label);
  addToken(out, serviceLike.title);
  return out;
}

export function getRowServiceAliasSet(row) {
  const out = new Set();
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : row;
  const meta = raw?.meta && typeof raw.meta === "object"
    ? raw.meta
    : row?.meta && typeof row.meta === "object"
      ? row.meta
      : {};

  [
    row?.serviceId,
    row?.service,
    row?.serviceCode,
    row?.serviceName,
    row?.department,
    row?.departmentId,
    row?.sectionId,
    raw?.serviceId,
    raw?.service,
    raw?.serviceCode,
    raw?.serviceName,
    raw?.department,
    raw?.departmentId,
    raw?.sectionId,
    raw?.servis,
    raw?.Servis,
    meta?.serviceId,
    meta?.service,
    meta?.serviceCode,
    meta?.serviceName,
    meta?.department,
    meta?.departmentId,
    meta?.sectionId,
    meta?.unitId,
    meta?.unitName,
    meta?.code,
  ].forEach((value) => addToken(out, value));

  return out;
}

export function matchesServiceSelection({ row, serviceId, servicesById }) {
  const selectedId = String(serviceId ?? "").trim();
  if (!selectedId) return true;

  const rowAliases = getRowServiceAliasSet(row);
  if (!rowAliases.size) return false;

  const service =
    servicesById instanceof Map
      ? servicesById.get(selectedId) || servicesById.get(String(selectedId))
      : null;

  const expected = buildServiceAliasSet(service);
  addToken(expected, selectedId);

  for (const token of rowAliases) {
    if (expected.has(token)) return true;
  }
  return false;
}

export function matchesAnyServiceSelection({ row, serviceIds, servicesById }) {
  const ids = Array.isArray(serviceIds) ? serviceIds : [];
  if (!ids.length) return true;
  return ids.some((serviceId) =>
    matchesServiceSelection({ row, serviceId, servicesById })
  );
}
