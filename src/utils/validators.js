// src/utils/validate.js
// Basit ve hızlı kontroller: email, telefon (TR), T.C. kimlik, ad-soyad
// + normalize (kaydetmeden önce veriyi temizle)

function normalizeEmail(email) {
  if (!email) return '';
  return String(email).trim().toLowerCase();
}
function isValidEmail(email) {
  if (!email) return false;
  const s = String(email).trim();
  // hızlı/gevşek kontrol
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** TR telefon normalize:
 *  Kabul: 05XXXXXXXXX, 5XXXXXXXXX, +905XXXXXXXXX, 90 5XXXXXXXXX
 *  Dönüş: 5XXXXXXXXX (10 hane, 5 ile başlar)
 */
function normalizePhoneTR(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D+/g, '');
  // +90/90/0 kaldır
  let p = digits;
  if (p.startsWith('90') && p.length === 12) p = p.slice(2);
  if (p.startsWith('0') && p.length === 11) p = p.slice(1);
  return p;
}
function isValidPhoneTR(phone) {
  const p = normalizePhoneTR(phone);
  return /^5\d{9}$/.test(p); // 5 ile başlayan 10 hane (mobil)
}

/** T.C. Kimlik normalize: boşluk/simge temizleyip 11 hane bırakır */
function normalizeTC(tc) {
  if (!tc) return '';
  return String(tc).replace(/\D+/g, '').slice(0, 11);
}

/** T.C. Kimlik doğrulama:
 * - 11 hane, ilk hane 0 olamaz
 * - d10 = ((oddSum*7 - evenSum) % 10)
 * - d11 = (sumAll % 10)
 */
function isValidTC(tc) {
  const t = normalizeTC(tc);
  if (!/^\d{11}$/.test(t)) return false;
  if (t[0] === '0') return false;

  const nums = t.split('').map((d) => parseInt(d, 10));
  const oddSum  = nums[0] + nums[2] + nums[4] + nums[6] + nums[8];
  const evenSum = nums[1] + nums[3] + nums[5] + nums[7];

  const d10 = ((oddSum * 7) - evenSum) % 10;
  if (d10 !== nums[9]) return false;

  const total = nums.slice(0, 10).reduce((a, b) => a + b, 0);
  const d11 = total % 10;
  if (d11 !== nums[10]) return false;

  return true;
}

/** Ad Soyad normalize: trim + iç boşlukları tekle */
function normalizeName(name) {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ');
}

/** Kayıt payload kontrolü:
 *  - En az bir kimlik: email VEYA phone VEYA tc
 *  - Parola zorunlu
 *  - Email/phone/tc geçerliyse normalize edilir
 */
function validateRegisterPayload(payload = {}) {
  const errors = [];
  const out = {
    name: normalizeName(payload.name),
    email: normalizeEmail(payload.email),
    phone: normalizePhoneTR(payload.phone),
    tc: normalizeTC(payload.tc),
    password: String(payload.password || ''),
    role: payload.role, // route içinde ayrıca sınırlarız
  };

  // En az bir tanımlayıcı
  if (!out.email && !out.phone && !out.tc) {
    errors.push('En az bir kimlik alanı gerekli (email veya telefon veya T.C. kimlik).');
  }

  // Parola
  if (!out.password || out.password.length < 6) {
    errors.push('Parola en az 6 karakter olmalı.');
  }

  // Email geçerliyse uygula (boşsa sorun değil)
  if (out.email && !isValidEmail(out.email)) {
    errors.push('E-posta biçimi geçersiz.');
  }

  // Telefon geçerliyse uygula (boşsa sorun değil)
  if (out.phone && !isValidPhoneTR(out.phone)) {
    errors.push('Telefon numarası (TR) geçersiz. Örn: 5XXXXXXXXX');
  }

  // TC geçerliyse uygula (boşsa sorun değil)
  if (out.tc && !isValidTC(out.tc)) {
    errors.push('T.C. Kimlik Numarası geçersiz.');
  }

  return { ok: errors.length === 0, data: out, errors };
}

module.exports = {
  // normalize
  normalizeEmail,
  normalizePhoneTR,
  normalizeTC,
  normalizeName,
  // validators
  isValidEmail,
  isValidPhoneTR,
  isValidTC,
  // register checker
  validateRegisterPayload,
};
