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

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ALLOW_DEV = ['1','true','yes'].includes(String(process.env.ALLOW_DEV_ENDPOINTS || '').toLowerCase());
const DEV_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@admin.com').toLowerCase();
const DEV_PASSWORD = String(process.env.ADMIN_PASSWORD || '1234');

/* ============ Helpers ============ */
const normalize = (s) => (s ?? '').toString().trim();
const lc = (s) => normalize(s).toLowerCase();
const makeToken = (uid) => jwt.sign({ uid }, JWT_SECRET, { expiresIn: '7d' });

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

/* ============= REGISTER (opsiyonel) ============= */
router.post('/register', async (req, res) => {
  try {
    const { name, email, tc, phone, password, role } = req.body || {};
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
      role: role || 'user',
      active: true,
      serviceIds: [],
    });

    const token = makeToken(String(user._id));
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
      },
    });
  } catch (err) {
    console.error('REGISTER ERR:', err);
    res.status(500).json({ message: 'Kayıt sırasında hata' });
  }
});

/* ============= LOGIN ============= */
router.post('/login', async (req, res) => {
  try {
    const identifier = pickIdentifier(req.body);
    const password   = normalize(req.body.password ?? req.body.parola);

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Kimlik ve şifre zorunlu' });
    }

    // DB yoksa ve dev endpoints açıksa, hızlı dev login
    const dbReady = mongoose.connection?.readyState === 1;
    if (!dbReady && ALLOW_DEV) {
      const idLc = String(identifier || '').toLowerCase();
      if ((idLc === DEV_EMAIL || identifier === '17047689518') && password === DEV_PASSWORD) {
        const token = makeToken('dev1');
        return res.json({
          token,
          user: {
            id: 'dev1',
            name: 'Dev Kullanıcı',
            email: DEV_EMAIL,
            role: 'admin',
            active: true,
          },
        });
      }
    }

    // identifier email ise email’e, değilse tc/phone’a bak
    const user = await User.findByIdentifier(identifier)
      .select('passwordHash +password active role name email tc phone serviceIds mustChangePassword');

    if (!user) return res.status(401).json({ message: 'Kullanıcı bulunamadı' });

    let ok = await user.comparePassword(password);
    if (!ok) {
      const adminEmail = (process.env.ADMIN_EMAIL || 'admin@admin.com').toLowerCase();
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

    const token = makeToken(String(user._id));
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
      },
    });
  } catch (err) {
    console.error('LOGIN ERR:', err);
    res.status(500).json({ message: 'Giriş sırasında hata' });
  }
});


/* ============= PASSWORD RESET (token ile) ============= */
router.post('/password/request-reset', async (req, res) => {
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

router.post('/password/reset', async (req, res) => {
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

/* ============= ME (token ile) ============= */
router.get('/me', async (req, res) => {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Yetkisiz' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.uid).lean();
    if (!user) return res.status(401).json({ message: 'Yetkisiz' });

    res.json({
      id: String(user._id),
      name: user.name,
      email: user.email,
      tc: user.tc,
      phone: user.phone,
      role: user.role,
      active: user.active,
      serviceIds: user.serviceIds || [],
      mustChangePassword: !!user.mustChangePassword,
    });
  } catch {
    res.status(401).json({ message: 'Yetkisiz' });
  }
});

module.exports = router;
