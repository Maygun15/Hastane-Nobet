# 🚀 BAŞLAYALIM - YÖNERGELER

Hoşgeldin! Planlama Sistemi kurulum ve kullanım rehberi.

## ⚡ İLK 5 DAKİKA

### 1️⃣ Backend Başlat
```bash
cd backend
npm install express cors morgan axios dotenv
npm install --save-dev nodemon

# server.js dosyasını kopyala
# .env dosyası oluştur:
echo "PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000" > .env

npm run dev
```

✅ Beklenen sonuç: `Server başlatıldı: http://localhost:5000`

### 2️⃣ Frontend Başlat
```bash
cd frontend
npx create-react-app . --template cra
npm install axios

# .env dosyası oluştur:
echo "REACT_APP_API_URL=http://localhost:5000" > .env

# Dosyaları kopyala:
# - api-service.js → src/services/
# - planning-components.jsx → src/components/
# - PlanningPage.jsx → src/pages/

npm start
```

✅ Beklenen sonuç: Browser açılıyor http://localhost:3000

### 3️⃣ Test Et
- "Yeni Planlama" butonuna tıkla
- Form doldur ve kaydet
- DevTools Network tab'ında request'i gör
- Toast message göreceğin

**Tebrikler! Sistem çalışıyor! 🎉**

---

## 📚 REHBERLERI OKUMA SIRASI

1. **README.md** (2 min)
   - Proje hakkında kısa özet
   - Özellikler listesi

2. **QUICK_REFERENCE.md** (5 min)
   - Hızlı komutlar
   - API endpoints

3. **SETUP_GUIDE.md** (10 min)
   - Detaylı kurulum
   - Sorun çözümleri

4. **ARCHITECTURE_DIAGRAMS.md** (5 min)
   - Sistem mimarisi
   - Data flow diyagramları

5. **TROUBLESHOOTING.md** (10 min)
   - Yaygın sorunlar
   - Debugging tıpları

6. **backend-api-setup.md** (5 min)
   - API şeması
   - Data modelleri

---

## 🎯 HEMEN İŞE BAŞLA

### Adım 1: Kurulumu Tamamla
```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (yeni terminal)
cd frontend && npm install && npm start
```

### Adım 2: Test Data'sı Oluştur
Browser console'da (localhost:3000):
```javascript
// Tarayıcıda açık tut: http://localhost:3000
// "Yeni Planlama" butonuna tıkla
// Formu doldur:
// - Başlık: "Q1 2026"
// - Başlangıç: 2026-03-01
// - Bitiş: 2026-03-31
// - Öncelik: High
// Kaydet!
```

### Adım 3: Görev Ekle
- Sol tarafta "Q1 2026" planlama kartına tıkla
- "+ Görev Ekle" butonuna tıkla
- Formu doldur ve kaydet

### Adım 4: View'ları Dene
- Üstte "Liste/Takvim/Timeline" butonlarını tıkla
- Farklı görünümleri test et

---

## 🔧 HATA VARSA?

### ❌ Backend bağlantısı başarısız
```bash
# Terminal'de kontrol et:
curl http://localhost:5000/health

# Eğer başarısız ise:
# 1. Backend terminal'ini kontrol et
# 2. Port 5000 başka biri tarafından kullanılıyor mu?
# 3. .env dosyası var mı?
```

### ❌ CORS hatası
Browser console'da: `Access to XMLHttpRequest blocked by CORS`

Çözüm:
1. Frontend URL'si backend .env'de doğru mu?
2. Backend server yeniden başlat: `npm run dev`
3. Browser cache'i temizle

### ❌ Network tab'da 404
`Cannot POST /api/v1/planning`

