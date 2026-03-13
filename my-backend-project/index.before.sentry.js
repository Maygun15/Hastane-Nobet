CTRL + X// index.js — CJS, Express 5 (auth router + clean CORS + RBAC + FLEX DEV LOGIN)
const path = require('path');
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '.env') });
if (dotenvResult?.error) {
  console.error('[BOOT] dotenv error:', dotenvResult.error);
}
// Bazı ortamlarda .env değerleri yüklenmiyor görünebiliyor → güvenli fallback
if (!process.env.MONGODB_URI) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
}

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { isConfigured: isMailerConfigured } = require(path.join(__dirname, 'utils', 'mailer.js'));
const { applyHospitalContext, extractHospital, withHospitalFilter } = require(path.join(__dirname, 'middleware', 'hospital.js'));

const app  = express();
const PORT = Number(process.env.PORT || 3000);

/* ================= ENV ================= */
const MONGODB_URI     = process.env.MONGODB_URI;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://hastane-nobet.vercel.app";
const JWT_SECRET      = process.env.JWT_SECRET;
const NODE_ENV        = String(process.env.NODE_ENV || '').toLowerCase();
const IS_PROD         = NODE_ENV === 'production';
const SKIP_DB         = ['1','true','yes'].includes(String(process.env.SKIP_DB || '').toLowerCase());
const ALLOW_DEV_RAW   = ['1','true','yes'].includes(String(process.env.ALLOW_DEV_ENDPOINTS || '').toLowerCase());
const ALLOW_DEV       = !IS_PROD && ALLOW_DEV_RAW;
const ADMIN_EMAIL     = process.env.ADMIN_EMAIL || 'admin@admin.com';
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD;
const RESET_ADMIN_PW  = ['1','true','yes'].includes(String(process.env.RESET_ADMIN_PASSWORD || '').toLowerCase());
const DEV_LOGIN_IDENTIFIER = String(process.env.DEV_LOGIN_IDENTIFIER || ADMIN_EMAIL || '').toLowerCase().trim();
const BODY_LIMIT      = String(process.env.BODY_LIMIT || '256kb');
const API_RATE_WINDOW_MS = Number(process.env.API_RATE_WINDOW_MS || 15 * 60 * 1000);
const API_RATE_MAX = Number(process.env.API_RATE_MAX || 300);
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const NOTIFICATIONS_ENABLED = ENABLED_VALUES.has(String(process.env.NOTIFICATIONS_ENABLED || '').toLowerCase());

if (!JWT_SECRET) {
  console.error('HATA: JWT_SECRET tanımlı değil');
  process.exit(1);
}
if (IS_PROD && ALLOW_DEV_RAW) {
  console.warn('UYARI: NODE_ENV=production iken ALLOW_DEV_ENDPOINTS aktif, dev endpointler zorla kapatıldı.');
}

console.log('[BOOT] CWD:', process.cwd());
console.log('[BOOT] .env path:', path.join(__dirname, '.env'));
console.log('[BOOT] ENV OK?', { MONGODB_URI: !!MONGODB_URI, FRONTEND_ORIGIN });

/* ================= DB ================= */
if (!SKIP_DB) {
  if (!MONGODB_URI) {
    console.error('HATA: MONGODB_URI tanımlı değil');
    if (!ALLOW_DEV) process.exit(1);
  } else {
    mongoose.connect(MONGODB_URI, { dbName: 'hastane', serverSelectionTimeoutMS: 10000 })
      .then(async () => {
        console.log('✅ MongoDB bağlı');
        await createAdmin();
      })
      .catch((err) => {
        console.error('❌ MongoDB hatası:', err.message);
        if (!ALLOW_DEV) process.exit(1);
      });
  }
} else {
  console.log('⚠️  SKIP_DB=1 → Mongo bağlantısı atlandı');
}

