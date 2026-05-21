// routes/auth.routes.js
const express = require('express');
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { sendMail, isConfigured } = require('../utils/mailer');
const router  = express.Router();

const path = require('path');
const UserModel = require(path.join(__dirname, '..', 'models', 'User.js'));
const User = UserModel;
const hashToken = UserModel.hashToken;
const Person = require(path.join(__dirname, '..', 'models', 'Person.js'));
const Hospital = require(path.join(__dirname, '..', 'models', 'Hospital.js'));

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (JWT_SECRET ? JWT_SECRET + '_refresh' : null);
const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();
const IS_PROD = NODE_ENV === 'production';
const ALLOW_DEV = !IS_PROD && ['1','true','yes'].includes(String(process.env.ALLOW_DEV_ENDPOINTS || '').toLowerCase());
const DEV_EMAIL = String(process.env.ADMIN_EMAIL || '').toLowerCase();
const DEV_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const RATE_STORE = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000;

// Timing saldırısı için startup'ta bir kez üretilen gerçek bcrypt hash
let DUMMY_HASH = null;
(async () => { try { DUMMY_HASH = await bcrypt.hash('__warmup__', 10); } catch {} })();

// Süresi dolmuş rate-limit kayıtlarını temizle (OOM önleme)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of RATE_STORE) {
    if (v.resetAt <= now) RATE_STORE.delete(k);
  }
}, 60_000).unref();
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  IS_PROD ? fallback : (err?.message || fallback);

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

function getRateState(key, now = Date.now()) {
  const current = RATE_STORE.get(key);
  if (!current || current.resetAt <= now) {
    return { count: 0, resetAt: now + AUTH_WINDOW_MS };
  }
  return current;
}

function bumpRateState(key) {
  const now = Date.now();
  const state = getRateState(key, now);
  const next = { count: Number(state.count || 0) + 1, resetAt: state.resetAt };
  RATE_STORE.set(key, next);
  return next;
}

function clearRateState(key) {
  RATE_STORE.delete(key);
}

