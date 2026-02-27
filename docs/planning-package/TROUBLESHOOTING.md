# Frontend-Backend İletişim Sorunları - Çözüm Rehberi

## 🔍 COMMON ISSUES & SOLUTIONS

### Issue 1: "Cannot POST /api/v1/planning"
**Semptom:** 404 Not Found hatası
**Nedenleri:**
- Backend server çalışmıyor
- URL yanlış
- Endpoint tanımlanmadı

**Çözüm:**
```bash
# 1. Backend server'ın çalışıp çalışmadığını kontrol et
curl http://localhost:5000/health

# 2. .env dosyasında doğru URL var mı
cat .env | grep API_URL

# 3. Backend server'ı yeniden başlat
npm run dev
```

---

### Issue 2: "Request blocked by CORS policy"
**Semptom:** 
```
Access to XMLHttpRequest at 'http://localhost:5000/api/v1/planning' 
from origin 'http://localhost:3000' has been blocked by CORS policy
```

**Nedenleri:**
- CORS header'ları set edilmemiş
- Frontend URL'si backend'de tanımlanmamış
- Request method CORS'ta izin verilmemiş

**Çözüm:**
```javascript
// Backend'de (zaten yapılandırılmış)
const cors = require('cors');
const corsOptions = {
  origin: 'http://localhost:3000', // Frontend URL'si
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
```

---

### Issue 3: "Network Error: getaddrinfo ENOTFOUND localhost"
**Semptom:** Backend'e bağlanamıyor
**Nedenleri:**
- Backend port'u yanlış
- Network konfigürasyonu sorunlu
- Firewall engellemeyi

**Çözüm:**
```javascript
// api-service.js'de
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:5000';

// Windows'ta localhost yerine 127.0.0.1 kullan
const API_BASE_URL = 'http://127.0.0.1:5000';
```

---

### Issue 4: "Response data is not in expected format"
**Semptom:** 
```
TypeError: Cannot read property 'plannings' of undefined
```

**Nedenleri:**
- Response structure yanlış
- Backend farklı format döndürüyor
- Data mapping hatası

**Çözüm:**
```javascript
// Response format check
console.log('Full response:', response.data);

// Doğru structure:
{
  "success": true,
  "statusCode": 200,
  "data": {
    "plannings": [...],
    "total": 0
  }
}

// Frontend'de kontrol et:
if (response.data.success && response.data.data) {
  const { plannings } = response.data.data;
  // Şimdi kullan
}
```

---

### Issue 5: "Timeout of 30000ms exceeded"
**Semptom:** Request çok uzun sürüyor
**Nedenleri:**
- Backend çok yavaş
- Database query yavaş
- Network latency

**Çözüm:**
```javascript
// api-service.js'de timeout'u artır
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // 60 saniyeye çıkar
  headers: {
    'Content-Type': 'application/json'
  }
});

// Backend'de cevap zamanını kontrol et
console.log('Query time:', Date.now() - startTime, 'ms');
```

---

### Issue 6: "Cannot Update: Planning Not Found"
**Semptom:** PUT/PATCH işlemi başarısız
**Nedenleri:**
- ID format yanlış
- Kaynak silinmiş
- Permission problemi

**Çözüm:**
```javascript
// Frontend'de ID'yi kontrol et
console.log('Update request ID:', id, typeof id);

// Backend'de ID type matching
const planning = mockDatabase.plannings.find(p => p._id == id); // Loose comparison
// veya
const planning = mockDatabase.plannings.find(p => p._id === parseInt(id)); // Strict
```

---

## 🧪 TESTING & DEBUGGING

### 1. Network Tab ile Debug Et
```
Chrome DevTools → Network Tab

1. Request'e tıkla
2. Headers bölümüne bak:
   - Method: POST/GET/PUT/DELETE
   - Status Code: 200/400/500
   - URL: http://localhost:5000/api/v1/...

3. Preview bölümüne bak:
   - Response body doğru mu?
   - Error mesajı nedir?
```

### 2. Console'da Request Simüle Et
```javascript
// Browser console'da:
fetch('http://localhost:5000/api/v1/planning', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(res => res.json())
.then(data => console.log(data))
.catch(err => console.error(err));
```

### 3. Backend Logları İzle
```bash
# Terminal'de backend çalışan server'ı gözle
npm run dev

# Şunu göreceksin:
📤 API Request: POST /api/v1/planning
   requestId: 1234567890-abc123
   data: { title: "..." }

📥 API Response: POST /api/v1/planning
   statusCode: 201
   requestId: 1234567890-abc123
   success: true
```

---

## ✅ VALIDATION CHECKLIST

### Pre-Flight Checks
- [ ] Backend server çalışıyor: `curl http://localhost:5000/health`
- [ ] Frontend build hatasız: `npm start` hatasız başlıyor
- [ ] .env dosyaları ayarlandı: `REACT_APP_API_URL=http://localhost:5000`
- [ ] Package'ler yüklü: `npm list axios express cors`

### Runtime Checks
- [ ] Network tab'da request gösteriliyor
- [ ] Status code 200/201 (başarılı) veya 400/500 (error)
- [ ] Response body JSON formatında
- [ ] Console'da error yok
- [ ] Toast notification gösteriyor (success/error)

