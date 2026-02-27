# Planlama Sistemi - Kurulum ve Entegrasyon Rehberi

## 📋 ADIM ADIM KURULUM

### ADIM 1: Backend Kurulumu

#### 1.1 Proje Dizinini Oluştur
```bash
mkdir planning-system
cd planning-system
mkdir backend frontend
cd backend
npm init -y
```

#### 1.2 Gerekli Paketleri Yükle
```bash
npm install express cors morgan axios dotenv
npm install --save-dev nodemon
```

#### 1.3 .env Dosyası Oluştur
```
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

#### 1.4 package.json Scripts'i Güncelle
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
```

#### 1.5 Server Dosyasını Kopyala
- `server.js` dosyasını backend klasörüne kopyala

#### 1.6 Server'ı Başlat
```bash
npm run dev
```

Sonuç:
```
✅ Server başlatıldı: http://localhost:5000
📊 Database: Mock (In-memory)
🔗 CORS Origin: http://localhost:3000
```

---

### ADIM 2: Frontend Kurulumu

#### 2.1 React Projesi Oluştur
```bash
cd ../frontend
npx create-react-app . --template cra
```

#### 2.2 Gerekli Paketleri Yükle
```bash
npm install axios
```

#### 2.3 .env Dosyası Oluştur
```
REACT_APP_API_URL=http://localhost:5000
```

#### 2.4 Dosyaları Kopyala
- `api-service.js` → `src/services/api-service.js`
- `planning-components.jsx` → `src/components/planning-components.jsx`
- `PlanningPage.jsx` → `src/pages/PlanningPage.jsx`

#### 2.5 App.jsx'i Güncelle
```jsx
import './App.css';
import PlanningPage from './pages/PlanningPage';

function App() {
  return <PlanningPage />;
}

export default App;
```

#### 2.6 Frontend'i Başlat
```bash
npm start
```

---

### ADIM 3: API Testi

#### 3.1 Planlama Oluştur (POST)
```bash
curl -X POST http://localhost:5000/api/v1/planning \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q1 Planlama",
    "description": "Birinci çeyrek hedefleri",
    "startDate": "2026-03-01",
    "endDate": "2026-03-31",
    "priority": "high"
  }'
```

**Beklenen Yanıt:**
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "_id": 1,
    "title": "Q1 Planlama",
    ...
  },
  "message": "Planlama başarıyla oluşturuldu"
}
```

#### 3.2 Tüm Planlamaları Listele (GET)
```bash
curl http://localhost:5000/api/v1/planning
```

#### 3.3 Görev Oluştur (POST)
```bash
curl -X POST http://localhost:5000/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "planningId": 1,
    "title": "API Endpoints",
    "startDate": "2026-03-01",
    "dueDate": "2026-03-05",
    "priority": "high",
    "estimatedHours": 8
  }'
```

#### 3.4 Görev Durumunu Güncelle (PATCH)
```bash
curl -X PATCH http://localhost:5000/api/v1/tasks/1/status \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

---

## 🔗 FRONTEND-BACKEND İLETİŞİM

### Sorun Çözümleri

#### Sorun 1: CORS Hatası
```
Access to XMLHttpRequest blocked by CORS policy
```

**Çözüm:**
```javascript
// Backend'de zaten yapılandırılmış:
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
};
```

#### Sorun 2: API Bağlantısı Başarısız
```
Network error: connect ECONNREFUSED 127.0.0.1:5000
```

**Çözüm:**
1. Backend server'ın çalışıyor mu kontrol et:
```bash
curl http://localhost:5000/health
```

2. .env dosyasında doğru API URL'si var mı kontrol et:
```
REACT_APP_API_URL=http://localhost:5000
```

3. Frontend'i yeniden başlat (env değişikliklerinden sonra)

#### Sorun 3: Request Timeout
```
Error: timeout of 30000ms exceeded
```

**Çözüm:**
- Timeout süresi artır (api-service.js):
```javascript
const apiClient = axios.create({
  timeout: 60000 // 60 saniye
});
```

#### Sorun 4: Veri Formatı Uyuşmazlığı

**Frontend Hatası:**
```
TypeError: Cannot read property 'plannings' of undefined
```

**Çözüm:** Response format kontrol et
```javascript
// Backend döner:
{
  "success": true,
  "data": {
    "plannings": [],
    "total": 0
  }
}

// Frontend kullanır:
if (response.data.success) {
  const { plannings } = response.data.data; // ✓ Doğru
}
```

---

## 📊 DEBUGGING İPUÇLARI

