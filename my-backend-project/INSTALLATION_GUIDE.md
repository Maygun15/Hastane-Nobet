# 🚀 LEVEL 2 RULE ENGINE - INSTALLATION GUIDE

## 📋 ADIM ADIM KURULUM

### **ADIM 1: Dosyaları Backend'e Kopyala**

```bash
cd /Users/mehmetaygun/Desktop/28.10/hospital-roster/my-backend-project

# 1. DutyRule Model'i kopyala
cp 1_DutyRule.js models/DutyRule.js

# 2. RuleEngine Service'i kopyala
cp 2_RuleEngine.js services/ruleEngine.js

# 3. API Routes'i kopyala
cp 3_dutyRules.js routes/dutyRules.js
```

---

### **ADIM 2: index.js'e Route Ekle**

**File:** `index.js`

Şu satırı bul:
```javascript
// routes
app.use('/api/auth', require('./routes/auth.routes'));
```

Sonrası ekle:
```javascript
// Duty Rules - LEVEL 2 System
app.use('/api/duty-rules', require('./routes/dutyRules'));
```

---

### **ADIM 3: Scheduler'a RuleEngine Entegre Et**

**File:** `services/scheduler.js` (veya mevcut scheduler dosyası)

Başına ekle:
```javascript
const RuleEngine = require('./ruleEngine');
```

Scheduler içinde, personelleri atarken kuralları kontrol et:

```javascript
// RuleEngine'i yükle
const ruleEngine = await RuleEngine.loadRules(serviceId);

// Her personel için kuralları kontrol et
for (const person of context.staff) {
  // 1. İzin kurallarını kontrol et
  const leaveCheck = await ruleEngine.applyLeaveRules(person, date);
  if (!leaveCheck.canWork) {
    person.excluded = true;
    person.excludeReason = leaveCheck.name;
    continue;
  }

  // 2. Uygunluğu kontrol et
  const eligibility = await ruleEngine.checkPersonEligibility(person, taskCode);
  if (!eligibility.eligible) {
    person.excluded = true;
    person.excludeReason = eligibility.reason;
    continue;
  }

  // 3. Çakışmaları kontrol et
  const conflicts = await ruleEngine.getConflicts(person, shift, date, context.assignments);
  if (conflicts.hasConflicts && conflicts.criticalCount > 0) {
    person.excluded = true;
    person.excludeReason = conflicts.conflicts[0].message;
    continue;
  }

  // 4. Saatleri kontrol et
  const hours = await ruleEngine.calculateAndCheckHours(
    person,
    shift.hours,
    context.assignments,
    { date }
  );
  if (!hours.withinDailyLimit || !hours.withinWeeklyLimit) {
    person.excluded = true;
    person.excludeReason = hours.dailyWarning || hours.weeklyWarning;
    continue;
  }

  // Personel uygun - atamaya devam et
  person.eligible = true;
}
```

---

### **ADIM 4: Default Kural Oluştur**

**Terminal'de çalıştır:**

```bash
cd /Users/mehmetaygun/Desktop/28.10/hospital-roster/my-backend-project
node -e "
const mongoose = require('mongoose');
const DutyRule = require('./models/DutyRule');

mongoose.connect('mongodb://...' /* mevcut connection string */);

const rule = new DutyRule({
  departman: 'Acil Servis',
  serviceId: 'acil-001',
  description: 'Acil Servis Nöbet Kuralları'
});

rule.save().then(() => {
  console.log('✓ Default kural oluşturuldu');
  process.exit(0);
}).catch(err => {
  console.error('✗ Hata:', err);
  process.exit(1);
});
"
```

Veya MongoDB admin panelinden:
```javascript
db.dutyrules.insertOne({
  departman: "Acil Servis",
  serviceId: "acil-001",
  description: "Acil Servis Nöbet Kuralları",
  basicRules: {
    maxConsecutiveDays: 6,
    minRestHours: 12,
    maxWeeklyHours: 72,
    maxDailyHours: 24,
    noDoubleShiftPerDay: true,
    nightShiftFollowUp: "min24hours"
  },
  metadata: {
    version: "1.0",
    isActive: true
  },
  createdAt: new Date(),
  updatedAt: new Date()
})
```

---

### **ADIM 5: Test Et**

```bash
# 1. Backend'i başlat
npm run dev

# 2. Kuralları getir (başka terminal)
curl http://localhost:3001/api/duty-rules/acil-001

# 3. Yanıt örneği:
# {
#   "success": true,
#   "data": {
#     "departman": "Acil Servis",
#     "basicRules": {...},
#     "leaveRules": {...},
#     ...
#   }
# }
```

---

## 🔧 KONFIGÜRASYON

### **Database Connection String**

