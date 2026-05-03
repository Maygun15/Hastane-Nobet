# Katkı Kılavuzu

## Branch Stratejisi

```
main          ← production (Vercel + Railway otomatik deploy)
dev           ← aktif geliştirme, PR'lar buraya açılır
feature/*     ← yeni özellikler  (feature/izin-modulu)
fix/*         ← bug düzeltmeleri (fix/login-redirect)
hotfix/*      ← production acil düzeltme (hotfix/token-leak)
```

### Kurallar

- `main`'e direkt push **yasak** — her şey PR ile girer
- `main`'e merge sadece `dev`'den yapılır
- Her PR en az 1 approve almalı
- CI (build + syntax check) geçmeden merge edilmez
- Hotfix: `main`'den branch aç → PR → merge → `dev`'e de cherry-pick

### Commit Formatı

```
tip: kısa açıklama (max 72 karakter)

feat:     yeni özellik
fix:      bug düzeltme
refactor: davranış değişikliği olmayan yeniden yazım
style:    format, boşluk (kod değişikliği yok)
docs:     sadece dokümantasyon
chore:    build, bağımlılık, config
```

Örnek: `fix: kullanıcı aktivasyon endpoint eksikliği giderildi`

## Geliştirme Ortamı

```bash
# 1. Bağımlılıkları kur
npm install
cd my-backend-project && npm install

# 2. Ortam değişkenlerini kopyala
cp my-backend-project/.env.example my-backend-project/.env
# .env dosyasını düzenle

# 3a. Sadece DB + Redis (Docker ile)
docker-compose up mongo redis -d

# 3b. Tüm stack (Docker ile)
docker-compose up -d

# 4. Servisleri ayrı terminalde başlat
cd my-backend-project && npm run dev   # backend :3000
npm run dev                             # frontend :5173
```

## GitHub Actions Secrets

CI/CD pipeline'ı için bu secret'ları GitHub repo ayarlarına ekleyin:

| Secret | Açıklama |
|--------|----------|
| `VERCEL_TOKEN` | Vercel kişisel token |
| `VERCEL_ORG_ID` | Vercel org/user ID |
| `VERCEL_PROJECT_ID` | Vercel proje ID |
| `RAILWAY_TOKEN` | Railway API token |
| `RAILWAY_SERVICE_NAME` | Railway servis adı |
| `VITE_API_BASE` | Production backend URL |