/* ============== MIDDLEWARE ============== */
function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}
const ALLOWED_ORIGINS = new Set(
  ['http://localhost:5173', 'http://localhost:5174', FRONTEND_ORIGIN]
    .map(normalizeOrigin)
    .filter(Boolean)
);
app.set('trust proxy', 1);
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/cURL
    const ok = ALLOWED_ORIGINS.has(normalizeOrigin(origin));
    if (ok) return cb(null, true);
    console.warn('[CORS] blocked origin:', origin);
    // Error fırlatmak yerine sessizce reddet; 500 üretmesin
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.disable('x-powered-by');
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
// Express 5 ile çakışan paketlere bağımlılığı azaltmak için hafif sanitize + HPP koruması
function sanitizeObjectInPlace(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) sanitizeObjectInPlace(item);
    return;
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
      continue;
    }
    sanitizeObjectInPlace(obj[key]);
  }
}
function collapseParamPollutionInPlace(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) return;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (Array.isArray(value)) {
      obj[key] = value.length ? value[0] : undefined;
      continue;
    }
    if (value && typeof value === 'object') collapseParamPollutionInPlace(value);
  }
}
app.use((req, _res, next) => {
  try {
    sanitizeObjectInPlace(req.body);
    sanitizeObjectInPlace(req.params);
    sanitizeObjectInPlace(req.query);
    collapseParamPollutionInPlace(req.query);
  } catch (err) {
    console.error('[SEC][sanitize-lite]', err?.message || err);
  }
  next();
});
app.use((req, _res, next) => { console.log('[REQ]', req.method, req.originalUrl); next(); });
const globalApiLimiter = rateLimit({
  windowMs: API_RATE_WINDOW_MS,
  max: API_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Çok fazla istek, lütfen daha sonra tekrar deneyin' },
});
app.use('/api', globalApiLimiter);

/* ============== HEALTH ============== */
app.get('/', (_req, res) => res.send('Backend Sunucusu Başarıyla Çalışıyor!'));
function buildHealthPayload() {
  return {
    ok: true,
    ts: Date.now(),
    env: {
      allowDev: ALLOW_DEV,
      frontendOrigin: [...ALLOWED_ORIGINS],
      mongo: !!MONGODB_URI,
      notificationsEnabled: NOTIFICATIONS_ENABLED,
      smtpConfigured: isMailerConfigured(),
    },
  };
}
app.get('/health', (_req, res) => res.json(buildHealthPayload()));
app.get('/api/health', (_req, res) => res.json(buildHealthPayload()));

/* ============ AUTH HELPERS (JWT) ============ */
const User = require(path.join(__dirname, 'models', 'User.js'));

async function createAdmin() {
  try {
    const email = ADMIN_EMAIL;
    const existing = await User.findOne({ email });
    if (existing) {
      if (RESET_ADMIN_PW) {
        if (!ADMIN_PASSWORD) {
          throw new Error('RESET_ADMIN_PASSWORD açıkken ADMIN_PASSWORD zorunlu');
        }
        existing.passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        existing.password = undefined;
        existing.role = 'admin';
        existing.active = true;
        existing.serviceIds = existing.serviceIds || [];
        await existing.save();
        console.log('Admin şifresi güncellendi');
      } else {
        console.log('Admin zaten var');
      }
      return;
    }

    if (!ADMIN_PASSWORD) {
      throw new Error('İlk admin oluşturma için ADMIN_PASSWORD zorunlu');
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.create({
      name: 'Admin',
      email,
      passwordHash,
      password: undefined,
      role: 'admin',
      active: true,
      serviceIds: [],
    });
    console.log('Admin oluşturuldu');
  } catch (err) {
    console.error('Admin oluşturma hatası:', err.message);
  }
}



async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Yetkisiz' });
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); // { uid }
    if (!decoded?.uid) return res.status(401).json({ message: 'Yetkisiz' });

    // Dev login ile gelen 'dev1' için DB sorgusuna gerek yok
    if (decoded.uid === 'dev1') {
      req.user = { uid: 'dev1', role: 'superadmin', serviceIds: [], active: true, email: 'dev@local', hospitalId: null };
      return next();
    }

    const u = await User.findById(decoded.uid).lean();
    if (!u) return res.status(401).json({ message: 'Kullanıcı bulunamadı' });

    req.user = {
      uid: String(u._id),
      role: u.role,
      serviceIds: u.serviceIds || [],
      active: !!u.active,
      email: u.email,
      hospitalId: u.hospitalId ? String(u.hospitalId) : null,
    };
    next();
  } catch {
    res.status(401).json({ message: 'Token geçersiz' });
  }
}
function ensureActive(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Yetkisiz' });
  if (!req.user.active) return res.status(403).json({ message: 'Hesap pasif' });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Yetkisiz' });
    const actual = String(req.user.role || '').toLowerCase();
    if (actual === 'superadmin' || actual === String(role || '').toLowerCase()) return next();
    return res.status(403).json({ message: 'Yetersiz yetki' });
  };
}
function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Yetkisiz' });
    const actual = String(req.user.role || '').toLowerCase();
    if (actual === 'superadmin') return next();
    const expected = roles.map((r) => String(r || '').toLowerCase());
    if (expected.includes(actual)) return next();
    return res.status(403).json({ message: 'Yetersiz yetki' });
  };
}

