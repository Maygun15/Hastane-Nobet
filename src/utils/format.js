export function maskTC(tc) {
  const s = String(tc || "").trim();
  if (s.length !== 11) return s ? s.replace(/\d/g, "*") : "-";
  return s.slice(0, 3) + "******" + s.slice(9);
}

export function maskPhone(value) {
  const s = String(value || "").trim();
  if (!s) return "-";
  if (s.length <= 6) return s.replace(/.(?=...)/g, "*");
  return `${s.slice(0, 3)}${"*".repeat(Math.max(0, s.length - 6))}${s.slice(-3)}`;
}

export function maskEmail(value) {
  const s = String(value || "").trim();
  if (!s) return "-";
  const at = s.indexOf("@");
  if (at <= 0) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at);
  const visible = Math.min(3, Math.max(1, local.length));
  return `${local.slice(0, visible)}***${domain}`;
}
