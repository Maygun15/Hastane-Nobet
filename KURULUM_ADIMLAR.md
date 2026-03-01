# Nöbet Yazma Kuralları - Kurulum Adımları

## Sorun Özeti
Backend `/assign` endpoint'inde kurallar kontrol edilmiyor. Direkt atama yapılıyor.

---

## ✅ Çözüm Adımları

### 1️⃣ Kurallar Modeli Oluştur

**Dosya:** `my-backend-project/models/ScheduleRules.js`

```javascript
const mongoose = require('mongoose');

const rulesSchema = new mongoose.Schema({
  sectionId: { type: String, required: true },
  serviceId: { type: String, default: '' },
  role: { type: String, default: '' },
  
  enabled: { type: Boolean, default: false },
  maxShiftsPerPerson: { type: Number, default: null },
  minRestDaysBetween: { type: Number, default: 0 },
  maxConsecutiveShifts: { type: Number, default: null },
  restrictedDays: [String],
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  createdBy: String,
});

rulesSchema.index({ sectionId: 1, serviceId: 1, role: 1 }, { unique: true });

module.exports = mongoose.model('ScheduleRules', rulesSchema);
```

---

### 2️⃣ Kurallar Validatörü Oluştur

**Dosya:** `my-backend-project/utils/rulesValidator.js`

```javascript
class RulesValidator {
  constructor() {
    this.rules = null;
  }

  setRules(rules) {
    this.rules = rules;
  }

  async validateAssignment(assignment, existingAssignments) {
    if (!this.rules || !this.rules.enabled) {
      return { valid: true, errors: [] };
    }

    const errors = [];
    const { personId, personName, date } = assignment;

    // 1. Maksimum nöbet sayısı
    if (this.rules.maxShiftsPerPerson) {
      const count = existingAssignments.filter(
        a => a.personId === personId || a.personName === personName
      ).length;

      if (count >= this.rules.maxShiftsPerPerson) {
        errors.push(
          `Maksimum ${this.rules.maxShiftsPerPerson} nöbet alabilir. ` +
          `Şu an: ${count}`
        );
      }
    }

    // 2. Ardışık nöbet arası minimum gün
    if (this.rules.minRestDaysBetween > 0) {
      const assignDate = new Date(date);
      const conflicts = existingAssignments.filter(a => {
        if (a.personId !== personId && a.personName !== personName) return false;
        const existDate = new Date(a.date);
        const daysDiff = Math.abs(
          (assignDate - existDate) / (1000 * 60 * 60 * 24)
        );
        return daysDiff < this.rules.minRestDaysBetween;
      });

      if (conflicts.length > 0) {
        errors.push(
          `${this.rules.minRestDaysBetween} gün ara olmalı. ` +
          `Önceki: ${conflicts.map(c => c.date).join(', ')}`
        );
      }
    }

    // 3. Maksimum ardışık nöbet
    if (this.rules.maxConsecutiveShifts) {
      const assignDate = new Date(date);
      let consecutive = 1;

      for (let i = 1; i <= this.rules.maxConsecutiveShifts + 1; i++) {
        const checkDate = new Date(assignDate);
        checkDate.setDate(checkDate.getDate() - i);
        const dateStr = checkDate.toISOString().split('T')[0];

        const hasShift = existingAssignments.some(a =>
          (a.personId === personId || a.personName === personName) && 
          a.date === dateStr
        );

        if (hasShift) consecutive++;
        else break;
      }

      if (consecutive > this.rules.maxConsecutiveShifts) {
        errors.push(
          `Ardışık maksimum ${this.rules.maxConsecutiveShifts} nöbet. ` +
          `Planlanacak: ${consecutive}`
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

module.exports = new RulesValidator();
```

---

### 3️⃣ Routes'a Kurallar Kontrolü Ekle

**Dosya:** `my-backend-project/routes/schedules.routes.js` içinde:

**Üst kısmına ekle:**
```javascript
const ScheduleRules = require('../models/ScheduleRules');
const rulesValidator = require('../utils/rulesValidator');

// Middleware: Kuralları yükle
const loadRules = async (req, res, next) => {
  try {
    const { sectionId, serviceId = '', role = '' } = 
      req.method === 'GET' ? req.query : req.body;

    const rules = await ScheduleRules.findOne({
      sectionId,
      serviceId: serviceId || '',
      role: role || ''
    }).lean();

    rulesValidator.setRules(rules || { enabled: false });
    next();
  } catch (err) {
    console.error('Rules loading error:', err);
    rulesValidator.setRules({ enabled: false });
    next();
  }
};
```

**`/assign` endpoint'ini güncelle (POST):**

