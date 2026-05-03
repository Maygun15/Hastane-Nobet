// routes/users.routes.js
const express = require('express');
const router  = express.Router();

const crypto = require('crypto');
const User    = require('../models/User');
const Person  = require('../models/Person');
const { requireAuth, requireRole } = require('../middleware/authz');
const { withHospitalFilter } = require('../middleware/hospital');
const { sendMail, isConfigured } = require('../utils/mailer');

const ExcelJS = require('exceljs');
const multer = require('multer');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ]);
    if (allowed.has(String(file?.mimetype || '').toLowerCase())) return cb(null, true);
    return cb(new Error('Sadece Excel ve CSV dosyası kabul edilir.'), false);
  },
});

function uploadSpreadsheet(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Dosya boyutu 5MB sınırını aşıyor.' });
      }
      return res.status(400).json({ message: 'Dosya yükleme hatası.' });
    }
    return res.status(400).json({ message: safeMessage(err, 'Geçersiz dosya türü.') });
  });
}

function normalizeCellValue(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (value.hyperlink != null) return String(value.text || value.hyperlink);
    if (value.formula != null && value.result != null) return String(value.result);
  }
  return String(value);
}

function parseCsvLine(line = '') {
  const re = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/g;
  return String(line)
    .split(re)
    .map((part) => {
      const x = part.trim();
      return x.startsWith('"') && x.endsWith('"')
        ? x.slice(1, -1).replace(/""/g, '"')
        : x;
    });
}

function parseCsvBuffer(buffer) {
  const text = Buffer.from(buffer || '').toString('utf8');
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => String(h || '').trim());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const out = {};
    header.forEach((h, i) => {
      if (!h) return;
      out[h] = String(cols[i] ?? '').trim();
    });
    return out;
  });
}

async function parseSpreadsheetRows(file) {
  const name = String(file?.originalname || file?.name || '').toLowerCase();
  if (name.endsWith('.csv') || String(file?.mimetype || '').toLowerCase().includes('csv')) {
    return parseCsvBuffer(file.buffer);
  }
  if (name.endsWith('.xls')) {
    throw new Error('Eski .xls formatı desteklenmiyor. Lütfen dosyayı .xlsx olarak kaydedip tekrar yükleyin.');
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const headers = [];
  for (let c = 1; c <= headerRow.cellCount; c++) {
    headers.push(normalizeCellValue(headerRow.getCell(c).value).trim());
  }

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    let hasAny = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      const val = normalizeCellValue(row.getCell(idx + 1).value).trim();
      if (val) hasAny = true;
      obj[h] = val;
    });
    if (hasAny) rows.push(obj);
  }
  return rows;
}

const requireAdmin = requireRole('admin');
const requireAdminOrStaff = requireRole('admin', 'staff');

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

    const users = await User.find(withHospitalFilter(req, {}))
      .select('name email phone tc role active serviceIds personId')
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
      personId: u.personId ? String(u.personId) : null,
    }));

    return res.json(rows);
  } catch (err) {
    console.error('GET /api/users ERR:', err);
    return res.status(500).json({ error: 'Liste alınamadı' });
  }
});