const secureTenant = [auth, ensureActive, extractHospital, applyHospitalContext];

/* ============== DEV LOGIN — ESNEK, DB'siz ============== */
// .env → ALLOW_DEV_ENDPOINTS=true olmalı
if (ALLOW_DEV) {
  const devLoginLimiter = new Map();
  const DEV_LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const DEV_LOGIN_MAX_ATTEMPTS = 20;
  function devKey(req) {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim();
    const body = req.body || {};
    const ident = String(body.tc ?? body.identifier ?? body.email ?? body.phone ?? '').trim().toLowerCase();
    return `${ip}|${ident}`;
  }
  function hitDevLoginLimit(req, res, next) {
    const now = Date.now();
    const key = devKey(req);
    const cur = devLoginLimiter.get(key);
    if (!cur || cur.resetAt <= now) {
      devLoginLimiter.set(key, { count: 1, resetAt: now + DEV_LOGIN_WINDOW_MS });
      return next();
    }
    if (cur.count >= DEV_LOGIN_MAX_ATTEMPTS) {
      const retrySec = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      return res.status(429).json({ message: 'Çok fazla giriş denemesi, lütfen sonra tekrar deneyin' });
    }
    cur.count += 1;
    devLoginLimiter.set(key, cur);
    return next();
  }

  // /login (dev) — /api/auth/login gerçek auth'tur
  app.post('/login', hitDevLoginLimit, (req, res) => {
    const b = req.body || {};
    // identifier | tc | email | phone -> hepsini kabul et
    const id = (b.tc ?? b.identifier ?? b.email ?? b.phone ?? '').toString().trim().toLowerCase();
    const pwd = (b.password ?? '').toString();

    if (!DEV_LOGIN_IDENTIFIER || !ADMIN_PASSWORD) {
      return res.status(503).json({ message: 'Dev login yapılandırılmamış' });
    }

    if (id === DEV_LOGIN_IDENTIFIER && pwd === ADMIN_PASSWORD) {
      const token = jwt.sign({ uid: 'dev1', role: 'superadmin', hospitalId: null }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: { id: 'dev1', name: 'Dev Kullanıcı', role: 'superadmin', hospitalId: null } });
    }
    return res.status(401).json({ message: 'Kullanıcı bulunamadı veya şifre hatalı' });
  });

  // /me (dev) — /api/auth/me gerçek auth'tur
  app.get('/me', (req, res) => {
    try {
      const h = req.headers.authorization || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : null;
      const d = jwt.verify(t, JWT_SECRET, { algorithms: ['HS256'] });
      if (d.uid !== 'dev1') return res.status(401).json({ message: 'Yetkisiz' });
      return res.json({ id: 'dev1', name: 'Dev Kullanıcı', role: 'superadmin', hospitalId: null });
    } catch {
      return res.status(401).json({ message: 'Yetkisiz' });
    }
  });
}

