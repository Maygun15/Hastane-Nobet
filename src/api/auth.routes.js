// src/api/auth.routes.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const User    = require('../../models/User.js');
const jwt     = require('jsonwebtoken');

// küçük yardımcılar (aynı isimlerle backend kopyası)
function normalizeEmail(s){ return (s||'').trim().toLowerCase(); }
function normalizePhone(s){
  const digits = String(s || '').replace(/\D+/g, '');
  if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0')  && digits.length === 11) return digits.slice(1);
  return digits;
}
function isValidEmail(s){ const e = normalizeEmail(s); return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidPhone(s){ const p = normalizePhone(s); return /^5\d{9}$/.test(p); }
function normalizeTC(s){ return String(s || '').replace(/\D+/g, ''); }
function isValidTC(s){ const tc = normalizeTC(s); return /^\d{11}$/.test(tc); }

function signJwtFor(user) {
  const payload = { uid: user._id, role: user.role };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

/* =========================
   KAYIT: email/phone/tc'den en az biri + ad + parola
   aktiflik: varsayılan FALSE → admin aktifleştirir
========================= */
router.post('/register', async (req, res) => {
  try {
    let { email, phone, tc, name, password, role } = req.body || {};

    email = normalizeEmail(email);
    phone = normalizePhone(phone);
    tc    = normalizeTC(tc);
    name  = (name || '').trim();

    // En az bir kimlik alanı şart
    if (!email && !phone && !tc) {
      return res.status(400).json({ error: 'E-posta, telefon veya T.C. kimlikten en az biri gerekli.' });
    }
    if (!name)     return res.status(400).json({ error: 'Ad Soyad zorunludur.' });
    if (!password) return res.status(400).json({ error: 'Parola zorunludur.' });

    if (email && !isValidEmail(email))  return res.status(400).json({ error: 'Geçersiz e-posta.' });
    if (phone && !isValidPhone(phone))  return res.status(400).json({ error: 'Geçersiz telefon (5XXXXXXXXX).' });
    if (tc    && !isValidTC(tc))        return res.status(400).json({ error: 'Geçersiz T.C. Kimlik (11 hane).' });

    // Çakışmaları net kontrol (sparse + unique index olsa da mesajı biz özelleştirelim)
    if (email && await User.findOne({ email })) return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı.' });
    if (phone && await User.findOne({ phone })) return res.status(409).json({ error: 'Bu telefon zaten kayıtlı.' });
    if (tc    && await User.findOne({ tc    })) return res.status(409).json({ error: 'Bu T.C. Kimlik zaten kayıtlı.' });

    const passwordHash = await bcrypt.hash(password, 10);

    // Rol isteğe bağlı — güvenlik için sadece adminler özel rol verebilmeli; burada yok sayabiliriz.
    // İstersen: role = 'user';
    const doc = await User.create({
      email: email || undefined,
      phone: phone || undefined,
      tc:    tc    || undefined,
      name,
      passwordHash,
      role: role || 'user',
      active: false,     // KAYIT SONRASI PASİF — admin aktifleştirecek
      serviceIds: [],
    });

    // Aktif edilmeden token vermeyelim; UI zaten pending akışını destekliyor.
    return res.status(201).json({ ok: true, pending: true, userId: String(doc._id) });

  } catch (err) {
    // Mongo duplicate key güvenlik ağı (E11000)
    if (err && err.code === 11000) {
      const k = Object.keys(err.keyValue || {})[0];
      const map = { email: 'Bu e-posta zaten kayıtlı.', phone: 'Bu telefon zaten kayıtlı.', tc: 'Bu T.C. Kimlik zaten kayıtlı.' };
      return res.status(409).json({ error: map[k] || 'Kayıt mevcut.' });
    }
    console.error('[REGISTER]', err);
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
});
