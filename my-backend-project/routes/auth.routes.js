// routes/auth.routes.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const mongoose = require('mongoose');
const { sendMail, isConfigured } = require('../utils/mailer');
const router  = express.Router();

const path = require('path');
const User = require(path.join(__dirname, '..', 'models', 'User.js'));

const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();
const IS_PROD = NODE_ENV === 'production';
const ALLOW_DEV = !IS_PROD && ['1','true','yes'].includes(String(process.env.ALLOW_DEV_ENDPOINTS || '').toLowerCase());
const DEV_EMAIL = String(process.env.ADMIN_EMAIL || '').toLowerCase();
const DEV_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const RATE_STORE = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET tanımlı değil');
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
}

function authRateLimit({ limit, keyOf, message }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = String(keyOf(req) || '');
    const cur = RATE_STORE.get(key);
    if (!cur || cur.resetAt <= now) {
      RATE_STORE.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
      return next();
    }
    if (cur.count >= limit) {
      const retrySec = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      return res.status(429).json({ message });
    }
    cur.count += 1;
    RATE_STORE.set(key, cur);
    return next();
  };
}

const registerRateLimit = authRateLimit({
  limit: 20,
  keyOf: (req) => `reg:${getClientIp(req)}`,
  message: 'Çok fazla kayıt denemesi, lütfen sonra tekrar deneyin',
});
const loginRateLimit = authRateLimit({
  limit: 15,
  keyOf: (req) => {
    const identifier = pickIdentifier(req.body || {});
    return `login:${getClientIp(req)}:${String(identifier || '').toLowerCase()}`;
  },
  message: 'Çok fazla giriş denemesi, lütfen sonra tekrar deneyin',
});
const resetRequestRateLimit = authRateLimit({
  limit: 10,
  keyOf: (req) => `reset-req:${getClientIp(req)}:${lc(req.body?.email || '')}`,
  message: 'Çok fazla şifre sıfırlama isteği, lütfen sonra tekrar deneyin',
});
const resetApplyRateLimit = authRateLimit({
  limit: 10,
  keyOf: (req) => `reset-apply:${getClientIp(req)}:${normalize(req.body?.token || '')}`,
  message: 'Çok fazla şifre sıfırlama denemesi, lütfen sonra tekrar deneyin',
});

/* ============ Helpers ============ */
const normalize = (s) => (s ?? '').toString().trim();
const lc = (s) => normalize(s).toLowerCase();
const ADMIN_INVITE_CODE = normalize(process.env.ADMIN_INVITE_CODE);
const STAFF_INVITE_CODE = normalize(process.env.STAFF_INVITE_CODE);
const makeToken = (userOrId, extra = {}) => {
  if (typeof userOrId === 'string') {
    return jwt.sign({ uid: userOrId, ...extra }, JWT_SECRET, { expiresIn: '7d' });
  }
  const uid = String(userOrId?._id || userOrId?.id || '');
  const payload = { uid };
  if (userOrId?.role) payload.role = userOrId.role;
  if (userOrId?.personId) payload.personId = String(userOrId.personId);
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

// Frontend bazen "identifier", bazen "kimlik", bazen "tc" gönderiyor olabilir
function pickIdentifier(body) {
  return (
    normalize(body.identifier) ||
    normalize(body.kimlik) ||
    normalize(body.tc) ||
    normalize(body.email) ||
    normalize(body.phone)
  );
}

async function getAuthUserFromRequest(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const decoded = jwt.verify(token, JWT_SECRET);
  if (!decoded?.uid) return null;
  const user = await User.findById(decoded.uid);
  return user || null;
}

/* ============= REGISTER (opsiyonel) ============= */
router.post('/register', registerRateLimit, async (req, res) => {
  try {
    const { name, email, tc, phone, password } = req.body || {};
    const pass = normalize(password);
    if (!name || !pass || !(email || tc || phone)) {
      return res.status(400).json({ message: 'Zorunlu alanlar eksik' });
    }

    const emailLC = email ? lc(email) : undefined;

    const exists = await User.findOne({
      $or: [
        ...(emailLC ? [{ email: emailLC }] : []),
        ...(tc      ? [{ tc }] : []),
        ...(phone   ? [{ phone }] : []),
      ],
    }).lean();

    if (exists) return res.status(409).json({ message: 'Bu kullanıcı zaten kayıtlı' });

    const hash = await bcrypt.hash(pass, 10);
    const user = await User.create({
      name,
      email: emailLC,
      tc: tc || undefined,
      phone: phone || undefined,
      passwordHash: hash,              // 🔧 doğru alan
      role: 'user',
      active: false,
      serviceIds: [],
      mustChangePassword: true,
    });

    return res.status(201).json({
      ok: true,
      pending: true,
      message: 'Kayıt alındı. Hesabınız yönetici onayı bekliyor.',
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        tc: user.tc,
        phone: user.phone,
        role: user.role,
        active: user.active,
        mustChangePassword: !!user.mustChangePassword,
        personId: user.personId ? String(user.personId) : null,
      },
    });
  } catch (err) {
    console.error('REGISTER ERR:', err);
    res.status(500).json({ message: 'Kayıt sırasında hata' });
  }
});

