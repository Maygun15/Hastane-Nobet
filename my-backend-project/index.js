// index.js — CJS, Express 5 (auth router + clean CORS + RBAC + FLEX DEV LOGIN)
const path = require('path');
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '.env') });
if (dotenvResult?.error) {
  console.error('[BOOT] dotenv error:', dotenvResult.error);
}
// Bazı ortamlarda .env değerleri yüklenmiyor görünebiliyor → güvenli fallback
if (!process.env.MONGODB_URI) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
}

// ── Sentry: hata takibi (SENTRY_DSN varsa aktif olur) ──────────────────────
let Sentry;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 0,
    });
    console.log('[BOOT] Sentry aktif');
  } catch (e) { console.warn('[BOOT] Sentry yüklenemedi:', e?.message); }
}

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcrypt');
const auditLogger = require('./middleware/auditLogger');
const requestId = require('./middleware/requestId');
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
const BODY_LIMIT      = String(process.env.BODY_LIMIT || '100mb');
const API_RATE_WINDOW_MS = Number(process.env.API_RATE_WINDOW_MS || 15 * 60 * 1000);
const API_RATE_MAX = Number(process.env.API_RATE_MAX || 1000);
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const NOTIFICATIONS_ENABLED = ENABLED_VALUES.has(String(process.env.NOTIFICATIONS_ENABLED || '').toLowerCase());

function redactMongoUri(uri) {
  return String(uri || '').replace(/\/\/([^:\/?#]+):([^@]+)@/, '//***:***@');
}

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
    mongoose.set('autoIndex', !IS_PROD); // production'da index'leri startup'ta build etme

    const mongoOpts = {
      dbName: 'hastane',
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 45000,
      retryWrites: true,
      w: 'majority',
    };

    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] MongoDB bağlantısı kesildi, 5s sonra yeniden bağlanılıyor…');
      setTimeout(() => mongoose.connect(MONGODB_URI, mongoOpts).catch(() => {}), 5000);
    });
    mongoose.connection.on('error', (err) => {
      console.error('[DB] MongoDB bağlantı hatası:', err.message);
    });

    mongoose.connect(MONGODB_URI, mongoOpts)
      .then(async () => {
        console.log('✅ MongoDB bağlı');
        const conn = mongoose.connection;
        console.log('[DB] connected', {
          dbName: conn.name,
          readyState: conn.readyState,
          uri: redactMongoUri(MONGODB_URI),
          npmScript: process.env.npm_lifecycle_event || null,
        });
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
app.use(requestId);
app.use(auditLogger);
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/cURL
    if (!IS_PROD && /^https?:\/\/localhost(:\d+)?$/.test(normalizeOrigin(origin))) return cb(null, true);
    const ok = ALLOWED_ORIGINS.has(normalizeOrigin(origin));
    if (ok) return cb(null, true);
    console.warn('[CORS] blocked origin:', origin);
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
    if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
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
if (!IS_PROD) {
  app.use((req, _res, next) => { console.log('[REQ]', req.method, req.originalUrl); next(); });
}
const globalApiLimiter = rateLimit({
  windowMs: API_RATE_WINDOW_MS,
  max: API_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !IS_PROD,
  message: { message: 'Çok fazla istek, lütfen daha sonra tekrar deneyin' },
});
app.use('/api', globalApiLimiter);

/* ============== HEALTH ============== */
app.get('/', (_req, res) => res.send('Backend Sunucusu Başarıyla Çalışıyor!'));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Public health endpoint — UptimeRobot / dashboard monitoring (auth gerektirmez)
app.get('/api/ping', async (_req, res) => {
  const t0 = Date.now();
  const dbState = mongoose.connection.readyState; // 0=off 1=ok 2=connecting 3=closing
  let dbLatencyMs = null;
  if (dbState === 1) {
    try {
      await mongoose.connection.db.admin().ping();
      dbLatencyMs = Date.now() - t0;
    } catch { /* bağlantı var ama ping başarısız — state zaten 1 değil */ }
  }
  const pool = mongoose.connection?.pool;
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? 'ok' : 'degraded',
    ts: Date.now(),
    uptime_s: Math.floor(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    db: {
      state: dbState,
      latency_ms: dbLatencyMs,
      pool_total: pool?.totalConnectionCount ?? null,
      pool_available: pool?.availableConnectionCount ?? null,
    },
  });
});

/* ============ AUTH HELPERS (JWT) ============ */
const User = require(path.join(__dirname, 'models', 'User.js'));
const AuditLog = require(path.join(__dirname, 'models', 'AuditLog.js'));
// Indeks ve TTL'lerin oluşması için startup'ta register et
require(path.join(__dirname, 'models', 'AILog.js'));
require(path.join(__dirname, 'models', 'AIPreference.js'));
require(path.join(__dirname, 'models', 'SchedulerJob.js'));

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
    const token = (h.startsWith('Bearer ') ? h.slice(7) : null) || req.query?.token || null;
    if (!token) return res.status(401).json({ message: 'Yetkisiz' });
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); // { uid }
    if (!decoded?.uid) return res.status(401).json({ message: 'Yetkisiz' });

    const u = await User.findById(decoded.uid)
      .select('name email role serviceIds active hospitalId personId mustChangePassword tokenVersion')
      .lean();
    if (!u) return res.status(401).json({ message: 'Kullanıcı bulunamadı' });

    req.user = {
      _id: u._id,
      id: String(u._id),
      uid: String(u._id),
      name: u.name || '',
      role: u.role,
      serviceIds: u.serviceIds || [],
      active: !!u.active,
      email: u.email,
      hospitalId: u.hospitalId ? String(u.hospitalId) : null,
      personId: u.personId ? String(u.personId) : null,
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
  // ai.routes.js includes /ping — no need for the separate ping.js mount
  const aiRoutes = require('./src/api/ai.routes.js');
  app.use('/api/ai', ...secureTenant, aiRoutes);
} catch { /* opsiyonel */ }