/* ---------------------------
   Admin: kullanıcı-personel bağla
   PUT /api/users/:userId/link-person
---------------------------- */
router.put('/:userId/link-person', requireAdmin, async (req, res) => {
  try {
    const { personId } = req.body;

    await Person.updateMany(withHospitalFilter(req, { userId: req.params.userId }), { $set: { userId: null } });
    await User.findOneAndUpdate(withHospitalFilter(req, { _id: req.params.userId }), { personId: null });

    if (personId) {
      await Person.findOneAndUpdate(withHospitalFilter(req, { _id: personId }), { userId: req.params.userId });
      await User.findOneAndUpdate(withHospitalFilter(req, { _id: req.params.userId }), { personId });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

/* ---------------------------
   Hızlı kullanıcı oluştur (admin/staff)
   POST /api/users/quick-create
---------------------------- */
router.post('/quick-create', requireAdminOrStaff, async (req, res) => {
  try {
    const { name, tc, phone, email, role, personId } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Ad Soyad zorunlu.' });
    }

    const or = [];
    if (email) or.push({ email: String(email).toLowerCase().trim() });
    if (phone) or.push({ phone: String(phone).trim() });
    if (tc) or.push({ tc: String(tc).trim() });
    if (or.length) {
      const exists = await User.findOne(withHospitalFilter(req, { $or: or })).lean();
      if (exists) return res.status(409).json({ message: 'Bu e-posta/telefon/TC zaten kayıtlı olabilir' });
    }

    const userData = {
      name: String(name).trim(),
      tc: tc ? String(tc).trim() : '',
      phone: phone ? String(phone).trim() : '',
      email: email ? String(email).toLowerCase().trim() : '',
      role: role || 'user',
      active: true,
      serviceIds: [],
    };
    if (personId && String(personId).length === 24) {
      userData.personId = personId;
    }
    const user = new User(userData);
    const tempPassword = (tc ? String(tc).trim() : '') || 'Hastane2026!';
    await user.setPassword(tempPassword);
    user.mustChangePassword = true;
    await user.save();

    return res.json({ ok: true, user: { id: String(user._id) } });
  } catch (err) {
    console.error('POST /api/users/quick-create ERR:', err);
    return res.status(500).json({ message: 'Kullanıcı oluşturulamadı' });
  }
});

/* ---------------------------
   Personelden toplu kullanıcı oluştur (admin)
   POST /api/users/bulk-from-personnel
---------------------------- */
router.post('/bulk-from-personnel', requireAdmin, async (req, res) => {
  try {
    const personIds = Array.isArray(req.body?.personIds) ? req.body.personIds : [];
    if (!personIds.length) return res.json({ created: 0, skipped: 0 });

    const persons = await Person.find(withHospitalFilter(req, { _id: { $in: personIds } })).lean();
    let created = 0;
    let skipped = 0;

    for (const p of persons) {
      const or = [{ personId: p._id }];
      if (p.tc) or.push({ tc: p.tc });
      if (p.email) or.push({ email: p.email });
      if (p.phone) or.push({ phone: p.phone });
      const exists = await User.findOne(withHospitalFilter(req, { $or: or })).lean();
      if (exists) { skipped++; continue; }

      const user = new User({
        name: p.name || '',
        tc: p.tc || '',
        phone: p.phone || '',
        email: p.email || '',
        role: 'user',
        active: true,
        serviceIds: p.serviceId ? [String(p.serviceId)] : [],
        personId: p._id,
      });
      const tempPassword = p.tc || 'Hastane2026!';
      await user.setPassword(tempPassword);
      user.mustChangePassword = true;
      await user.save();

      await Person.findOneAndUpdate(withHospitalFilter(req, { _id: p._id }), { userId: user._id });
      created++;
    }

    return res.json({ created, skipped });
  } catch (err) {
    console.error('POST /api/users/bulk-from-personnel ERR:', err);
    return res.status(500).json({ message: 'Toplu oluşturma başarısız' });
  }
});

/* ---------------------------
   Profil güncelle (self/admin)
   PATCH /api/users/:id/profile
   body: { phone?, email? }
---------------------------- */
router.patch('/:id/profile', requireAuth, async (req, res) => {
  try {
    const { phone, email, serviceId } = req.body || {};
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'id gerekli' });

    const isSelf = String(req.user?.uid || '') === userId;
    const role = String(req.user?.role || '').toLowerCase();
    const isAdminOrStaff = role === 'admin' || role === 'staff';
    if (!isSelf && !isAdminOrStaff) {
      return res.status(403).json({ error: 'Yetkisiz' });
    }

    const user = await User.findOne(withHospitalFilter(req, { _id: userId }));
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    if (phone !== undefined) user.phone = phone;
    if (email !== undefined) user.email = email;
    if (serviceId !== undefined && isAdminOrStaff) {
      const sid = String(serviceId || '').trim();
      user.serviceIds = sid ? [sid] : [];
    }
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/users/:id/profile ERR:', err);
    return res.status(500).json({ error: 'Profil güncellenemedi' });
  }
});

/* ---------------------------
   Kimlik güncelle (admin/staff)
   PATCH /api/users/:id/identity
   body: { name?, tc? }
---------------------------- */
router.patch('/:id/identity', requireAdminOrStaff, async (req, res) => {
  try {
    const { name, tc } = req.body || {};
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'id gerekli' });

    const user = await User.findOne(withHospitalFilter(req, { _id: userId }));
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    if (name) user.name = String(name).trim();
    if (tc) user.tc = String(tc).trim();
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/users/:id/identity ERR:', err);
    return res.status(500).json({ error: 'Kimlik güncellenemedi' });
  }
});

