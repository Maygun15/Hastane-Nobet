# 📋 Planlama Sistemi - React + Node.js

## 🎯 Nedir Bu?

**Sağlam, scalable ve tam fonksiyonel planlama yönetim sistemi** React (Frontend) ve Express.js (Backend) ile inşa edilmiş.

### ✨ Özellikler
- ✅ Planlama (Planning) yönetimi
- ✅ Görev (Task) yönetimi  
- ✅ Takvim görünümü
- ✅ Timeline görünümü
- ✅ İlerleme takibi
- ✅ Durum yönetimi (Todo, In Progress, Review, Completed)
- ✅ Öncelik yönetimi (Low, Medium, High, Critical)
- ✅ Ayrıntılı hata yönetimi
- ✅ Request/Response logging

---

## 📦 NEYİ KAPSAYOR

### Backend (Node.js + Express)
- **server.js** - Express sunucusu, API endpoints, hata yönetimi
- **backend-api-setup.md** - API şeması, data modelleri

### Frontend (React)
- **api-service.js** - API istemcisi, custom hooks (usePlanning, useTasks)
- **planning-components.jsx** - Reusable bileşenler (Card, Form, Calendar, Timeline)
- **PlanningPage.jsx** - Ana sayfa, tüm bileşenlerin entegrasyonu

### Dokumentasyon
- **SETUP_GUIDE.md** - Adım adım kurulum rehberi
- **TROUBLESHOOTING.md** - Sorun çözümleri ve debugging tıpları
- **README.md** - Bu dosya

---

## 🚀 QUICK START (5 DAKİKA)

### Terminal 1: Backend
```bash
cd backend
npm install
npm run dev
```
✅ http://localhost:5000 açık

### Terminal 2: Frontend  
```bash
cd frontend
npm install
npm start
```
✅ http://localhost:3000 açık

**Hepsi bu kadar!** 🎉

---

## 📋 API ENDPOINTS

### Planning
```
GET    /api/v1/planning           - Tüm planlamaları listele
POST   /api/v1/planning           - Yeni planlama oluştur
GET    /api/v1/planning/:id       - Planlama detayları
PUT    /api/v1/planning/:id       - Planlama güncelle
DELETE /api/v1/planning/:id       - Planlama sil
```

### Tasks
```
GET    /api/v1/tasks              - Tüm görevleri listele
POST   /api/v1/tasks              - Yeni görev oluştur
GET    /api/v1/tasks/:id          - Görev detayları
PUT    /api/v1/tasks/:id          - Görev güncelle
PATCH  /api/v1/tasks/:id/status   - Durum değiştir
DELETE /api/v1/tasks/:id          - Görev sil
```

---

## 💡 ARCHITECTURE

```
┌─────────────────────────────────────────┐
│         REACT FRONTEND (Port 3000)      │
│  - PlanningPage (Ana Sayfa)             │
│  - Components (Card, Form, etc)         │
│  - Hooks (usePlanning, useTasks)        │
└──────────────┬──────────────────────────┘
               │ HTTP/JSON
               ↓
┌─────────────────────────────────────────┐
│     EXPRESS BACKEND (Port 5000)         │
│  - REST API Endpoints                   │
│  - CORS & Validation                    │
│  - Error Handling                       │
│  - Mock Database                        │
└─────────────────────────────────────────┘
```

---

## 🔑 KEY FEATURES

### 1. Standart Response Format
Tüm API responses aynı yapıda:
```json
{
  "success": true,
  "statusCode": 200,
  "data": { ... },
  "message": "İşlem başarılı"
}
```

### 2. Comprehensive Error Handling
```json
{
  "success": false,
  "statusCode": 400,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Giriş verileri geçersiz",
    "details": [
      { "field": "title", "message": "Title gereklidir" }
    ]
  }
}
```

### 3. Request/Response Logging
```
📤 API Request: POST /api/v1/planning
   requestId: 1234567890-abc123
   data: { title: "Q1 Planlama" }

📥 API Response: POST /api/v1/planning
   statusCode: 201
   success: true
```

### 4. Custom React Hooks
```javascript
// Planlama yönet
const { plannings, loading, error, createPlanning, ... } = usePlanning();

// Görev yönet
const { tasks, loading, error, createTask, updateTaskStatus, ... } = useTasks();
```

---

## 📊 GÖRÜNÜMLER

### 1. Liste Görünümü
- Planlamaların kartlarını göster
- İlerleme çubuğu
- Hızlı işlemler (Düzenle, Sil)