```javascript
router.post('/assign',
  requireAuth,
  (req, res, next) => {
    try {
      const query = buildAssignQuery(req.body || {});
      req.assignQuery = query;
      req.assignPayload = normalizeAssignPayload(req.body || {}, query, req.user?.uid || null);
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message });
    }
  },
  sameServiceOrAdmin,
  loadRules, // ✅ Kuralları yükle
  async (req, res) => {
    try {
      const query = {
        sectionId: req.assignQuery.sectionId,
        serviceId: req.assignQuery.serviceId,
        role: req.assignQuery.role,
        year: req.assignQuery.year,
        month: req.assignQuery.month,
      };

      const doc = await MonthlySchedule.findOne(query).lean();
      const data = doc?.data && typeof doc.data === 'object' ? doc.data : {};
      const assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];

      const payload = req.assignPayload;

      // ✅ KURALLAR KONTROLÜ YAPILIR
      const validation = await rulesValidator.validateAssignment(payload, assignments);
      if (!validation.valid) {
        return res.status(400).json({
          ok: false,
          message: 'Nöbet yazma kuralı ihlali',
          errors: validation.errors,
        });
      }

      // Kural geçerse, devam et...
      const key = assignmentKey(payload);
      const idx = assignments.findIndex((a) => assignmentKey(a) === key);
      if (idx === -1) {
        assignments.push(payload);
      } else {
        assignments[idx] = { ...assignments[idx], ...payload };
      }

      const update = {
        $set: {
          ...query,
          data: { ...data, assignments },
          updatedBy: req.user?.uid || null,
        },
      };

      const saved = await MonthlySchedule.findOneAndUpdate(
        query,
        update,
        { new: true, upsert: true }
      ).lean();

      return res.json({
        ok: true,
        assignments: saved?.data?.assignments || assignments,
        scheduleId: String(saved?._id),
        updatedAt: saved?.updatedAt,
      });
    } catch (err) {
      console.error('[POST /assign] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);
```

---

### 4️⃣ Kurallar Admin API'ı Ekle

**Dosya:** `my-backend-project/routes/schedules.routes.js` sonuna ekle:

```javascript
// Kuralları getir
router.get('/rules', requireAuth, async (req, res) => {
  try {
    const { sectionId, serviceId = '', role = '' } = req.query;
    if (!sectionId) {
      return res.status(400).json({ ok: false, message: 'sectionId gerekli' });
    }

    const rules = await ScheduleRules.findOne({
      sectionId,
      serviceId: serviceId || '',
      role: role || ''
    }).lean();

    return res.json({ ok: true, rules: rules || null });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// Kuralları kaydet (ADMIN)
router.put('/rules', requireAuth, async (req, res) => {
  try {
    // Admin kontrolü
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Admin yetki gerekli' });
    }

    const {
      sectionId,
      serviceId = '',
      role = '',
      enabled,
      maxShiftsPerPerson,
      minRestDaysBetween,
      maxConsecutiveShifts,
      restrictedDays,
    } = req.body;

    if (!sectionId) {
      return res.status(400).json({ ok: false, message: 'sectionId gerekli' });
    }

    const update = {
      $set: {
        sectionId,
        serviceId,
        role,
        enabled: !!enabled,
        maxShiftsPerPerson: maxShiftsPerPerson || null,
        minRestDaysBetween: minRestDaysBetween || 0,
        maxConsecutiveShifts: maxConsecutiveShifts || null,
        restrictedDays: restrictedDays || [],
        updatedAt: new Date(),
        createdBy: req.user?.uid,
      }
    };

    const rules = await ScheduleRules.findOneAndUpdate(
      { sectionId, serviceId, role },
      update,
      { new: true, upsert: true }
    );

    return res.json({ ok: true, rules });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// Kuralları etkinleştir/kapat
router.patch('/rules/toggle', requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Admin yetki gerekli' });
    }

    const { sectionId, serviceId = '', role = '', enabled } = req.body;

    const rules = await ScheduleRules.findOneAndUpdate(
      { sectionId, serviceId, role },
      { $set: { enabled: !!enabled, updatedAt: new Date() } },
      { new: true, upsert: true }
    );

    return res.json({
      ok: true,
      rules,
      message: enabled ? 'Kurallar etkinleştirildi ✓' : 'Kurallar devre dışı ✗'
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});
```

---

## 🧪 Test Etme

### 1. Kuralları Kur (Admin tarafından)
```bash
curl -X PUT http://localhost:5000/api/schedules/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "sectionId": "calisma-cizelgesi",
    "serviceId": "",
    "role": "",
    "enabled": true,
    "maxShiftsPerPerson": 5,
    "minRestDaysBetween": 1,
    "maxConsecutiveShifts": 3
  }'
```

### 2. Nöbet Eklemeyi Dene
```bash
curl -X POST http://localhost:5000/api/schedules/assign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "sectionId": "calisma-cizelgesi",
    "date": "2026-03-15",
    "personId": "123",
    "shiftId": "V1"
  }'
```

**Kural ihlali varsa:**
```json
{
  "ok": false,
  "message": "Nöbet yazma kuralı ihlali",
  "errors": [
    "Maksimum 5 nöbet alabilir. Şu an: 5"
  ]
}
```

---

## 📋 Kurallar Parametreleri

| Parametre | Açıklama | Örnek |
|-----------|----------|--------|
| `enabled` | Kuralları aktif mi? | `true` / `false` |
| `maxShiftsPerPerson` | Aylık max nöbet sayısı | `5`, `null` (sınırsız) |
| `minRestDaysBetween` | Nöbetler arası min gün | `1`, `2` |
| `maxConsecutiveShifts` | Ardışık max nöbet | `3`, `5` |
| `restrictedDays` | Yasaklı günler | `["weekend"]` |

---

## ✨ Sonuç

Şimdi nöbet atarken sistemin otomatik olarak kuralları kontrol edecek! 🎉

Herhangi sorun varsa backend console'da hataları görebilirsin.
