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

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const hpp      = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');

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
const ALLOWED_ORIGINS = new Set(['http://localhost:5173','http://localhost:5174', FRONTEND_ORIGIN]);
app.set('trust proxy', 1);
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/cURL
    const ok = [...ALLOWED_ORIGINS].some(o => o === origin);
    return ok ? cb(null, true) : cb(new Error('CORS blocked: ' + origin));
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
app.use(mongoSanitize({ replaceWith: '_' }));
app.use(hpp());
app.use((req, _res, next) => { console.log('[REQ]', req.method, req.originalUrl); next(); });

/* ============== HEALTH ============== */
app.get('/', (_req, res) => res.send('Backend Sunucusu Başarıyla Çalışıyor!'));
app.get('/health', (_req, res) => res.json({
  ok: true,
  ts: Date.now(),
  env: { allowDev: ALLOW_DEV, frontendOrigin: [...ALLOWED_ORIGINS], mongo: !!MONGODB_URI }
}));

/* ============== HOLIDAYS ROUTES ============== */
const holidayRoutes = require(path.join(__dirname, 'routes', 'holiday.js'));
app.use('/api/holidays', auth, ensureActive, holidayRoutes);

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
      req.user = { uid: 'dev1', role: 'admin', serviceIds: [], active: true, email: 'dev@local' };
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
  return (req, res, next) =>
    (!req.user) ? res.status(401).json({ message: 'Yetkisiz' }) :
    (String(req.user.role).toLowerCase() !== String(role).toLowerCase())
      ? res.status(403).json({ message: 'Yetersiz yetki' }) : next();
}
function requireAnyRole(...roles) {
  return (req, res, next) =>
    (!req.user) ? res.status(401).json({ message: 'Yetkisiz' }) :
    (!roles.map(r=>String(r).toLowerCase()).includes(String(req.user.role).toLowerCase()))
      ? res.status(403).json({ message: 'Yetersiz yetki' }) : next();
}

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
      const token = jwt.sign({ uid: 'dev1' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: { id: 'dev1', name: 'Dev Kullanıcı', role: 'admin' } });
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
      return res.json({ id: 'dev1', name: 'Dev Kullanıcı', role: 'admin' });
    } catch {
      return res.status(401).json({ message: 'Yetkisiz' });
    }
  });
}

/* ============== USERS: Activate / Deactivate (kalıcı) ============== */
// Bu blok SADECE eklendi; mevcut routes yapısını bozmaz.
app.post('/api/users/:id/activate',
  auth, ensureActive, requireAnyRole('admin','authorized'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const u = await User.findByIdAndUpdate(
        id,
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
  auth, ensureActive, requireAnyRole('admin','authorized'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const u = await User.findByIdAndUpdate(
        id,
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
  app.use('/api/ai', aiPing);
  app.use('/api/ai', aiRoutes);
} catch { /* opsiyonel */ }

/* ============== AUTH ROUTER ============== */
// Gerçek auth router varsa; dev login önce match olur
try {
  const authRoutes = require('./routes/auth.routes.js');
  app.use('/api/auth', authRoutes);
} catch {}

/* ============== USERS ROUTES ============== */
try {
  app.get('/api/users/__ping', auth, ensureActive, (_req, res) => res.json({ ok: true }));
  const usersRoutes = require('./routes/users.routes.js');
  app.use('/api/users', auth, ensureActive, usersRoutes);
} catch {}

/* ============== PERSONNEL ROUTES ============== */
try {
  const personnelRoutes = require('./routes/personnel.routes.js');
  app.use('/api/personnel', auth, ensureActive, personnelRoutes);
} catch (e) {
  console.error('PERSONNEL ROUTE LOAD ERROR:', e);
}

/* ============== REQUESTS ROUTES ============== */
try {
  const requestsRouter = require('./routes/requests.routes');
  app.use('/api/requests', requestsRouter);
} catch (e) {
  console.error('REQUESTS ROUTE LOAD ERROR:', e);
}

/* ============== SCHEDULES ROUTER ============== */
try {
  const schedulesRoutes = require('./routes/schedules.routes.js');
  app.use('/api/schedules', auth, ensureActive, schedulesRoutes);
} catch {}

/* ============== DUTY RULES ROUTES ============== */
try {
  const dutyRulesRoutes = require('./routes/dutyRules.routes.js');
  app.use('/api/duty-rules', auth, ensureActive, dutyRulesRoutes);
} catch {}

/* ============== SETTINGS ROUTES ============== */
try {
  const settingsRoutes = require('./routes/settings.routes.js');
  app.use('/api/settings', auth, ensureActive, settingsRoutes);
} catch {}

/* ============== LEAVES ROUTES ============== */
try {
  const leavesRoutes = require('./routes/leaves.routes.js');
  app.use('/api/leaves', auth, ensureActive, leavesRoutes);
} catch (e) {
  console.error('LEAVES ROUTE LOAD ERROR:', e);
}

/* ============== PARAMETERS ROUTES ============== */
try {
  const parametersRoutes = require('./routes/parameters.routes.js');
  app.use('/api/parameters', auth, ensureActive, parametersRoutes);
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
    const doc = await Setting.findOne({ key, serviceId }).lean();
    const value = Array.isArray(doc?.value) ? doc.value : (doc?.value ?? null);
    return res.json({ ok: true, key, serviceId, value });
  };

  // settings/* legacy callers
  app.get('/api/settings/leaveTypes', auth, ensureActive, async (req, res) => {
    try { return await respondSetting(req, res, 'leaveTypes'); }
    catch (e) { return res.status(500).json({ message: e.message }); }
  });
  app.get('/api/settings/workAreas', auth, ensureActive, async (req, res) => {
    try { return await respondSetting(req, res, 'workAreas'); }
    catch (e) { return res.status(500).json({ message: e.message }); }
  });
  app.get('/api/settings/workingHours', auth, ensureActive, async (req, res) => {
    try { return await respondSetting(req, res, 'workingHours'); }
    catch (e) { return res.status(500).json({ message: e.message }); }
  });
  app.get('/api/settings/requestBoxV1', auth, ensureActive, async (req, res) => {
    try { return await respondSetting(req, res, 'requestBoxV1'); }
    catch (e) { return res.status(500).json({ message: e.message }); }
  });

  app.get('/api/leaveTypes', auth, ensureActive, async (req, res) => {
    try {
      const serviceId = String(req.query?.serviceId || '').trim();
      const doc = await Setting.findOne({ key: 'leaveTypes', serviceId }).lean();
      res.json(Array.isArray(doc?.value) ? doc.value : []);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get('/api/requestBoxV1', auth, ensureActive, async (req, res) => {
    try {
      const serviceId = String(req.query?.serviceId || '').trim();
      const doc = await Setting.findOne({ key: 'requestBoxV1', serviceId }).lean();
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
  app.use('/api/scheduler', auth, ensureActive, schedulerRoutes);
  const servicesRoutes = require('./routes/services.routes.js');
  app.use('/api/services', auth, ensureActive, servicesRoutes);
} catch {}

/* ============ ADMIN ÖRNEĞİ ============ */
app.get('/api/admin/ping', auth, ensureActive, requireRole('admin'),
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
