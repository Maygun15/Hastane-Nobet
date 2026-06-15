# Deployment Kılavuzu

Bu belge, hastane nöbet sistemini production ortamına almak için gerekli
ortam değişkenlerini ve yapılandırma adımlarını açıklar.

---

## Hızlı Başlangıç

```bash
# Güçlü JWT secret üret:
openssl rand -hex 64

# Admin için güçlü şifre üret:
openssl rand -base64 16
```

---

## Backend — Zorunlu Ortam Değişkenleri (Railway)

Aşağıdaki değişkenler `NODE_ENV=production` ortamında **eksik veya zayıfsa
sunucu başlamaz**.

| Değişken | Açıklama | Üretim Yöntemi |
|---|---|---|
| `NODE_ENV` | `production` olarak set edilmeli | Sabit değer |
| `MONGODB_URI` | MongoDB Atlas bağlantı dizesi | Atlas → Connect → Driver |
| `JWT_SECRET` | En az 32 karakter rastgele değer | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | JWT_SECRET'tan farklı, ayrı değer | `openssl rand -hex 64` |
| `ADMIN_EMAIL` | İlk admin e-posta adresi | Gerçek e-posta |
| `ADMIN_PASSWORD` | En az 12 karakter, karma şifre | `openssl rand -base64 16` |
| `FRONTEND_ORIGIN` | Vercel frontend URL'i | Vercel dashboard |

### Önerilen Ek Değişkenler

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `PORT` | Sunucu portu | `3000` |
| `SENTRY_DSN` | Sentry hata izleme URL'i | Boş bırakılabilir |
| `CALENDARIFIC_API_KEY` | Resmi tatil API anahtarı | Boş bırakılabilir |
| `GOOGLE_CLIENT_ID` | Google Calendar OAuth | Boş bırakılabilir |
| `GOOGLE_CLIENT_SECRET` | Google Calendar OAuth secret | Boş bırakılabilir |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | Railway URL + `/api/calendar/google/callback` |
| `SMTP_HOST` | Şifre sıfırlama SMTP sunucusu | Boş bırakılabilir |
| `SMTP_PORT` | SMTP portu | `587` |
| `SMTP_USER` | SMTP kullanıcı adı | Boş bırakılabilir |
| `SMTP_PASS` | SMTP şifresi | Boş bırakılabilir |
| `SMTP_FROM` | Gönderen e-posta adresi | Boş bırakılabilir |
| `NOTIFICATIONS_ENABLED` | E-posta bildirim açma/kapama | `false` |
| `ALLOW_DEV_ENDPOINTS` | **Production'da mutlaka `false`** | `false` |
| `RESET_ADMIN_PASSWORD` | İlk kurulumda `true`, sonra `false` | `false` |

---

## Frontend — Zorunlu Ortam Değişkenleri (Vercel)

| Değişken | Açıklama | Örnek Değer |
|---|---|---|
| `VITE_API_BASE` | Railway backend URL | `https://your-app.up.railway.app` |
| `VITE_API_ENV` | Ortam modu | `prod` |
| `VITE_ONLINE_ONLY` | Offline modu devre dışı bırak | `true` |
| `VITE_PROD_WRITE_ROLES` | Yazma izni olan roller | `ADMIN` |
| `VITE_REQUIRE_BACKEND` | Backend zorunluluğu | `true` |

---

## GitHub Actions Secrets

CI/CD pipeline için GitHub repo → Settings → Secrets → Actions:

| Secret Adı | Kullanıldığı Yer | Açıklama |
|---|---|---|
| `VITE_API_BASE` | `ci.yml`, `deploy.yml` | Railway backend URL |
| `RAILWAY_TOKEN` | `deploy.yml` | Railway deploy token |
| `VERCEL_TOKEN` | `deploy.yml` | Vercel deploy token |
| `VERCEL_ORG_ID` | `deploy.yml` | Vercel organizasyon ID |
| `VERCEL_PROJECT_ID` | `deploy.yml` | Vercel proje ID |

---

## MongoDB Atlas Güvenlik Yapılandırması

1. **IP Whitelist**: Atlas → Network Access → Railway'in statik IP'sini ekle
   - Railway statik IP yoksa "Allow from anywhere" (0.0.0.0/0) — güvenlik riski
   - Önerilir: Railway Pro planı ile statik IP al
2. **Şifre döndürme**: `Database Access` → kullanıcı şifresini rotate et
3. **Yedekleme**: `Backup` → Continuous backup aktif et (M10+ cluster)
4. **Read/Write izinleri**: Atlas kullanıcısına yalnızca gerekli DB için `readWrite`

---

## İlk Kurulum Adımları

```bash
# 1. Railway'de environment variables ekle (yukarıdaki tablodan)

# 2. İlk deployment'ta RESET_ADMIN_PASSWORD=true yap → admin oluşturulur

# 3. Sistem başladıktan sonra RESET_ADMIN_PASSWORD=false yap

# 4. Admin panelinden giriş yap ve şifreyi hemen değiştir
```

---

## Güvenlik Kontrol Listesi (Deploy Öncesi)

- [ ] `JWT_SECRET` en az 32 karakter rastgele değer
- [ ] `JWT_REFRESH_SECRET` JWT_SECRET'tan farklı
- [ ] `ADMIN_PASSWORD` en az 12 karakter, büyük/küçük harf + rakam + özel karakter
- [ ] `MONGODB_URI` gerçek Atlas bağlantı dizesi (localhost değil)
- [ ] `ALLOW_DEV_ENDPOINTS=false`
- [ ] `NODE_ENV=production`
- [ ] `FRONTEND_ORIGIN` production Vercel URL'i
- [ ] MongoDB Atlas IP whitelist konfigüre edildi
- [ ] Sentry DSN set edildi (isteğe bağlı ama önerilir)
- [ ] `.env` dosyası git'e commit edilmedi (`git status` kontrol et)

---

## Yerel Test

```bash
# Production doğrulamasını lokal test etmek için:
NODE_ENV=production JWT_SECRET=super-gizli-ve-uzun-bir-anahtar node index.js
# → "PRODUCTION SECRETS HATASI" hatası vermelidir

NODE_ENV=production JWT_SECRET=$(openssl rand -hex 64) \
  MONGODB_URI=mongodb+srv://... \
  ADMIN_PASSWORD=G%çlüŞifre2026! \
  node index.js
# → "[BOOT] Production secrets doğrulandı." mesajı görünmelidir
```

---

## Gizlilik Notu (KVKK)

Bu sistem hasta verisi içerebilir. Deployment öncesinde:
- Veri işleme sözleşmesi (DPA) MongoDB Atlas ile imzalanmalı
- Veriler Türkiye veya AB bölgesindeki sunucularda tutulmalı
- Atlas cluster'ı `eu-central-1` (Frankfurt) veya `eu-west-1` (Ireland) bölgesinde