**.env dosyasında:**
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/hospital
```

---

### **Environment Variables**

```bash
# .env
NODE_ENV=development
PORT=3001
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
```

---

## 🧪 API TESTING

### **1. Kuralları Getir**
```bash
curl -X GET http://localhost:3001/api/duty-rules/acil-001
```

### **2. Yeni Kural Oluştur**
```bash
curl -X POST http://localhost:3001/api/duty-rules \
  -H "Content-Type: application/json" \
  -d '{
    "departman": "Ameliyathane",
    "serviceId": "ameliyathane-001",
    "basicRules": {
      "maxConsecutiveDays": 5,
      "minRestHours": 12,
      "maxWeeklyHours": 60
    }
  }'
```

### **3. Vardiyayı Valide Et**
```bash
curl -X POST http://localhost:3001/api/duty-rules/validate-shift \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "acil-001",
    "person": {
      "id": "p1",
      "name": "Dr. Ahmet",
      "role": "Hemşire",
      "leaveType": null
    },
    "shift": {
      "code": "N",
      "hours": 24
    },
    "date": "2026-03-01",
    "assignments": []
  }'
```

### **4. Uygunluğu Kontrol Et**
```bash
curl -X POST http://localhost:3001/api/duty-rules/check-eligibility \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "acil-001",
    "person": {
      "id": "p1",
      "name": "Dr. Ahmet",
      "role": "Hemşire",
      "pregnant": false,
      "hasReport": false
    },
    "taskCode": "Triaj"
  }'
```

### **5. Saatleri Hesapla**
```bash
curl -X POST http://localhost:3001/api/duty-rules/calculate-hours \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "acil-001",
    "person": {"id": "p1"},
    "newShiftHours": 8,
    "assignments": [
      {"personId": "p1", "date": "2026-03-01", "hours": 8}
    ],
    "date": "2026-03-02"
  }'
```

---

## 🔌 FRONTEND INTEGRATION

### **API Service'e Ekle**

**File:** `src/services/scheduleApi.js` (Frontend)

```javascript
// Duty Rules API
export const dutyRulesApi = {
  // Kuralları getir
  async getRules(serviceId) {
    const response = await axios.get(`/api/duty-rules/${serviceId}`);
    return response.data.data;
  },

  // Vardiyayı valide et
  async validateShift(serviceId, data) {
    const response = await axios.post(`/api/duty-rules/validate-shift`, {
      serviceId,
      ...data
    });
    return response.data.data;
  },

  // Uygunluğu kontrol et
  async checkEligibility(serviceId, person, taskCode) {
    const response = await axios.post(`/api/duty-rules/check-eligibility`, {
      serviceId,
      person,
      taskCode
    });
    return response.data.data;
  },

  // Saatleri hesapla
  async calculateHours(serviceId, data) {
    const response = await axios.post(`/api/duty-rules/calculate-hours`, {
      serviceId,
      ...data
    });
    return response.data.data;
  }
};
```

---

## 🐛 TROUBLESHOOTING

### **Sorun 1: DutyRule Model Error**
```
Error: Cannot find module './models/DutyRule'
```
**Çözüm:** Dosyayı `models/` klasörüne kopyaladığını kontrol et

---

### **Sorun 2: RuleEngine Error**
```
Error: Cannot find module './services/ruleEngine'
```
**Çözüm:** Dosyayı `services/` klasörüne kopyaladığını kontrol et

---

### **Sorun 3: Routes Error**
```
Error: Cannot find module './routes/dutyRules'
```
**Çözüm:** index.js'deki require path'ini kontrol et

---

### **Sorun 4: MongoDB Connection**
```
MongoError: connect ECONNREFUSED
```
**Çözüm:** 
- MongoDB server çalışıyor mu?
- CONNECTION STRING doğru mu?
- .env dosyasında MONGODB_URI tanımlandı mı?

---

## ✅ BAŞARILI KURULUM İŞAREtLERİ

Başarıyla kurulmuşsa:

1. ✅ `npm run dev` hata vermeden çalışır
2. ✅ Kuralları getirmek 200 döner
3. ✅ Yeni kural oluşturmak başarılı
4. ✅ Vardiya validasyonu çalışır
5. ✅ Scheduler kuralları uyguluyor

---

## 🎯 SONRA NE?

### **1. Frontend Rule Editor UI Yap**
- Kuralları düzenleyen arayüz
- Admin paneli

### **2. Scheduler'ı Full Entegre Et**
- Çizelge oluştururken kuralları kontrol et
- Çakışmaları göster

### **3. Monitoring & Logging Ekle**
- Hangi kurallar kırılıyor?
- Kaç çakışma var?

---

## 📞 SORULAR?

Herhangi bir sorun olursa:

1. Terminal output'ını kontrol et
2. MongoDB logs'unu kontrol et
3. API response'unu kontrol et (Postman)

**Good luck!** 🚀
