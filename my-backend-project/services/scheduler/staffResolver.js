const Person = require('../../models/Person');

function normalizeRoleStr(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function roleTokens(role) {
  const r = normalizeRoleStr(role);
  if (!r) return [];
  if (r.includes("nurse") || r.includes("hemsire") || r.includes("hemşire")) {
    return ["nurse", "hemsire", "hemşire", "ebe", "att", "saglik", "sağlık"];
  }
  if (r.includes("doctor") || r.includes("doktor") || r.includes("hekim")) {
    return ["doctor", "doktor", "hekim", "tabip"];
  }
  return [r];
}

async function resolveStaff({ serviceId = '', role = '', hospitalId = null } = {}) {
  const query = hospitalId ? { hospitalId } : {};
  if (serviceId) query.serviceId = serviceId;
  const list = await Person.find(query).lean();
  if (!role) return { staff: list, debug: { rawCount: list.length, filteredCount: list.length, usedFallback: false, roleTokens: [] } };

  const tokens = roleTokens(role);
  const filtered = list.filter((p) => {
    const metaRole = normalizeRoleStr(p?.meta?.role || p?.meta?.unvan || p?.meta?.title || p?.role || p?.title || "");
    if (!metaRole) return true;
    return tokens.some((t) => metaRole.includes(t));
  });

  if (filtered.length === 0 && list.length) {
    return { staff: list, debug: { rawCount: list.length, filteredCount: 0, usedFallback: true, roleTokens: tokens } };
  }

  return { staff: filtered, debug: { rawCount: list.length, filteredCount: filtered.length, usedFallback: false, roleTokens: tokens } };
}

module.exports = {
  resolveStaff,
};