### 2. Takvim Görünümü
- Aylık takvim
- Etkinlikleri günlere yerleştir
- Yaklaşan görevler sidebar'ı

### 3. Timeline Görünümü
- Gantt-tarzı görünüm
- İlerleme yüzdeleri
- Tarih aralıkları

---

## 🔧 CUSTOMIZATION

### Port Değiştir
```bash
# Backend
PORT=8080 npm run dev

# Frontend
PORT=3001 npm start
```

### Database Değiştir
Backend'de mock database yerine gerçek database kullan:
```javascript
// server.js
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);
```

### Tema Özelleştir
CSS classes Tailwind utility classes kullanıyor:
```jsx
// planning-components.jsx
className="bg-blue-600 text-white" // ← Renkleri değiştir
```

---

## 🐛 YAYGYN SORUNLAR

### ❌ CORS Error
**Çözüm:** Frontend URL'sini backend .env'ye ekle
```
FRONTEND_URL=http://localhost:3000
```

### ❌ 404 API Not Found
**Çözüm:** Backend server'ın http://localhost:5000'de çalışıp çalışmadığını kontrol et
```bash
curl http://localhost:5000/health
```

### ❌ Network Timeout
**Çözüm:** api-service.js'de timeout'u artır
```javascript
timeout: 60000 // 60 saniye
```

**Detaylı sorun çözüm rehberi için → TROUBLESHOOTING.md**

---

## 📈 İLERİ ADIMLAR

### 1. Database Entegrasyonu
- Mock'tan MongoDB/PostgreSQL'e geç
- Mongoose/Sequelize schema'ları kur
- Migration'ları yazı

### 2. Authentication
- JWT token'ları ekle
- Login/Register endpoints
- Protected routes

### 3. Real-time Updates
- Socket.io integration
- Live collaboration
- Push notifications

### 4. Deployment
- Docker containerization
- CI/CD pipeline
- Cloud deployment (Heroku, AWS, etc)

---

## 📚 DOSYA YAPISI

```
planning-system/
├── backend/
│   ├── server.js              ← Express sunucusu
│   ├── package.json
│   └── .env
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   └── PlanningPage.jsx     ← Ana sayfa
│   │   ├── components/
│   │   │   └── planning-components.jsx
│   │   ├── services/
│   │   │   └── api-service.js       ← API istemcisi
│   │   └── App.jsx
│   ├── package.json
│   └── .env
│
└── docs/
    ├── SETUP_GUIDE.md         ← Kurulum rehberi
    ├── TROUBLESHOOTING.md     ← Sorun çözümleri
    ├── backend-api-setup.md   ← API şeması
    └── README.md              ← Bu dosya
```

---

## 🧪 TESTING

### Manual Testing
1. Browser'ı aç: http://localhost:3000
2. "+ Yeni Planlama" butonuna tıkla
3. Form doldur ve kaydet
4. Görev ekle
5. Network tab'ı kontrol et

### API Testing (Curl)
```bash
# Planlama oluştur
curl -X POST http://localhost:5000/api/v1/planning \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","startDate":"2026-03-01","endDate":"2026-03-31"}'

# Planlamaları listele
curl http://localhost:5000/api/v1/planning

# Görev oluştur
curl -X POST http://localhost:5000/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"planningId":1,"title":"Task","startDate":"2026-03-01","dueDate":"2026-03-05"}'
```

---

## 🔐 SECURITY NOTES

- ✅ Input validation (backend'de)
- ✅ CORS configuration
- ✅ Error message sanitization
- ⚠️ TODO: Authentication (JWT)
- ⚠️ TODO: Rate limiting
- ⚠️ TODO: HTTPS (production)

---

## 📞 SUPPORT

Sorularınız için:
1. **SETUP_GUIDE.md** - Kurulum sorunları
2. **TROUBLESHOOTING.md** - Teknik sorunlar
3. **backend-api-setup.md** - API detayları

---

## 📝 LICENSE

MIT License - Yazılım özgür ve özdür

---

## ✅ NEXT STEPS

1. **Kurulumu Tamamla** → SETUP_GUIDE.md
2. **Sistem'i Test Et** → API endpoints'i kontrol et
3. **Özelleştir** → Database, styling, etc
4. **Deploy Et** → Production'a yükle

---

**Başarılar! 🚀**

Eğer herhangi bir sorun yaşarsan, TROUBLESHOOTING.md'yi kontrol etmeyi unutma!

---

**Versiyon:** 1.0  
**Son Güncelleme:** 2026-02-27  
**Durum:** ✅ Production Ready (Mock Database ile)