### Data Flow Checks
```
User Action (Click) 
  ↓
Frontend Handler (onClick)
  ↓
API Call (apiClient.post)
  ↓
Request Log (Console)
  ↓
Backend Handler (app.post)
  ↓
Validation & Response
  ↓
Response Log (Console)
  ↓
Frontend Catch/Then
  ↓
State Update (setState)
  ↓
UI Render
  ↓
Toast Message
```

---

## 🔧 QUICK FIX COMMANDS

### Backend Sorunları
```bash
# Port 5000 zaten kullanılıyor mı?
lsof -i :5000

# Eğer kullanılıyorsa, process'i öldür
kill -9 <PID>

# Farklı port'ta başlat
PORT=5001 npm run dev
```

### Frontend Sorunları
```bash
# Dependencies problemi
rm -rf node_modules package-lock.json
npm install

# Cache temizle
npm cache clean --force

# Farklı port'ta başlat
PORT=3001 npm start
```

### CORS Proxy (Son Çare)
```bash
# npm install -g cors-anywhere
# cors-anywhere

# Frontend'de:
const API_BASE_URL = 'http://localhost:8080/http://localhost:5000';
```

---

## 📊 PERFORMANCE OPTIMIZATION

### 1. Request Batching
```javascript
// ❌ 100 ayrı request (yavaş)
for (let i = 0; i < 100; i++) {
  await taskService.create(tasks[i]);
}

// ✓ Toplu işlem (hızlı)
Promise.all(tasks.map(t => taskService.create(t)));
```

### 2. Caching
```javascript
// api-service.js'de cache ekle
const cache = {};

const cachedGet = async (url) => {
  if (cache[url]) return cache[url];
  const result = await apiClient.get(url);
  cache[url] = result;
  return result;
};
```

### 3. Pagination
```javascript
// Backend'de zaten var
await planningService.list({ skip: 0, limit: 10 });

// Scroll'da daha çok yükle
onScroll={() => {
  setSkip(prev => prev + 10);
  fetchMore();
}};
```

---

## 🛡️ SECURITY BEST PRACTICES

### 1. Sensitive Data
```javascript
// ❌ Password API'de gösterme
const handleLogin = async (email, password) => {
  const response = await apiClient.post('/login', { email, password });
  localStorage.setItem('token', response.data.token); // Token sadece
};

// ✓ HTTPS kullan (production)
const API_BASE_URL = 'https://api.yourapp.com';
```

### 2. CORS Whitelist
```javascript
// Production'da sadece trusted origins
const corsOptions = {
  origin: ['https://app.yourapp.com', 'https://www.yourapp.com'],
  credentials: true
};
```

### 3. Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));
```

---

## 📈 MONITORING

### 1. Request/Response Times
```javascript
// Interceptor'da
apiClient.interceptors.request.use((config) => {
  config.metadata = { startTime: Date.now() };
  return config;
});

apiClient.interceptors.response.use((response) => {
  const duration = Date.now() - response.config.metadata.startTime;
  console.log(`⏱️ ${response.config.url}: ${duration}ms`);
  return response;
});
```

### 2. Error Tracking
```javascript
const reportError = (error) => {
  if (window.Sentry) {
    Sentry.captureException(error, {
      tags: {
        component: 'api-service',
        requestId: error.requestId
      }
    });
  }
};
```

### 3. User Analytics
```javascript
const trackEvent = (event, data) => {
  if (window.gtag) {
    gtag('event', event, data);
  }
};

// Kullanım
trackEvent('planning_created', { planningId: 123 });
```

---

## 🎯 ADVANCED DEBUGGING

### Request Inspection Tool
```javascript
// Debugging utility
export const debugApi = {
  logRequest: (config) => {
    console.group(`🔵 ${config.method.toUpperCase()} ${config.url}`);
    console.log('Headers:', config.headers);
    console.log('Data:', config.data);
    console.groupEnd();
  },
  
  logResponse: (response) => {
    console.group(`🟢 ${response.status} ${response.config.url}`);
    console.log('Response:', response.data);
    console.groupEnd();
  },
  
  logError: (error) => {
    console.group(`🔴 ERROR ${error.response?.status} ${error.config?.url}`);
    console.log('Error:', error.response?.data);
    console.log('Message:', error.message);
    console.groupEnd();
  }
};

// api-service.js'de kullan
if (process.env.NODE_ENV === 'development') {
  apiClient.interceptors.request.use(config => {
    debugApi.logRequest(config);
    return config;
  });
}
```

---

## 🚀 PRODUCTION CHECKLIST

- [ ] HTTPS enabled
- [ ] CORS properly configured
- [ ] Error logging setup (Sentry, etc.)
- [ ] Performance monitoring (NewRelic, Datadog)
- [ ] Rate limiting enabled
- [ ] Request validation
- [ ] Database optimization
- [ ] Caching strategy
- [ ] Load testing done
- [ ] Security audit passed

---

**Son güncelleme:** 2026-02-27
**Versiyon:** 1.0