/* ============== USERS: Activate / Deactivate (kalıcı) ============== */
// Bu blok SADECE eklendi; mevcut routes yapısını bozmaz.
app.post('/api/users/:id/activate',
  ...secureTenant, requireAnyRole('admin','authorized'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const u = await User.findOneAndUpdate(
        withHospitalFilter(req, { _id: id }),
        {
          $set: { active: true, activatedAt: new Date(), activatedBy: req.user.uid },
          $unset: { deactivatedAt: 1, deactivatedBy: 1 }
        },
        { new: true }
      ).lean();

      if (!u) return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
      return res.json({ ok: true, user: { id: String(u._id), active: u.active, role: u.role } });
    } catch (e) {
      return res.status(500).json({ message: e.message });
    }
  }
);

app.post('/api/users/:id/deactivate',
  ...secureTenant, requireAnyRole('admin','authorized'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const u = await User.findOneAndUpdate(
        withHospitalFilter(req, { _id: id }),
        {
          $set: { active: false, deactivatedAt: new Date(), deactivatedBy: req.user.uid },
          $unset: { activatedAt: 1, activatedBy: 1 }
        },
        { new: true }
      ).lean();

      if (!u) return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
      return res.json({ ok: true, user: { id: String(u._id), active: u.active, role: u.role } });
    } catch (e) {
      return res.status(500).json({ message: e.message });
    }
  }
);

/* ============== AI ROUTES (ops.) ============== */
try {
  const aiRoutes = require('./src/api/ai.routes.js');   // /api/ai/*
  const aiPing   = require('./src/api/ai/ping.js');     // /api/ai/ping
  app.use('/api/ai', ...secureTenant, aiPing);
  app.use('/api/ai', ...secureTenant, aiRoutes);
} catch { /* opsiyonel */ }

/* ============== AUTH ROUTER ============== */
// Gerçek auth router varsa; dev login önce match olur
try {
  const authRoutes = require('./routes/auth.routes.js');
  app.use('/api/auth', authRoutes);
} catch {}

/* ============== USERS ROUTES ============== */
try {
  app.get('/api/users/__ping', ...secureTenant, (_req, res) => res.json({ ok: true }));
  const usersRoutes = require('./routes/users.routes.js');
  app.use('/api/users', ...secureTenant, usersRoutes);
} catch {}

/* ============== PERSONNEL ROUTES ============== */
try {
  const personnelRoutes = require('./routes/personnel.routes.js');
  app.use('/api/personnel', ...secureTenant, personnelRoutes);
} catch (e) {
  console.error('PERSONNEL ROUTE LOAD ERROR:', e);
}

/* ============== REQUESTS ROUTES ============== */
try {
  const requestsRouter = require('./routes/requests.routes');
  app.use('/api/requests', ...secureTenant, requestsRouter);
} catch (e) {
  console.error('REQUESTS ROUTE LOAD ERROR:', e);
}

/* ============== SCHEDULES ROUTER ============== */
try {
  const schedulesRoutes = require('./routes/schedules.routes.js');
  app.use('/api/schedules', ...secureTenant, schedulesRoutes);
} catch {}

/* ============== DUTY RULES ROUTES ============== */
try {
  const dutyRulesRoutes = require('./routes/dutyRules.routes.js');
  app.use('/api/duty-rules', ...secureTenant, dutyRulesRoutes);
} catch {}

/* ============== SETTINGS ROUTES ============== */
try {
  const settingsRoutes = require('./routes/settings.routes.js');
  app.use('/api/settings', ...secureTenant, settingsRoutes);
} catch {}

/* ============== LEAVES ROUTES ============== */
try {
  const leavesRoutes = require('./routes/leaves.routes.js');
  app.use('/api/leaves', ...secureTenant, leavesRoutes);
} catch (e) {
  console.error('LEAVES ROUTE LOAD ERROR:', e);
}

/* ============== PARAMETERS ROUTES ============== */
try {
  const parametersRoutes = require('./routes/parameters.routes.js');
  app.use('/api/parameters', ...secureTenant, parametersRoutes);
  console.log('✅ Parameters routes yüklendi');
} catch (e) {
  console.error('❌ PARAMETERS ROUTE LOAD ERROR:', e.message);
}