const registerRateLimit = authRateLimit({
  limit: 20,
  keyOf: (req) => `reg:${getClientIp(req)}`,
  message: 'Çok fazla kayıt denemesi, lütfen sonra tekrar deneyin',
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

// Sabit-zaman davet kodu karşılaştırması — uzunluk bilgisi sızdırmaz
function safeCompareInvite(input, expected) {
  if (!input || !expected) return false;
  const SIZE = 128;
  const a = Buffer.alloc(SIZE);
  const b = Buffer.alloc(SIZE);
  Buffer.from(input).copy(a);
  Buffer.from(expected).copy(b);
  return crypto.timingSafeEqual(a, b) && input.length === expected.length;
}
const lc = (s) => normalize(s).toLowerCase();
const ADMIN_INVITE_CODE = normalize(process.env.ADMIN_INVITE_CODE);
const STAFF_INVITE_CODE = normalize(process.env.STAFF_INVITE_CODE);
const makeAccessToken = (userOrId) => {
  const uid = typeof userOrId === 'string' ? userOrId : String(userOrId?._id || userOrId?.id || '');
  const payload = { uid };
  if (typeof userOrId === 'object' && userOrId !== null) {
    if (userOrId.role)      payload.role      = userOrId.role;
    if (userOrId.personId)  payload.personId  = String(userOrId.personId);
    if (userOrId.hospitalId) payload.hospitalId = String(userOrId.hospitalId);
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
};

const makeRefreshToken = (userOrId) => {
  const uid = typeof userOrId === 'string' ? userOrId : String(userOrId?._id || userOrId?.id || '');
  const tv = typeof userOrId === 'object' ? (Number(userOrId?.tokenVersion) || 0) : 0;
  return jwt.sign({ uid, type: 'refresh', tv }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
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
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded?.uid) return null;
    const user = await User.findById(decoded.uid);
    return user || null;
  } catch {
    return null; // expired/malformed → 401 yerine null döner, çağıran handler kontrol eder
  }
}

function withValidation(chains = []) {
  return [
    ...chains,
    (req, res, next) => {
      const errors = validationResult(req);
      if (errors.isEmpty()) return next();
      return res.status(400).json({
        message: 'Geçersiz istek',
        errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    },
  ];
}

const registerValidation = withValidation([
  body('name').optional({ checkFalsy: true }).isString().isLength({ min: 2, max: 120 }),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('tc').optional({ checkFalsy: true }).matches(/^\d{11}$/).withMessage('TC 11 hane olmalı'),
  body('phone').optional({ checkFalsy: true }).isString().isLength({ min: 10, max: 20 }),
  body('hospitalId').optional({ checkFalsy: true }).isMongoId().withMessage('hospitalId geçersiz'),
  body('password').isString().isLength({ min: 6, max: 128 }),
  body().custom((_v, { req }) => {
    if (!req.body?.email && !req.body?.tc && !req.body?.phone) {
      throw new Error('En az bir kimlik alanı gerekli (email/tc/phone)');
    }
    return true;
  }),
]);

const loginValidation = withValidation([
  body('password').isString().isLength({ min: 1, max: 128 }),
  body().custom((_v, { req }) => {
    const identifier = pickIdentifier(req.body || {});
    if (!identifier) throw new Error('Kimlik zorunlu');
    return true;
  }),
]);

const requestResetValidation = withValidation([
  body('email').isEmail().normalizeEmail(),
]);

const resetPasswordValidation = withValidation([
  body('token').isString().isLength({ min: 10, max: 512 }),
  body('newPassword').isString().isLength({ min: 6, max: 128 }),
]);

const changePasswordValidation = withValidation([
  body('newPassword').isString().isLength({ min: 6, max: 128 }),
  body().custom((_v, { req }) => {
    const oldPassword = normalize(req.body?.oldPassword ?? req.body?.currentPassword);
    if (!oldPassword) throw new Error('Eski şifre zorunlu');
    return true;
  }),
]);

/* ============= REGISTER (opsiyonel) ============= */
router.post('/register', registerRateLimit, ...registerValidation, async (req, res) => {
  try {
    const { name, email, tc, phone, password } = req.body || {};
    const hospitalId = normalize(req.body?.hospitalId);
    const pass = normalize(password);
    if (!name || !pass || !(email || tc || phone)) {
      return res.status(400).json({ message: 'Zorunlu alanlar eksik' });
    }

    const emailLC = email ? lc(email) : undefined;

    if (hospitalId) {
      const hospital = await Hospital.findOne({ _id: hospitalId, active: true }).lean();
      if (!hospital) {
        return res.status(400).json({ message: 'Geçersiz hospitalId' });
      }
    }

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
      hospitalId: hospitalId || null,
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
        hospitalId: user.hospitalId ? String(user.hospitalId) : null,
      },
    });
  } catch (err) {
    console.error('REGISTER ERR:', err);
    res.status(500).json({ message: 'Kayıt sırasında hata' });
  }
});

/* ============= LOGIN ============= */
router.post('/login', ...loginValidation, async (req, res) => {
  try {
    const identifier = pickIdentifier(req.body);
    const password   = normalize(req.body.password ?? req.body.parola);
    const rateKey = `login:${getClientIp(req)}:${String(identifier || '').toLowerCase()}`;
    const rateState = getRateState(rateKey);

    if (rateState.count >= 15) {
      const retrySec = Math.max(1, Math.ceil((rateState.resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      return res.status(429).json({ message: 'Çok fazla giriş denemesi, lütfen sonra tekrar deneyin' });
    }

    if (!identifier || !password) {
      bumpRateState(rateKey);
      return res.status(400).json({ message: 'Kimlik ve şifre zorunlu' });
    }

    // DB yoksa ve dev endpoints açıksa, hızlı dev login
    const dbReady = mongoose.connection?.readyState === 1;
    if (!dbReady && ALLOW_DEV && DEV_EMAIL && DEV_PASSWORD) {
      const idLc = String(identifier || '').toLowerCase();
      if (idLc === DEV_EMAIL && password === DEV_PASSWORD) {
        clearRateState(rateKey);
        const devUser = { _id: 'dev1', role: 'admin', personId: null };
        const accessToken  = makeAccessToken(devUser);
        const refreshToken = makeRefreshToken(devUser);
        return res.json({
          accessToken,
          refreshToken,
          token: accessToken,
          user: {
            id: 'dev1',
            name: 'Dev Kullanıcı',
            email: DEV_EMAIL,
            role: 'admin',
            active: true,
            personId: null,
            hospitalId: null,
          },
        });
      }
    }

    // identifier email ise email’e, değilse tc/phone’a bak
    const user = await User.findByIdentifier(identifier)
      .select('passwordHash +password active role name email tc phone serviceIds mustChangePassword personId');

    if (!user) {
      bumpRateState(rateKey);
      // Timing saldırısını önlemek için gerçek bcrypt hash ile karşılaştır
      await bcrypt.compare(password, DUMMY_HASH || '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lHHy');
      return res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      bumpRateState(rateKey);
      return res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
    }

    if (user.active === false) {
      bumpRateState(rateKey);
      return res.status(403).json({ message: 'Hesap pasif' });
    }

    clearRateState(rateKey);
    const accessToken  = makeAccessToken(user);
    const refreshToken = makeRefreshToken(user);
    return res.json({
      accessToken,
      refreshToken,
      token: accessToken,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        mustChangePassword: !!user.mustChangePassword,
        personId: user.personId ? String(user.personId) : null,
        hospitalId: user.hospitalId ? String(user.hospitalId) : null,
      },
    });
  } catch (err) {
    console.error('LOGIN ERR:', err);
    res.status(500).json({ message: 'Giriş sırasında hata' });
  }
});


/* ============= REFRESH TOKEN ============= */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(401).json({ message: 'Refresh token gerekli' });

    let decoded;
    try {
      decoded = jwt.verify(String(refreshToken), JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ message: 'Geçersiz refresh token' });
    }

    if (decoded?.type !== 'refresh' || !decoded?.uid) {
      return res.status(401).json({ message: 'Geçersiz refresh token' });
    }

    const user = await User.findById(decoded.uid).lean();
    if (!user || user.active === false) {
      return res.status(401).json({ message: 'Kullanıcı bulunamadı veya pasif' });
    }

    // tokenVersion kontrolü — logout sonrası eski refresh token'lar geçersiz
    if (decoded.tv !== undefined && (user.tokenVersion || 0) !== decoded.tv) {
      return res.status(401).json({ message: 'Oturum süresi doldu, lütfen tekrar giriş yapın' });
    }

    return res.json({ accessToken: makeAccessToken(user) });
  } catch (err) {
    console.error('REFRESH ERR:', err);
    return res.status(500).json({ message: 'Token yenilenemedi' });
  }
});