### 1. Network Requests İzle
- Chrome DevTools → Network tab
- Her request'in Headers'ını kontrol et
- Response'un statusCode ve data'sını kontrol et

### 2. Console Logs
```javascript
// API Service zaten log'ları yazdırıyor:
📤 API Request: GET /api/v1/planning
📥 API Response: GET /api/v1/planning
❌ API Error: POST /api/v1/tasks
```

### 3. Mock Data Test Et
```javascript
// Backend'de mock verileri komut satırından test et
node server.js
// Tarayıcı açıp http://localhost:5000/api/v1/planning git
```

### 4. Request ID Takibi
- Her request'in unique ID'si var: `X-Request-ID`
- Backend ve Frontend aynı ID'yi logluyor
- Error tracking'de çok yararlı

---

## 🛡️ HATA YÖNETİMİ

### Hata Tipleri

| Tip | Status | Sebep | Çözüm |
|-----|--------|-------|-------|
| VALIDATION_ERROR | 400 | Geçersiz veri | Form validation'ı kontrol et |
| NOT_FOUND | 404 | Kaynak yok | ID'nin doğru olduğunu kontrol et |
| NETWORK_ERROR | N/A | İnternet kesildi | Bağlantıyı kontrol et |
| INTERNAL_ERROR | 500 | Server hatası | Backend loglarını kontrol et |

### Error Handling Örneği
```javascript
try {
  const result = await planningService.create(data);
  if (result.success) {
    showToast('Başarılı', 'success');
  }
} catch (error) {
  if (error.type === 'VALIDATION_ERROR') {
    showErrors(error.details); // Form hatalarını göster
  } else if (error.type === 'NETWORK_ERROR') {
    showToast('İnternet bağlantısı başarısız', 'error');
  } else {
    showToast(error.message, 'error');
  }
}
```

---

## 🚀 PRODUCTION DEPLOYMENT

### 1. Database Bağlantısı
```javascript
// server.js'i MongoDB/PostgreSQL ile güncelle
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
```

### 2. Authentication Ekle
```javascript
// JWT token validation
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.sendStatus(401);
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};
```

### 3. Environment Variables
```
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://yourapp.com
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_secret_key
```

### 4. Frontend Build
```bash
npm run build
# Build klasörünü hosting'e yükle
```

---

## 📝 CHECKLIST

### Backend
- [ ] Express sunucusu çalışıyor
- [ ] CORS düzgün konfigüre edildi
- [ ] Hata yönetimi implementado edildi
- [ ] API endpoints test edildi
- [ ] Response format standart

### Frontend
- [ ] API Service kuruldu
- [ ] Custom Hooks çalışıyor
- [ ] Bileşenler render ediliyor
- [ ] Form validation çalışıyor
- [ ] Error handling implementasyon edildi

### İletişim
- [ ] Browser console'da error yok
- [ ] Network requests başarılı (200/201)
- [ ] Response data doğru format'ta
- [ ] Loading/Error states çalışıyor

---

## 💡 ÖNERİLER

1. **Request/Response Logging**
   - Her işlem loglanıyor
   - Production'da external logging servisini (Sentry, etc.) kullan

2. **Rate Limiting**
   ```javascript
   const rateLimit = require('express-rate-limit');
   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 dakika
     max: 100 // 100 request
   });
   app.use('/api/', limiter);
   ```

3. **Data Validation**
   - Zaten backend'de implementasyon edildi
   - Frontend'de de validasyon yap (UX için)

4. **Caching**
   ```javascript
   // GET requests için Redis caching
   app.get('/api/v1/planning', cache('5 minutes'), handler);
   ```

---

## 📚 KAYNAKLAR

- [Express.js Docs](https://expressjs.com/)
- [Axios Docs](https://axios-http.com/)
- [React Hooks Docs](https://react.dev/reference/react)
- [REST API Best Practices](https://restfulapi.net/)

---

## ✅ BAŞARILI KURULUM

Tebrikler! Başarılı kurulum sırasında şunları göreceksin:

1. **Backend Terminal:**
```
✅ Server başlatıldı: http://localhost:5000
📊 Database: Mock (In-memory)
```

2. **Frontend Browser:**
- Planlama sistemi arayüzü görünüyor
- Yeni planlama oluşturabiliyor
- Görevler ekleyebiliyor
- Durum değiştirebiliyor

3. **Network Requests:**
- API calls başarılı (Network tab'da 200/201 status)
- Veya başarısız olsa hata mesajı gösteriliyor

Sorun yaşarsan, kontrol listesini yeniden gözden geçir! 🎯