Çözüm:
1. Backend server çalışıyor mu?
2. Endpoint adı doğru mu? (server.js'de kontrol et)
3. HTTP method doğru mu? (POST vs GET)

**Daha fazla sorun için → TROUBLESHOOTING.md**

---

## 🚀 SONRAKI ADIMLAR

### Phase 1: Temel Fonksiyonalite ✅
- [x] Backend API
- [x] Frontend UI
- [x] CRUD operations
- [x] Error handling

### Phase 2: İyileştirmeler (Yapılacak)
- [ ] Database entegrasyonu (MongoDB)
- [ ] Authentication (JWT)
- [ ] Real-time updates (Socket.io)
- [ ] Better validation

### Phase 3: Production (Yapılacak)
- [ ] Docker containerization
- [ ] CI/CD pipeline
- [ ] Deployment
- [ ] Monitoring

---

## 📋 DOSYA HARITASI

| Dosya | Amaç | Okuma Süresi |
|-------|------|--------------|
| **START_HERE.md** | Bu dosya - başlangıç yönergesi | 2 min |
| **README.md** | Proje özeti | 5 min |
| **QUICK_REFERENCE.md** | Hızlı komut rehberi | 5 min |
| **SETUP_GUIDE.md** | Detaylı kurulum | 15 min |
| **TROUBLESHOOTING.md** | Sorun çözümleri | 20 min |
| **ARCHITECTURE_DIAGRAMS.md** | Sistem mimarisi | 10 min |
| **backend-api-setup.md** | API şeması | 10 min |
| **PACKAGE_TEMPLATES.md** | package.json örnekleri | 5 min |
| **server.js** | Backend kodu | Kopyala+Yapıştır |
| **api-service.js** | Frontend API servisi | Kopyala+Yapıştır |
| **planning-components.jsx** | React bileşenleri | Kopyala+Yapıştır |
| **PlanningPage.jsx** | Ana sayfa | Kopyala+Yapıştır |

---

## ✅ HAZIRLANMAK İÇİN GEREKLİ

- Node.js (v14+)
- npm veya yarn
- Code editor (VS Code recommended)
- Browser (Chrome/Firefox)
- Terminal/Command Line

---

## 💡 PRO TİPLER

1. **Developer Tools'u Açık Tut**
   - F12 → Network tab
   - Request/Response'ları gör
   - Error'ları debug et

2. **Server ve Frontend Log'larını İzle**
   - Backend terminal'de API log'ları
   - Browser console'de frontend log'ları
   - Request ID'si ile eşleştir

3. **Curl'le API Test Et**
   ```bash
   curl http://localhost:5000/api/v1/planning
   ```

4. **VS Code Extensions Kur**
   - REST Client (API testing)
   - ES7+ React snippets
   - Thunder Client (Postman alternatif)

---

## 🎓 ÖĞRENME PATH

### Gün 1: Setup & Understanding
- [ ] Tüm dosyaları oku
- [ ] Sistem başlat
- [ ] Basic operations test et

### Gün 2: Code Deep Dive
- [ ] server.js'i incele
- [ ] api-service.js'i incele
- [ ] React components'i incele

### Gün 3: Customization
- [ ] Database change
- [ ] Theme customize
- [ ] New features ekle

### Gün 4: Production Ready
- [ ] Authentication ekle
- [ ] Deployment hazırla
- [ ] Performance optimize

---

## 🔗 HIZLI LİNKLER

Yerel çalışan sistem:
- Frontend: http://localhost:3000
- Backend: http://localhost:5000
- Health: http://localhost:5000/health
- API Docs: http://localhost:5000/api/v1

---

## 📞 YARDIM GEREKIRSE

1. **Kurulum sorunları** → SETUP_GUIDE.md
2. **Technical sorunlar** → TROUBLESHOOTING.md
3. **API detayları** → backend-api-setup.md
4. **Hızlı cevaplar** → QUICK_REFERENCE.md
5. **System architecture** → ARCHITECTURE_DIAGRAMS.md

---

## 🎯 SON KONTROL LİSTESİ

Başlamadan önce:
- [ ] Node.js yüklü mu? (`node -v`)
- [ ] npm yüklü mu? (`npm -v`)
- [ ] İnternet bağlantı var mı?
- [ ] Port 3000 ve 5000 boş mu?
- [ ] Tüm dosyaları indirdin mi?

Kurulum sonrası:
- [ ] Backend server çalışıyor
- [ ] Frontend browser'da açıldı
- [ ] Network tab'ında request gözüküyor
- [ ] Planlama oluştur test geçti
- [ ] Görev ekle test geçti

---

## 🎉 BİTTİ!

Hazırsan başlayabiliriz!

```bash
# 1. Backend
cd backend && npm run dev

# 2. Frontend (yeni terminal)
cd frontend && npm start

# 3. Browser'da açılacak http://localhost:3000
```

**Sorularından korkma, TROUBLESHOOTING.md'i kontrol et!** 🚀

---

**Versiyon:** 1.0  
**Güncelleme:** 2026-02-27  
**Durum:** ✅ Ready to Go!