/* ============== COMPATIBILITY ALIASES ============== */
// Eski frontend endpointleri için geriye dönük uyum
try {
  const Setting = require('./models/Setting');

  const respondSetting = async (req, res, key) => {
    const serviceId = String(req.query?.serviceId || '').trim();
    const doc = await Setting.findOne(withHospitalFilter(req, { key, serviceId })).lean();
    const value = Array.isArray(doc?.value) ? doc.value : (doc?.value ?? null);
    return res.json({ ok: true, key, serviceId, value });
  };

  // settings/* legacy callers
  app.get('/api/settings/leaveTypes', ...secureTenant, async (req, res) => {
    try { return await respondSetting(req, res, 'leaveTypes'); }
    catch (e) { return res.status(500).json({ message: e.message }); }
  });
  app.get('/api/settings/workAreas', ...secureTenant, async (req, res) => {
    try { return await respondSetting(req, res, 'workAreas'); }
    catch (e) { return res.status(500).json({ message: e.message }); }
  });
  app.get('/api/settings/workingHours', ...secureTenant, async (req, res) => {
    try { return await respondSetting(req, res, 'workingHours'); }
    catch (e) { return res.status(500).json({ message: e.message }); }
  });
  app.get('/api/settings/requestBoxV1', ...secureTenant, async (req, res) => {
    try { return await respondSetting(req, res, 'requestBoxV1'); }
    catch (e) { return res.status(500).json({ message: e.message }); }
  });

  app.get('/api/leaveTypes', ...secureTenant, async (req, res) => {
    try {
      const serviceId = String(req.query?.serviceId || '').trim();
      const doc = await Setting.findOne(withHospitalFilter(req, { key: 'leaveTypes', serviceId })).lean();
      res.json(Array.isArray(doc?.value) ? doc.value : []);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get('/api/requestBoxV1', ...secureTenant, async (req, res) => {
    try {
      const serviceId = String(req.query?.serviceId || '').trim();
      const doc = await Setting.findOne(withHospitalFilter(req, { key: 'requestBoxV1', serviceId })).lean();
      res.json(Array.isArray(doc?.value) ? doc.value : []);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
} catch (e) {
  console.error('❌ COMPAT ALIAS LOAD ERROR:', e.message);
}

/* ============== SCHEDULER ROUTER ============== */
try {
  const schedulerRoutes = require('./routes/scheduler.routes.js');
  app.use('/api/scheduler', ...secureTenant, schedulerRoutes);
  const servicesRoutes = require('./routes/services.routes.js');
  app.use('/api/services', ...secureTenant, servicesRoutes);
} catch {}

/* ============== HOLIDAYS ROUTES ============== */
const holidayRoutes = require(path.join(__dirname, 'routes', 'holiday.js'));
app.use('/api/holidays', ...secureTenant, holidayRoutes);

/* ============ ADMIN ÖRNEĞİ ============ */
app.get('/api/admin/ping', ...secureTenant, requireRole('admin'),
  (req, res) => res.json({ ok: true, role: req.user.role })
);

/* ========== 404 & ERROR ========== */
app.use((req, res) => res.status(404).json({ status: 'error', message: 'Not Found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('ERR:', err);
  const status = err?.status || err?.statusCode || 500;
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  res.status(status).json({
    status: 'error',
    message: isProd ? 'Internal Server Error' : (err?.message || 'Internal Server Error'),
  });
});

/* ============== SERVER ============== */
const server = app.listen(PORT, () => {
  console.log(`🚀 Sunucu http://localhost:${PORT} üzerinde`);
  console.log('[BOOT] ENV:', { SKIP_DB, ALLOW_DEV, FRONTEND_ORIGIN: [...ALLOWED_ORIGINS] });
});

// SKIP_DB modunda bazı ortamlarda event loop erken boşalıyor → dev server'ı ayakta tut
if (SKIP_DB) {
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  setInterval(() => {}, 1 << 30);
}