/* ============== AUTH ROUTER ============== */
try {
  const authRoutes = require('./routes/auth.routes.js');
  // /refresh için ayrı rate limit — brute-force refresh token saldırılarını engeller
  const refreshRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Çok fazla token yenileme isteği, lütfen sonra tekrar deneyin' },
  });
  app.use('/api/auth/refresh', refreshRateLimit);
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

/* ============== GOOGLE CALENDAR ROUTER ============== */
try {
  const googleCalendarRoutes = require('./routes/googleCalendar.routes.js');
  app.use('/api/calendar/google', googleCalendarRoutes.publicRouter);
  app.use('/api/calendar/google', ...secureTenant, googleCalendarRoutes.secureRouter);
} catch (e) {
  console.error('GOOGLE CALENDAR ROUTE LOAD ERROR:', e);
}

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

/* ============== LEAVE BALANCES ROUTES ============== */
try {
  const leaveBalancesRoutes = require('./routes/leavebalances.routes');
  app.use('/api/leave-balances', ...secureTenant, leaveBalancesRoutes);
} catch (e) { console.warn('[BOOT] leave-balances route yüklenemedi:', e?.message); }

/* ============== AUDIT LOG ROUTES ============== */
try {
  const auditLogsRoutes = require('./routes/audit-logs.routes.js');
  app.use('/api/audit-logs', ...secureTenant, requireRole('admin'), auditLogsRoutes);
} catch (e) { console.warn('[BOOT] audit-logs route yüklenemedi:', e?.message); }

/* ============== REPORTS ROUTES ============== */
try {
  const reportsRoutes = require('./routes/reports.routes');
  app.use('/api/reports', ...secureTenant, reportsRoutes);
} catch (e) { console.warn('[BOOT] reports route yüklenemedi:', e?.message); }

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

/* ============== PLANNINGS ============== */
try {
  const planningsRoutes = require('./routes/plannings.routes.js');
  app.use('/api/plannings', ...secureTenant, planningsRoutes);
} catch (e) { console.warn('[BOOT] plannings route yüklenemedi:', e?.message); }

/* ============== COMPLIANCE ROUTES ============== */
try {
  const complianceRoutes = require('./routes/compliance.routes');
  app.use('/api/compliance', ...secureTenant, complianceRoutes);
} catch (e) { console.warn('[BOOT] compliance route yüklenemedi:', e?.message); }

