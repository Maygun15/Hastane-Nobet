// utils/validate.js
function validateRegisterPayload(body = {}) {
  const errors = [];

  const normPhone = (v) => String(v || "").replace(/[^\d+]/g, "");

  const data = {
    name: (body.name || "").trim(),
    email: body.email ? String(body.email).trim().toLowerCase() : "",
    phone: body.phone ? normPhone(body.phone) : "",
    tc: body.tc ? String(body.tc).trim() : "",
    password: String(body.password || ""),
    role: body.role,
    serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds.filter(Boolean) : [],
  };

  // parola
  if (!data.password || data.password.length < 6) errors.push("Parola en az 6 karakter olmalı.");

  // en az bir tanımlayıcı
  if (!data.email && !data.phone && !data.tc) errors.push("En az bir tanımlayıcı (email/phone/tc) gerekli.");

  // tc
  if (data.tc && !/^\d{11}$/.test(data.tc)) errors.push("T.C. Kimlik 11 rakam olmalı.");

  // telefon (ör. +905551234567)
  if (data.phone && !/^\+?\d{10,15}$/.test(data.phone)) errors.push("Telefon formatı geçersiz.");

  return { ok: errors.length === 0, data, errors };
}

module.exports = { validateRegisterPayload };