/* ---------------------------
   Şifre değiştir (self)
   POST /api/users/change-password
   body: { currentPassword, newPassword }
---------------------------- */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mevcut ve yeni şifre gerekli' });
    }

    const userId = String(req.user?.uid || '').trim();
    if (!userId) return res.status(401).json({ error: 'Yetkisiz' });

    const user = await User.findOne(withHospitalFilter(req, { _id: userId })).select('+password +passwordHash');
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const ok = await user.comparePassword(currentPassword);
    if (!ok) return res.status(400).json({ error: 'Mevcut şifre yanlış.' });

    await user.setPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/users/change-password ERR:', err);
    return res.status(500).json({ error: 'Şifre güncellenemedi' });
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
      const exists = await User.findOne(withHospitalFilter(req, { $or: or })).lean();
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
    if (userId) user = await User.findOne(withHospitalFilter(req, { _id: String(userId) }));
    if (!user && identifier) user = await User.findOne(withHospitalFilter(req, { $or: [{ email: String(identifier).toLowerCase().trim() }, { phone: String(identifier).trim() }, { tc: String(identifier).replace(/\D+/g, '') }] }));
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

    const u = await User.findOneAndUpdate(
      withHospitalFilter(req, { _id: id }),
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

    const u = await User.findOneAndUpdate(
      withHospitalFilter(req, { _id: id }),
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
   Aktif/pasif yap (admin)
   POST /api/users/:id/activate
   POST /api/users/:id/deactivate
---------------------------- */
router.post('/:id/activate', requireAdmin, async (req, res) => {
  try {
    const u = await User.findOneAndUpdate(
      withHospitalFilter(req, { _id: req.params.id }),
      { $set: { active: true } },
      { new: true }
    ).lean();
    if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    return res.json({ ok: true, user: { id: String(u._id), active: u.active } });
  } catch (err) {
    console.error('ACTIVATE ERR:', err);
    return res.status(500).json({ error: 'Aktivasyon başarısız' });
  }
});

router.post('/:id/deactivate', requireAdmin, async (req, res) => {
  try {
    const me = req.user;
    if (String(me.uid || me._id || '') === String(req.params.id)) {
      return res.status(400).json({ error: 'Kendi hesabını pasifleştiremezsin' });
    }
    const u = await User.findOneAndUpdate(
      withHospitalFilter(req, { _id: req.params.id }),
      { $set: { active: false } },
      { new: true }
    ).lean();
    if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    return res.json({ ok: true, user: { id: String(u._id), active: u.active } });
  } catch (err) {
    console.error('DEACTIVATE ERR:', err);
    return res.status(500).json({ error: 'Deaktivasyon başarısız' });
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

    const u = await User.findOneAndDelete(withHospitalFilter(req, { _id: id })).lean();
    if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    try { await Person.deleteMany(withHospitalFilter(req, { userId: u._id })); } catch {}

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
router.get('/export.xlsx', requireAdminOrStaff, async (req, res) => {
  try {
    const users = await User.find(withHospitalFilter(req, {}))
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

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Kullanicilar');
    ws.columns = [
      { header: 'AdSoyad', key: 'AdSoyad', width: 28 },
      { header: 'Email', key: 'Email', width: 30 },
      { header: 'Telefon', key: 'Telefon', width: 18 },
      { header: 'TC', key: 'TC', width: 16 },
      { header: 'Rol', key: 'Rol', width: 14 },
      { header: 'Aktif', key: 'Aktif', width: 12 },
      { header: 'Servisler', key: 'Servisler', width: 24 },
    ];
    rows.forEach((row) => ws.addRow(row));
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="kullanicilar.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    console.error('Export.xlsx hatası:', err);
    res.status(500).json({ message: safeMessage(err, 'Export hatası') });
  }
});

/* ---------------------------
   EXCEL IMPORT (upsert)
   POST /api/users/import.xlsx   (form-data: file)
---------------------------- */
router.post('/import.xlsx', requireAuth, uploadSpreadsheet, async (req, res) => {
  try {
    const me = req.user;
    if (!me || !['admin', 'staff'].includes(String(me.role || ''))) {
      return res.status(403).json({ error: 'Yetki yok' });
    }

    if (!req.file) return res.status(400).json({ message: 'Excel dosyası gerekli (file)' });

    const rows = await parseSpreadsheetRows(req.file);

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

      let user = await User.findOne(withHospitalFilter(req, query)).select('+passwordHash +password');
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
        if (areaNames.length) {
          meta.areas = areaNames;
          meta.workAreas = areaNames;
        }
        if (shiftCodes.length) meta.shiftCodes = shiftCodes;
        if (roleIn) meta.roleLabel = roleIn;

        await Person.findOneAndUpdate(
          withHospitalFilter(req, { userId: user._id, serviceId: String(serviceId) }),
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
