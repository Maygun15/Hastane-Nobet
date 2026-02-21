// routes/users.routes.js
const express = require('express');
const router  = express.Router();

const crypto = require('crypto');
const User    = require('../models/User');
const Person  = require('../models/Person');
const { requireAuth } = require('../middleware/authz');
const { sendMail, isConfigured } = require('../utils/mailer');

const XLSX = require('xlsx');
const multer = require('multer');
const upload = multer();

/* ---------------------------
   Basit alan kontrolü
---------------------------- */
function validate(b) {
  const errs = [];
  const need = (k, msg) => { if (!b[k]) errs.push(msg || `${k} gerekli`); };

  need('name', 'Ad Soyad gerekli');
  need('tc',   'TC (11 hane) gerekli');
  need('phone','Telefon gerekli');
  need('email','E-posta gerekli');
  need('serviceId','serviceId gerekli');
  need('role','role (standard/authorized/admin) gerekli');

  if (b.tc && !/^\d{11}$/.test(String(b.tc))) errs.push('TC 11 hane olmalı');
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) errs.push('Geçersiz e-posta');
  return errs;
}


/* ---------------------------
   Liste (admin)
   GET /api/users
---------------------------- */
router.get('/', requireAuth, async (req, res) => {
  try {
    const me = req.user;
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: 'Yetki yok' });
    }

    const users = await User.find({})
      .select('name email phone tc role active serviceIds')
      .lean();

    const rows = users.map(u => ({
      id: String(u._id),
      name: u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      tc: u.tc || '',
      role: u.role || 'user',
      active: !!u.active,
      status: u.active ? 'active' : 'pending',
      serviceIds: u.serviceIds || [],
    }));

    return res.json(rows);
  } catch (err) {
    console.error('GET /api/users ERR:', err);
    return res.status(500).json({ error: 'Liste alınamadı' });
  }
});

/* ---------------------------
   Tekli kullanıcı oluşturma
---------------------------- */
router.post('/', requireAuth, async (req, res) => {
  try {
    const me = req.user; // {_id, role, serviceIds: [...]}
    const body = req.body || {};
    const errors = validate(body);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });

    const { name, tc, phone, email, serviceId, role, password } = body;

    // Yetki kontrolü
    const isAdmin = me.role === 'admin';
    const isStaff = me.role === 'staff';
    if (!isAdmin && !isStaff) {
      return res.status(403).json({ error: 'Yetki yok' });
    }
    if (isStaff) {
      const ok = Array.isArray(me.serviceIds) && me.serviceIds.includes(String(serviceId));
      if (!ok) return res.status(403).json({ error: 'Kendi servisin dışında kayıt açılamaz' });
    }

    // Benzersizlik ön-kontrol (yalnızca dolu alanlar)
    const or = [];
    if (email) or.push({ email: String(email).toLowerCase().trim() });
    if (phone) or.push({ phone: String(phone).trim() });
    if (tc)    or.push({ tc: String(tc).trim() });
    if (or.length) {
      const exists = await User.findOne({ $or: or }).lean();
      if (exists) return res.status(409).json({ error: 'Bu e-posta/telefon/TC zaten kayıtlı olabilir' });
    }

    const user = new User({
      email: email ? String(email).toLowerCase().trim() : null,
      phone: phone ? String(phone).trim() : null,
      tc:    tc    ? String(tc).trim()    : null,
      name,
      role,                 // 'standard'|'authorized'|'admin' → model setter mapRole ==> 'user'|'staff'|'admin'
      active: true,
      serviceIds: serviceId ? [ String(serviceId) ] : [],
    });

    const tempPassword = (password ? String(password).trim() : '') || crypto.randomBytes(4).toString('hex');
    await user.setPassword(tempPassword);
    user.mustChangePassword = true;
    await user.save();

    const person = await Person.create({
      userId:    user._id,
      serviceId: String(serviceId),
      name,
      tc,
      phone,
      email: email ? String(email).toLowerCase().trim() : null,
      meta: {},
    });

    return res.json({
      ok: true,
      user: user.toJSON(),
      person,
      tempPasswordIssued: !password,
      tempPassword: !password ? tempPassword : undefined,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || {})[0] || 'unique';
      return res.status(409).json({ error: `Bu ${key} zaten kullanımda` });
    }
    console.error('[POST /api/users] ERR:', err);
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
});