/* ============= LOGIN ============= */
router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const identifier = pickIdentifier(req.body);
    const password   = normalize(req.body.password ?? req.body.parola);

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Kimlik ve şifre zorunlu' });
    }

    // DB yoksa ve dev endpoints açıksa, hızlı dev login
    const dbReady = mongoose.connection?.readyState === 1;
    if (!dbReady && ALLOW_DEV && DEV_EMAIL && DEV_PASSWORD) {
      const idLc = String(identifier || '').toLowerCase();
      if (idLc === DEV_EMAIL && password === DEV_PASSWORD) {
        const token = makeToken({ _id: 'dev1', role: 'admin', personId: null });
        return res.json({
          token,
          user: {
            id: 'dev1',
            name: 'Dev Kullanıcı',
            email: DEV_EMAIL,
            role: 'admin',
            active: true,
            personId: null,
          },
        });
      }
    }

    // identifier email ise email’e, değilse tc/phone’a bak
    const user = await User.findByIdentifier(identifier)
      .select('passwordHash +password active role name email tc phone serviceIds mustChangePassword personId');

    if (!user) return res.status(401).json({ message: 'Kullanıcı bulunamadı' });

    let ok = await user.comparePassword(password);
    if (!ok) {
      const adminEmail = String(process.env.ADMIN_EMAIL || '').toLowerCase();
      const adminPass  = process.env.ADMIN_PASSWORD;
      if (adminPass && user.email && user.email.toLowerCase() === adminEmail && password === adminPass && process.env.NODE_ENV !== 'production') {
        await user.setPassword(password);
        user.password = undefined;
        await user.save();
        ok = true;
      }
    }
    if (!ok) return res.status(401).json({ message: 'Şifre hatalı' });

    if (user.active === false) return res.status(403).json({ message: 'Hesap pasif' });

    const token = makeToken(user);
    return res.json({
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        tc: user.tc,
        phone: user.phone,
        role: user.role,
        active: user.active,
        mustChangePassword: !!user.mustChangePassword,
        personId: user.personId ? String(user.personId) : null,
      },
    });
  } catch (err) {
    console.error('LOGIN ERR:', err);
    res.status(500).json({ message: 'Giriş sırasında hata' });
  }
});


/* ============= PASSWORD RESET (token ile) ============= */
router.post('/password/request-reset', resetRequestRateLimit, async (req, res) => {
  try {
    const email = lc(req.body?.email || "");
    if (!email) return res.status(400).json({ message: 'E-posta zorunlu' });

    const user = await User.findOne({ email }).select('+passwordHash +password');
    if (user) {
      user.resetToken = crypto.randomBytes(20).toString('hex');
      user.resetTokenExp = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();

      const base = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
      const resetUrl = `${base}/reset/${user.resetToken}`;

      if (isConfigured() && user.email) {
        try {
          await sendMail({
            to: user.email,
            subject: 'Sifre sifirlama',
            text: `Merhaba,

Sifrenizi sifirlamak icin asagidaki baglantiyi kullanin:
${resetUrl}

Bu baglanti 15 dakika gecerlidir.`,
          });
        } catch (e) {
          console.error('MAIL ERR:', e?.message || e);
        }
      }
    }

    const resp = { ok: true };
    if (process.env.NODE_ENV !== 'production' && user?.resetToken) {
      resp.resetToken = user.resetToken; // DEV kolayligi
    }
    return res.json(resp);
  } catch (err) {
    console.error('REQUEST RESET ERR:', err);
    return res.status(500).json({ message: 'Reset istegi basarisiz' });
  }
});

router.post('/password/reset', resetApplyRateLimit, async (req, res) => {
  try {
    const { token } = req.body || {};
    const newPassword = normalize(req.body?.newPassword);
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token ve yeni şifre zorunlu' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Yeni şifre en az 6 karakter olmalı' });
    }

    const user = await User.findOne({
      resetToken: String(token),
      resetTokenExp: { $gt: new Date() },
    }).select('+passwordHash +password');

    if (!user) return res.status(400).json({ message: 'Token geçersiz veya süresi dolmuş' });

    await user.setPassword(String(newPassword));
    user.mustChangePassword = false;
    user.password = undefined;
    user.resetToken = undefined;
    user.resetTokenExp = undefined;
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('RESET PASSWORD ERR:', err);
    return res.status(500).json({ message: 'Şifre sıfırlanamadı' });
  }
});

