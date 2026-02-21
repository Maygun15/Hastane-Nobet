# Windows (Docker + Local Dev)

Bu dosya proje yapısını bozmadan Windows’ta aynı şekilde çalıştırmak içindir.

## 1) Docker Desktop kur
- Windows’ta Docker Desktop’ı kur ve çalıştır.

## 2) MongoDB’yi Docker ile başlat
Proje kökünde:
```bash
docker compose up -d
```

## 3) Backend’i çalıştır
```bash
cd my-backend-project
npm install
node index.js
```

## 4) Frontend’i çalıştır
```bash
cd ..
npm install
npm run dev
```

## 5) Sağlık kontrolü
Tarayıcı:
```
http://localhost:3000/health
```
`mongo: true` görmelisin.

## 6) Durdur
```bash
docker compose down
```

---
Not: `my-backend-project/.env` dosyasında şu satırların bulunduğundan emin ol:
```
MONGODB_URI=mongodb://127.0.0.1:27017/hastane
PORT=3000
JWT_SECRET=... (boş bırakma)
FRONTEND_ORIGIN=http://localhost:5174
ALLOW_DEV_ENDPOINTS=false
```
