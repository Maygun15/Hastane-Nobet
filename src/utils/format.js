export function maskTC(tc) {
  const s = String(tc || "").trim();
  if (s.length !== 11) return s ? s.replace(/\d/g, "*") : "-";
  return s.slice(0, 3) + "******" + s.slice(9);
}