/* ============= CHANGE PASSWORD (login gerektirir) ============= */
async function handleChangePassword(req, res) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Yetkisiz' });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded?.uid) return res.status(401).json({ message: 'Yetkisiz' });

    const body = req.body || {};
    const oldPassword = normalize(body.oldPassword ?? body.currentPassword);
    const newPassword = normalize(body.newPassword);
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Eski ve yeni şifre zorunlu' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Yeni şifre en az 6 karakter olmalı' });
    }

    const user = await User.findById(decoded.uid).select('+passwordHash +password');
    if (!user) return res.status(401).json({ message: 'Kullanıcı bulunamadı' });

    const ok = await user.comparePassword(String(oldPassword));
    if (!ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('CHANGE PASSWORD: eski şifre doğrulanamadı, dev mod bypass');
      } else {
        return res.status(401).json({ message: 'Eski şifre hatalı' });
      }
    }

    await user.setPassword(String(newPassword));
    user.mustChangePassword = false;
    user.password = undefined; // düz metin fallback'ini temizle
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('CHANGE PASSWORD ERR:', err);
    return res.status(500).json({ message: 'Şifre değiştirilemedi' });
  }
}

// Eski ve yeni client'lar için iki route'u da destekle
router.post('/password/change', handleChangePassword);
router.post('/change-password', handleChangePassword);

router.post('/admin/accept-invite', async (req, res) => {
  try {
    if (!ADMIN_INVITE_CODE) {
      return res.status(404).json({ message: 'Admin davet akışı aktif değil' });
    }
    const code = normalize(req.body?.code);
    if (!code || code !== ADMIN_INVITE_CODE) {
      return res.status(400).json({ message: 'Geçersiz davet kodu' });
    }
    const user = await getAuthUserFromRequest(req);
    if (!user) return res.status(401).json({ message: 'Yetkisiz' });
    user.role = 'admin';
    user.active = true;
    await user.save();
    return res.json({
      ok: true,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Davet işlenemedi' });
  }
});

router.post('/staff/accept-invite', async (req, res) => {
  try {
    if (!STAFF_INVITE_CODE) {
      return res.status(404).json({ message: 'Staff davet akışı aktif değil' });
    }
    const code = normalize(req.body?.code);
    if (!code || code !== STAFF_INVITE_CODE) {
      return res.status(400).json({ message: 'Geçersiz davet kodu' });
    }
    const user = await getAuthUserFromRequest(req);
    if (!user) return res.status(401).json({ message: 'Yetkisiz' });
    user.role = 'staff';
    user.active = true;
    await user.save();
    return res.json({
      ok: true,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Davet işlenemedi' });
  }
});

/* ============= ME (token ile) ============= */
router.get('/me', async (req, res) => {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Yetkisiz' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.uid).lean();
    if (!user) return res.status(401).json({ message: 'Yetkisiz' });

    const Person = require('../models/Person');
    let person = null;

    // 1) User.personId varsa onu kullan (tek kaynak)
    if (user.personId) {
      person = await Person.findById(user.personId).lean();
    }

    // 2) Yoksa Person.userId ile bak
    if (!person) {
      person = await Person.findOne({ userId: user._id }).lean();
    }

    // 3) Hala yoksa tc / email / phone ile eşleştir
    if (!person) {
      const or = [];
      if (user.tc)    or.push({ tc: user.tc });
      if (user.email) or.push({ email: user.email });
      if (user.phone) or.push({ phone: user.phone });
      if (or.length)  person = await Person.findOne({ $or: or }).lean();
    }

    // 4) Eşleşme varsa iki tarafı da düzelt (lazy fix)
    if (person) {
      if (!user.personId || String(user.personId) !== String(person._id)) {
        await User.findByIdAndUpdate(user._id, { personId: person._id });
      }
      if (!person.userId || String(person.userId) !== String(user._id)) {
        await Person.findByIdAndUpdate(person._id, { userId: user._id });
      }
    }

    res.json({
      id:                 String(user._id),
      name:               user.name,
      email:              user.email,
      tc:                 user.tc,
      phone:              user.phone,
      role:               user.role,
      active:             user.active,
      serviceIds:         user.serviceIds || [],
      mustChangePassword: !!user.mustChangePassword,
      personId:           person ? String(person._id)       : null,
      personName:         person ? person.name              : null,
      serviceId:          person ? (person.serviceId || '') : null,
    });
  } catch {
    res.status(401).json({ message: 'Yetkisiz' });
  }
});

module.exports = router;
