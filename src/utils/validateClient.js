// src/utils/validateClient.js (ESM)
// Email / Telefon(TR) / T.C. Kimlik / İsim doğrulama + normalize

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
export function isValidEmail(email) {
  const s = String(email || "").trim();
  return !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function normalizePhoneTR(phone) {
  if (!phone) return "";
  let p = String(phone).replace(/\D+/g, "");
  if (p.startsWith("90") && p.length === 12) p = p.slice(2);
  if (p.startsWith("0") && p.length === 11) p = p.slice(1);
  return p;
}
export function isValidPhoneTR(phone) {
  const p = normalizePhoneTR(phone);
  return /^5\d{9}$/.test(p); // 5XXXXXXXXX
}

export function normalizeTC(tc) {
  return String(tc || "").replace(/\D+/g, "").slice(0, 11);
}
export function isValidTC(tc) {
  const t = normalizeTC(tc);
  if (!/^\d{11}$/.test(t)) return false;
  if (t[0] === "0") return false;
  const n = t.split("").map((d) => parseInt(d, 10));
  const odd  = n[0] + n[2] + n[4] + n[6] + n[8];
  const even = n[1] + n[3] + n[5] + n[7];
  const d10 = ((odd * 7) - even) % 10;
  if (d10 !== n[9]) return false;
  const sum10 = n.slice(0, 10).reduce((a, b) => a + b, 0);
  const d11 = sum10 % 10;
  return d11 === n[10];
}

export function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

/** Form doğrulaması
 * Zorunlular:
 *  - En az bir kimlik: email veya phone veya tc
 *  - password: min 6
 */
export function validateRegisterForm({ name, email, phone, tc, password }) {
  const data = {
    name: normalizeName(name),
    email: normalizeEmail(email),
    phone: normalizePhoneTR(phone),
    tc: normalizeTC(tc),
    password: String(password || ""),
  };

  const errors = {};
  if (!data.email && !data.phone && !data.tc) {
    errors._ = "E-posta veya telefon veya T.C. kimlikten en az biri zorunlu.";
  }
  if (data.email && !isValidEmail(data.email)) {
    errors.email = "E-posta geçersiz.";
  }
  if (data.phone && !isValidPhoneTR(data.phone)) {
    errors.phone = "Telefon (TR) geçersiz. Örn: 5XXXXXXXXX";
  }
  if (data.tc && !isValidTC(data.tc)) {
    errors.tc = "T.C. kimlik numarası geçersiz.";
  }
  if (!data.password || data.password.length < 6) {
    errors.password = "Parola en az 6 karakter olmalı.";
  }

  return { ok: Object.keys(errors).length === 0, data, errors };
}