/* ---------------------------
   ADMIN: Şifre sıfırla
   POST /api/users/reset-password
   body: { identifier? | userId?, newPassword?, sendEmail? }
---------------------------- */
router.post('/reset-password', requireAuth, async (req, res) => {
  try {
    const me = req.user;
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: 'Yetki yok' });
    }

    const { identifier, userId, newPassword, sendEmail } = req.body || {};
    if (!identifier && !userId) {
      return res.status(400).json({ error: 'identifier veya userId gerekli' });
    }

    let user = null;
    if (userId) user = await User.findById(String(userId));
    if (!user && identifier) user = await User.findByIdentifier(String(identifier));
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const tempPassword = (newPassword ? String(newPassword).trim() : '') || crypto.randomBytes(4).toString('hex');
    await user.setPassword(tempPassword);
    user.mustChangePassword = true;
    if (process.env.NODE_ENV !== 'production') {
      user.password = tempPassword;
    } else {
      user.password = undefined;
    }
    await user.save();

    let emailed = false;
    const shouldEmail = sendEmail !== false && isConfigured() && !!user.email;
    if (shouldEmail) {
      try {
        await sendMail({
          to: user.email,
          subject: 'Sifre sifirlama',
          text: `Merhaba,

Hesabinizin sifresi yonetici tarafindan sifirlandi.
Gecici sifre: ${tempPassword}

Giris yaptiktan sonra sifrenizi degistirmenizi oneririz.`,
        });
        emailed = true;
      } catch (e) {
        console.error('MAIL ERR:', e?.message || e);
      }
    }

    return res.json({ ok: true, emailed, tempPassword: emailed ? undefined : tempPassword, mustChangePassword: true });
  } catch (err) {
    console.error('RESET PASSWORD ERR:', err);
    return res.status(500).json({ error: 'Sifre sifirlama basarisiz' });
  }
});


/* ---------------------------
   Rol güncelle (admin)
   PATCH /api/users/:id/role
   body: { role }
---------------------------- */
router.patch('/:id/role', requireAuth, async (req, res) => {
  try {
    const me = req.user;
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: 'Yetki yok' });
    }

    const id = req.params.id;
    const roleIn = String(req.body?.role || '').toLowerCase();
    const roleMap = { admin: 'admin', staff: 'staff', authorized: 'staff', standard: 'user', user: 'user' };
    const role = roleMap[roleIn] || 'user';

    const u = await User.findByIdAndUpdate(
      id,
      { $set: { role } },
      { new: true }
    ).lean();

    if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    return res.json({ ok: true, user: { id: String(u._id), role: u.role } });
  } catch (err) {
    console.error('ROLE UPDATE ERR:', err);
    return res.status(500).json({ error: 'Rol güncellenemedi' });
  }
});

/* ---------------------------
   Servis ata (admin)
   PATCH /api/users/:id/services
   body: { serviceIds: [] }
---------------------------- */
router.patch('/:id/services', requireAuth, async (req, res) => {
  try {
    const me = req.user;
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: 'Yetki yok' });
    }

    const id = req.params.id;
    const serviceIds = Array.isArray(req.body?.serviceIds) ? req.body.serviceIds.map(String) : [];

    const u = await User.findByIdAndUpdate(
      id,
      { $set: { serviceIds } },
      { new: true }
    ).lean();

    if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    return res.json({ ok: true, user: { id: String(u._id), serviceIds: u.serviceIds || [] } });
  } catch (err) {
    console.error('SERVICES UPDATE ERR:', err);
    return res.status(500).json({ error: 'Servisler güncellenemedi' });
  }
});

/* ---------------------------
   Kullanıcı sil (admin)
   DELETE /api/users/:id
---------------------------- */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const me = req.user;
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: 'Yetki yok' });
    }

    const id = req.params.id;
    if (String(me.uid || me._id || '') === String(id)) {
      return res.status(400).json({ error: 'Kendi hesabını silemezsin' });
    }

    const u = await User.findByIdAndDelete(id).lean();
    if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    try { await Person.deleteMany({ userId: u._id }); } catch {}

    return res.json({ ok: true });
  } catch (err) {
    console.error('USER DELETE ERR:', err);
    return res.status(500).json({ error: 'Silinemedi' });
  }
});