/* ============= PASSWORD RESET (token ile) ============= */
router.post('/password/request-reset', resetRequestRateLimit, ...requestResetValidation, async (req, res) => {
  try {
    const email = lc(req.body?.email || "");
    if (!email) return res.status(400).json({ message: 'E-posta zorunlu' });

    const user = await User.findOne({ email }).select('+passwordHash +password');
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      user.resetToken = hashToken(rawToken); // DB'de hash, e-postada raw
      user.resetTokenExp = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();

      const base = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
      const resetUrl = `${base}/reset/${rawToken}`;

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

    return res.json({ ok: true });
  } catch (err) {
    console.error('REQUEST RESET ERR:', err);
    return res.status(500).json({ message: 'Reset istegi basarisiz' });
  }
});

router.post('/password/reset', resetApplyRateLimit, ...resetPasswordValidation, async (req, res) => {
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
      resetToken: hashToken(String(token)), // DB'deki hash ile karşılaştır
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

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
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
    if (!ok) return res.status(401).json({ message: 'Eski şifre hatalı' });

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
router.post('/password/change', ...changePasswordValidation, handleChangePassword);
router.post('/change-password', ...changePasswordValidation, handleChangePassword);

router.post('/admin/accept-invite', async (req, res) => {
  try {
    if (!ADMIN_INVITE_CODE) {
      return res.status(404).json({ message: 'Admin davet akışı aktif değil' });
    }
    const code = normalize(req.body?.code);
    const codeOk = safeCompareInvite(code, ADMIN_INVITE_CODE);
    if (!codeOk) {
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
    return res.status(500).json({ message: safeMessage(err, 'Davet işlenemedi') });
  }
});

router.post('/staff/accept-invite', async (req, res) => {
  try {
    if (!STAFF_INVITE_CODE) {
      return res.status(404).json({ message: 'Staff davet akışı aktif değil' });
    }
    const code = normalize(req.body?.code);
    const codeOk = safeCompareInvite(code, STAFF_INVITE_CODE);
    if (!codeOk) {
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
    return res.status(500).json({ message: safeMessage(err, 'Davet işlenemedi') });
  }
});

/* ============= ME (token ile) ============= */
router.get('/me', async (req, res) => {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Yetkisiz' });

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.uid).lean();
    if (!user) return res.status(401).json({ message: 'Yetkisiz' });

    let person = null;
    const hospitalId = user?.hospitalId ? String(user.hospitalId) : '';
    const basePersonFilter = hospitalId ? { hospitalId } : {};

    // 1) User.personId varsa onu kullan (tek kaynak)
    if (user.personId) {
      person = await Person.findOne({ ...basePersonFilter, _id: user.personId }).lean();
    }

    // 2) Yoksa Person.userId ile bak
    if (!person) {
      person = await Person.findOne({ ...basePersonFilter, userId: user._id }).lean();
    }

    // 3) Hala yoksa tc / email / phone ile eşleştir
    if (!person) {
      const or = [];
      if (user.tc)    or.push({ tc: user.tc });
      if (user.email) or.push({ email: user.email });
      if (user.phone) or.push({ phone: user.phone });
      if (or.length)  person = await Person.findOne({ ...basePersonFilter, $or: or }).lean();
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
      role:               user.role,
      active:             user.active,
      serviceIds:         user.serviceIds || [],
      mustChangePassword: !!user.mustChangePassword,
      hospitalId:         user.hospitalId ? String(user.hospitalId) : null,
      personId:           person ? String(person._id)       : null,
      personName:         person ? person.name              : null,
      serviceId:          person ? (person.serviceId || '') : null,
    });
  } catch {
    res.status(401).json({ message: 'Yetkisiz' });
  }
});

/* ============= LOGOUT ============= */
router.post('/logout', async (req, res) => {
  try {
    const h = req.headers.authorization || '';
    const token = (h.startsWith('Bearer ') ? h.slice(7) : null) || req.query?.token || null;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        if (decoded?.uid) {
          await User.findByIdAndUpdate(decoded.uid, { $inc: { tokenVersion: 1 } });
        }
      } catch {}
    }
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: true });
  }
});

module.exports = router;