/* ============== NOTIFICATIONS (SSE) ============== */
try {
  const notificationsRoutes = require('./routes/notifications.routes.js');
  app.use('/api/notifications', ...secureTenant, notificationsRoutes);
} catch (e) { console.warn('[BOOT] notifications route yüklenemedi:', e?.message); }

/* ============ ADMIN ÖRNEĞİ ============ */
app.get('/api/admin/ping', ...secureTenant, requireRole('admin'),
  (req, res) => res.json({ ok: true, role: req.user.role })
);
app.get('/api/admin/audit-logs', ...secureTenant, requireRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const logs = await AuditLog.find(withHospitalFilter(req, {}))
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // userId → kullanıcı adı/email çözümlemesi
    try {
      const mongoose = require('mongoose');
      const uniqueIds = [
        ...new Set(
          logs
            .map((l) => l.userId)
            .filter((id) => id && id !== 'anonymous' && mongoose.Types.ObjectId.isValid(id))
        ),
      ].map((id) => new mongoose.Types.ObjectId(id));

      if (uniqueIds.length > 0) {
        const users = await User.find({ _id: { $in: uniqueIds } })
          .select('name email')
          .lean();
        const userMap = {};
        for (const u of users) {
          userMap[String(u._id)] = u.name || u.email || null;
        }
        for (const log of logs) {
          if (log.userId && userMap[log.userId] != null) {
            log.userName = userMap[log.userId];
          }
        }
      }
    } catch (enrichErr) {
      console.warn('[audit-logs] kullanıcı adı çözümlenemedi:', enrichErr?.message);
    }

    res.json({ logs, total: logs.length });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ============ REPORTS ============ */
const Assignment = require('./models/Assignment');

// GET /api/reports/occupancy?year=2025&month=5
app.get('/api/reports/occupancy', ...secureTenant, requireRole('admin'), async (req, res) => {
  try {
    const year  = Number(req.query.year)  || new Date().getFullYear();
    const month = Number(req.query.month) || new Date().getMonth() + 1;

    const hid = mongoose.Types.ObjectId.isValid(String(req.hospitalId || ''))
      ? new mongoose.Types.ObjectId(String(req.hospitalId))
      : null;
    if (!hid) return res.status(400).json({ message: 'hospitalId gerekli' });

    const agg = await Assignment.aggregate([
      { $match: { hospitalId: hid, year, month, status: 'active' } },
      { $group: {
          _id: '$serviceId',
          totalAssignments: { $sum: 1 },
          uniquePersons:    { $addToSet: '$personId' },
          totalHours:       { $sum: '$hours' },
          shifts:           { $addToSet: '$shiftCode' },
      }},
      { $project: {
          serviceId:        '$_id',
          totalAssignments: 1,
          uniquePersonCount: { $size: '$uniquePersons' },
          totalHours:        1,
          shiftCount:        { $size: '$shifts' },
      }},
      { $sort: { totalAssignments: -1 } },
    ]);

    res.json({ year, month, data: agg });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ============ ADMIN: VERİTABANI TUTARLILIK KONTROLÜ ============ */
app.get('/api/admin/check-consistency', ...secureTenant, requireRole('admin'), async (req, res) => {
  try {
    const Setting    = require('./models/Setting');

    // 1. Tüm leavesV2 belgelerini çek ve (personId, date, leaveCode) üçlülerini topla
    const leaveDocs = await Setting.find(withHospitalFilter(req, { key: 'leavesV2' })).lean();

    const leaveIndex = {}; // "personId::date" → leaveCode
    for (const doc of leaveDocs) {
      const val = doc?.value;
      if (!val || typeof val !== 'object') continue;
      for (const [pid, byYm] of Object.entries(val)) {
        if (!pid || typeof byYm !== 'object') continue;
        for (const [ym, days] of Object.entries(byYm)) {
          if (!days || typeof days !== 'object') continue;
          for (const [day, entry] of Object.entries(days)) {
            const leaveCode = typeof entry === 'string' ? entry : entry?.code;
            if (!leaveCode) continue;
            const date = `${ym}-${String(day).padStart(2, '0')}`;
            leaveIndex[`${pid}::${date}`] = leaveCode;
          }
        }
      }
    }

    const leaveDayCount = Object.keys(leaveIndex).length;
    if (leaveDayCount === 0) {
      return res.json({ ok: true, conflicts: [], total: 0, checkedLeaveDays: 0 });
    }

    // 2. Kişi bazında izin günlerini topla → tek sorguda Assignment'ları kontrol et
    const personDateMap = {}; // personId → Set<date>
    for (const key of Object.keys(leaveIndex)) {
      const [pid, date] = key.split('::');
      if (!personDateMap[pid]) personDateMap[pid] = new Set();
      personDateMap[pid].add(date);
    }

    const conflicts = [];
    for (const [pid, dateSet] of Object.entries(personDateMap)) {
      const dates = [...dateSet];
      const assignments = await Assignment.find(
        withHospitalFilter(req, { personId: pid, date: { $in: dates }, status: 'active' }),
      ).select('personId personName date shiftCode roleLabel sectionId serviceId').lean();

      for (const assg of assignments) {
        conflicts.push({
          personId:   pid,
          personName: assg.personName || '',
          date:       assg.date,
          leaveCode:  leaveIndex[`${pid}::${assg.date}`] || '',
          shiftCode:  assg.shiftCode || assg.roleLabel || '',
          sectionId:  assg.sectionId || '',
          serviceId:  assg.serviceId || '',
        });
      }
    }

    conflicts.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return res.json({ ok: true, conflicts, total: conflicts.length, checkedLeaveDays: leaveDayCount });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/* ========== 404 & ERROR ========== */
app.use((req, res) => res.status(404).json({ status: 'error', message: 'Not Found' }));

// Sentry error handler (Sentry aktifse hataları yakala)
if (Sentry) {
  try { app.use(Sentry.expressErrorHandler()); } catch {}
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // 5xx hatalarını Sentry'e ilet
  if (Sentry && (!err?.status || err.status >= 500)) {
    try { Sentry.captureException(err); } catch {}
  }
  console.error('ERR:', err);
  const status = err?.status || err?.statusCode || 500;
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const payload = {
    status: 'error',
    message: isProd ? 'Internal Server Error' : (err?.message || 'Internal Server Error'),
  };
  if (req?.requestId) payload.requestId = req.requestId;
  res.status(status).json(payload);
});

/* ============== SERVER ============== */
const server = app.listen(PORT, () => {
  console.log(`🚀 Sunucu http://localhost:${PORT} üzerinde`);
  console.log('[BOOT] ENV:', { SKIP_DB, ALLOW_DEV, FRONTEND_ORIGIN: [...ALLOWED_ORIGINS] });

  // 24h nöbet hatırlatma servisi
  if (!SKIP_DB && NOTIFICATIONS_ENABLED) {
    try {
      const { startReminderJob } = require('./services/reminderService');
      startReminderJob();
    } catch (e) { console.warn('[BOOT] reminderService yüklenemedi:', e?.message); }
  }
});

// SKIP_DB modunda bazı ortamlarda event loop erken boşalıyor → dev server'ı ayakta tut
if (SKIP_DB) {
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  setInterval(() => {}, 1 << 30);
}

/* ============== GRACEFUL SHUTDOWN ============== */
function gracefulShutdown(signal) {
  console.log(`[SHUTDOWN] ${signal} alındı — sunucu kapatılıyor…`);
  server.close(async () => {
    console.log('[SHUTDOWN] HTTP sunucusu kapandı');
    try {
      await mongoose.connection.close(false);
      console.log('[SHUTDOWN] MongoDB bağlantısı kapandı');
    } catch (e) {
      console.error('[SHUTDOWN] MongoDB kapatma hatası:', e?.message);
    }
    if (Sentry) {
      try { await Sentry.close(2000); } catch {}
    }
    process.exit(0);
  });

  // 15 saniye içinde kapanmazsa zorla çık
  setTimeout(() => {
    console.error('[SHUTDOWN] Zaman aşımı — zorla çıkılıyor');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
  if (Sentry) { try { Sentry.captureException(err); } catch {} }
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[WARN] unhandledRejection:', reason);
  if (Sentry) { try { Sentry.captureException(reason); } catch {} }
});
