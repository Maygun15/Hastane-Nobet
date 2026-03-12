// src/api/auth.routes.js
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const User     = require('../models/User.js');
const { validateRegisterPayload } = require('../utils/validate.js');
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET tanımlı değil');
}

/* =========================
   Helpers
========================= */
function signJwtFor(user) {
  const payload = { uid: String(user._id), role: user.role };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)/i);
  return m ? m[1] : null;
}

function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Basit login doğrulayıcı (identifier + password)
function validateLoginPayload(body = {}) {
  const errors = [];
  const identifier = String(body.identifier || body.kimlik || '').trim();
  const password   = String(body.password   || body.parola || '');
  if (!identifier) errors.push('Kimlik (e-posta / telefon / TCKN) zorunludur.');
  if (!password)   errors.push('Parola zorunludur.');
  return {
    ok: errors.length === 0,
    errors,
    data: { identifier, password }
  };
}

/* =========================
   REGISTER
========================= */
/**
 * Body: { name?, email?, phone?, tc?, password, serviceIds? }
 * - En az bir tanımlayıcı (email/phone/tc) zorunlu
 * - İlk kullanıcı: admin + active = true, token döner
 * - Diğer kullanıcılar: role = 'user', active = false (onay bekler)
 */
router.post('/register', async (req, res) => {
  // 1) Normalize + doğrula
  const { ok, data, errors } = validateRegisterPayload(req.body || {});
  if (!ok) return res.status(400).json({ error: errors.join(' ') });

  // 2) Benzer kayıt var mı? (email/phone/tc)
  const or = [];
  if (data.email) or.push({ email: data.email });
  if (data.phone) or.push({ phone: data.phone });
  if (data.tc)    or.push({ tc:    data.tc    });

  if (or.length) {
    const exists = await User.findOne({ $or: or }).lean();
    if (exists) {
      let field = 'bilgiler';
      if (data.email && exists.email === data.email) field = 'E-posta';
      else if (data.phone && exists.phone === data.phone) field = 'Telefon';
      else if (data.tc && exists.tc === data.tc) field = 'T.C. Kimlik';
      return res.status(409).json({ error: `${field} zaten kayıtlı.` });
    }
  }

  // 3) İlk kullanıcı mı?
  const count   = await User.countDocuments({});
  const isFirst = count === 0;

  // 4) Parola hashle
  const passwordHash = await bcrypt.hash(data.password, 10);

  // 5) Kayıt oluştur
  const doc = new User({
    name:   data.name  || undefined,
    email:  data.email || undefined,
    phone:  data.phone || undefined,
    tc:     data.tc    || undefined,
    role:   isFirst ? 'admin' : 'user',   // dışarıdan rol alma
    active: isFirst ? true : false,       // ilk kullanıcı aktif
    passwordHash,
    password: undefined,                  // düz metin parola tutmayalım
    serviceIds: Array.isArray(data.serviceIds) ? data.serviceIds : [], // 🔹 EKLENDİ
  });

  try {
    await doc.save();
  } catch (err) {
    // Unique index çakışmaları için emniyet kemeri
    if (err && err.code === 11000) {
      const key = Object.keys(err.keyPattern || {})[0];
      const map = { email: 'E-posta', phone: 'Telefon', tc: 'T.C. Kimlik' };
      return res.status(409).json({ error: `${map[key] || key} zaten kayıtlı.` });
    }
    console.error('[REGISTER]', err);
    return res.status(500).json({ error: 'Kayıt oluşturulamadı.' });
  }

  // 6) Yanıt
  if (isFirst) {
    const token = signJwtFor(doc);
    return res.status(201).json({
      token,
      user: {
        id: String(doc._id),
        role: doc.role,
        active: doc.active,
        email: doc.email,
        phone: doc.phone,
        tc: doc.tc,
        name: doc.name,
        serviceIds: doc.serviceIds || [],
      }
    });
  } else {
    return res.status(201).json({
      ok: true,
      pending: true,
      message: 'Kayıt alındı. Hesap onay bekliyor (admin aktifleştirecek).'
    });
  }
});

/* =========================
   LOGIN (identifier)
========================= */
/**
 * Body: { identifier, password }
 * identifier: e-posta / telefon / TCKN olabilir
 */
router.post('/login', async (req, res) => {
  const { ok, data, errors } = validateLoginPayload(req.body || {});
  if (!ok) return res.status(400).json({ error: errors.join(' ') });

  const raw = data.identifier;
  const v = String(raw).trim();
  let query;

  if (v.includes('@')) {
    // e-posta
    query = { email: v.toLowerCase() };
  } else if (/^\d{11}$/.test(v)) {
    // TCKN (11 rakam)
    query = { tc: v };
  } else {
    // telefon: + ve rakam harici temizle
    const phone = v.replace(/[^\d+]/g, '');
    if (/^\+?\d{10,15}$/.test(phone)) {
      query = { phone };
    } else {
      // son çare: üç alanda da olası eşleşme dene
      query = { $or: [{ email: v.toLowerCase() }, { tc: v }, { phone }] };
    }
  }

  try {
    const user = await User.findOne(query).select('+passwordHash +password').exec();
    if (!user) return res.status(401).json({ error: 'Giriş bilgileri hatalı.' });

    const passOk = await user.comparePassword(data.password);
    if (!passOk) return res.status(401).json({ error: 'Giriş bilgileri hatalı.' });

    if (!user.active) return res.status(403).json({ error: 'Hesap pasif veya onay bekliyor.' });

    const token = signJwtFor(user);
    return res.json({
      token,
      user: {
        id: String(user._id),
        role: user.role,
        active: user.active,
        email: user.email,
        phone: user.phone,
        tc: user.tc,
        name: user.name,
        serviceIds: user.serviceIds || [],
      }
    });
  } catch (err) {
    console.error('[LOGIN]', err);
    return res.status(500).json({ error: 'Giriş sırasında hata.' });
  }
});

/* =========================
   ME (token doğrula)
========================= */
router.get('/me', async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Token gerekli.' });

    const payload = verifyJwt(token);
    const user = await User.findById(payload.uid).lean();
    if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });

    return res.json({
      user: {
        id: String(user._id),
        role: user.role,
        active: user.active,
        email: user.email,
        phone: user.phone,
        tc: user.tc,
        name: user.name,
        serviceIds: user.serviceIds || [],
      }
    });
  } catch (err) {
    return res.status(401).json({ error: 'Token doğrulanamadı.' });
  }
});

module.exports = router;