/* ---------------------------
   EXCEL EXPORT
   GET /api/users/export.xlsx
---------------------------- */
router.get('/export.xlsx', async (_req, res) => {
  try {
    const users = await User.find({})
      .select('name email phone tc role active serviceIds')
      .lean();

    const rows = users.map(u => ({
      AdSoyad:   u.name || '',
      Email:     u.email || '',
      Telefon:   u.phone || '',
      TC:        u.tc || '',
      Rol:       u.role || 'user',          // user|staff|admin
      Aktif:     u.active ? 'Evet' : 'Hayır',
      Servisler: (u.serviceIds || []).join('|')
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Kullanicilar');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="kullanicilar.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('Export.xlsx hatası:', err);
    res.status(500).json({ message: err.message || 'Export hatası' });
  }
});

/* ---------------------------
   EXCEL IMPORT (upsert)
   POST /api/users/import.xlsx   (form-data: file)
---------------------------- */
router.post('/import.xlsx', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const me = req.user;
    if (!me || !['admin', 'staff'].includes(String(me.role || ''))) {
      return res.status(403).json({ error: 'Yetki yok' });
    }

    if (!req.file) return res.status(400).json({ message: 'Excel dosyası gerekli (file)' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const roleMap = {
      admin: 'admin',
      staff: 'staff',
      authorized: 'staff',
      standard: 'user',
      user: 'user',
      doktor: 'staff',
      doctor: 'staff',
      hemsire: 'staff',
      hemşire: 'staff',
      nurse: 'staff',
    };
    const pick = (r, keys) => {
      for (const k of keys) {
        if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return r[k];
      }
      return '';
    };
    const splitList = (v) =>
      String(v || '')
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);

    const errors = [];
    const tempPasswords = [];
    let upserts = 0;
    let created = 0;
    let updated = 0;

    for (const r of rows) {
      const name  = String(pick(r, ['AdSoyad','AD SOYAD','Ad Soyad','NAME'])).trim();
      const email = String(pick(r, ['Email','E-posta','Eposta','MAİL ADRESİ','MAIL','Mail'])).toLowerCase().trim();
      const phone = String(pick(r, ['Telefon','TELEFON','TELEFON NUMARASI'])).replace(/\s+/g,'').trim();
      const tc    = String(pick(r, ['TC','T.C. KİMLİK NO','T.C. KIMLIK NO','T.C. KİMLİK NO','TCKN'])).replace(/\D+/g,'').trim();
      const roleIn = String(pick(r, ['Rol','ROL','Role'])).toLowerCase().trim() || 'user';
      const role   = roleMap[roleIn] || 'user';
      const active = /^e(vet)?$/i.test(String(pick(r, ['Aktif','AKTIF','Active'])) || 'Evet');

      const serviceRaw = pick(r, ['Servisler','SERVISLER','Servis','SERVİS','SERVIS']);
      const serviceIds = splitList(serviceRaw);
      const serviceId = serviceIds[0] || '';

      const title = String(pick(r, ['Unvani','UNVANI','Unvan','UNVAN'])).trim();
      const areaNames = splitList(pick(r, ['ÇALIŞMA ALANLARI','CALISMA ALANLARI','ALANLAR','WORK AREAS']));
      const shiftCodes = splitList(pick(r, ['VARDİYE KODLARI','VARDIYE KODLARI','SHIFT CODES']));

      if (!name && !email && !phone && !tc) continue;

      const query = email ? { email } : (tc ? { tc } : (phone ? { phone } : null));
      if (!query) continue;

      // Staff ise kendi servisinin dışına yazamaz
      if (me.role === 'staff' && serviceId) {
        const ok = Array.isArray(me.serviceIds) && me.serviceIds.includes(String(serviceId));
        if (!ok) {
          errors.push({ row: r, message: 'Yetkili sadece kendi servisinde kayıt açabilir' });
          continue;
        }
      }

      let user = await User.findOne(query).select('+passwordHash +password');
      const isNew = !user;
      if (!user) {
        user = new User({
          name: name || undefined,
          email: email || undefined,
          phone: phone || undefined,
          tc: tc || undefined,
          role,
          active,
          serviceIds,
        });
        const tempPassword = crypto.randomBytes(4).toString('hex');
        await user.setPassword(tempPassword);
        user.mustChangePassword = true;
        tempPasswords.push({
          identifier: email || tc || phone,
          tempPassword,
          name: name || '',
        });
      } else {
        user.name = name || user.name;
        if (email) user.email = email;
        if (phone) user.phone = phone;
        if (tc) user.tc = tc;
        user.role = role;
        user.active = active;
        if (serviceIds.length) user.serviceIds = serviceIds;
      }

      await user.save();

      if (serviceId) {
        const meta = {};
        if (title) meta.title = title;
        if (areaNames.length) meta.workAreas = areaNames;
        if (shiftCodes.length) meta.shiftCodes = shiftCodes;
        if (roleIn) meta.roleLabel = roleIn;

        await Person.findOneAndUpdate(
          { userId: user._id, serviceId: String(serviceId) },
          {
            $set: {
              name: name || user.name || '',
              tc: tc || user.tc || undefined,
              phone: phone || user.phone || undefined,
              email: email || user.email || undefined,
              meta,
            },
          },
          { upsert: true, new: true }
        );
      }

      upserts++;
      if (isNew) created++; else updated++;
    }

    res.json({ ok: true, upserts, created, updated, tempPasswords, errors });
  } catch (e) {
    console.error('import.xlsx err:', e);
    res.status(400).json({ message: e.message || 'İçe aktarım hatası' });
  }
});

module.exports = router;
