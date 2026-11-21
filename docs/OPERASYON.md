# İşletim: Kurulum, Güncelleme, Yedek ve Geri Dönüş

Bu belge 22 Kasım 2026 durumunu anlatır (`ticari-hazirlik` dalı). Komutlar macOS/Linux kabuğu içindir. Bağlantı adresleri ve şifreler belgeye, sohbete ya da günlüğe **yazılmaz**.

## 1. Ortamlar

| Ortam | Ön yüz | Sunucu | Veritabanı | Dal |
|---|---|---|---|---|
| Yerel deneme | `localhost:5175` (vite) | `localhost:3100` | `127.0.0.1:27018` (yerel mongod, veri `~/nöbet/.prova-db`) | çalışma dalı |
| Deneme (staging) | Render `nobet-staging` (statik) | Render `nobet-staging-api` (ücretsiz plan, uyur) | Atlas deneme kümesi (adres yalnız Render ortam değişkeninde) | `render.yaml` → `branch:` |
| Üretim | Vercel | Railway (`deploy.yml`) | Atlas `hastane` kümesi | `main` |

Uygulama veritabanı adı her ortamda sabittir: **`hastane`** (`index.js` → `dbName`). Adresteki ad dikkate alınmaz.

## 2. İlk kurulum

1. **Node 20+** ve MongoDB Database Tools (`mongodump` / `mongorestore`) kurulu olmalı.
2. Bağımlılıkları kurun:
   ```bash
   npm ci && (cd my-backend-project && npm ci --omit=dev)
   ```
3. Sunucu ortam değişkenleri: liste `my-backend-project/.env.example` dosyasında.
   - **Zorunlu:** `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (`openssl rand -hex 32`), `FRONTEND_ORIGIN`, `NODE_ENV=production`.
   - **İlk yönetici:** `ADMIN_EMAIL`, `ADMIN_PASSWORD`. İlk açılıştan sonra parolayı arayüzden değiştirin. `RESET_ADMIN_PASSWORD` kalıcı açık bırakılmaz.
   - **E-posta:** gönderim Resend API ile yapılır (`RESEND_API_KEY`, `SMTP_FROM`). `.env.example` dosyasındaki `SMTP_*` alanları kullanılmıyor.
   - **İsteğe bağlı:** `SENTRY_DSN`. İstek gövdesi, çerez ve yetki başlığı Sentry'ye gönderilmez.
4. Dizinleri kurun. Üretimde `autoIndex` kapalıdır, dizinler kendiliğinden oluşmaz:
   ```bash
   cd my-backend-project
   MONGODB_URI=… node scripts/ensureCommercialIndexes.js          # kuru çalıştırma
   MONGODB_URI=… node scripts/ensureCommercialIndexes.js --apply  # uygular (yalnız oluşturur)
   ```
   Üretim kümesinde betik `MIGRATION_ALLOW_PROD=1` olmadan çalışmaz.
5. Kurum kurallarını girin: **Parametreler → Nöbet Kuralları → Kurum kuralları**.
   - Kurallar girilmeden planlama 422 verir (`RULES_NOT_CONFIGURED`).
   - Eski tarayıcı kuralları varsa paneldeki "Taşıma önizlemesi" ile aktarın. Bu tekrar güvenlidir (`migrationKey`).
6. Sağlık kontrolü: `GET /api/health` → `{ ok: true }`.

## 3. Güncelleme (bu dalın getirdiği taşımalar)

Sırayla yapın. Her adım tekrar çalıştırılabilir.

| # | Adım | Komut / yer | Geri alınır mı |
|---|---|---|---|
| 0 | **Yedek al** (§4) | `scripts/backup.js` | — |
| 1 | Kodu yayınla (sunucu önce, sonra ön yüz) | Render/Railway + Vercel | Evet (önceki dağıtım) |
| 2 | Dizinler | `ensureCommercialIndexes.js --apply` | Evet: dizinler silinebilir, veri değişmez |
| 3 | İzin türü düzeltmesi (yalnız "Y" düşülür, 20 gün hak) | `scripts/fixLeaveTypes.js` (kuru) → `--apply` | Yedekten (§5) |
| 4 | Kurum kurallarını gir / taşı | Arayüz (§2.5) | Evet: kural kaydı yeni revizyonla değiştirilebilir |
| 5 | Planları güncel kurallarla doğrula | Yayın çubuğu → "Güncel kurallarla doğrula" (`/monthly/revalidate`) | — |

**Taşıma gerektirmeyenler:**
- `MonthlySchedule.revision`: eski kayıtlarda alan yoktur. İlk kayıtta 0 sayılır ve 1 olur.
- `publication.version`: ilk yayında 1 olur.
- `ScheduleChange`: yeni koleksiyon.
- `Request.clientRequestId`: isteğe bağlı alan.

**Uyumluluk:**
- Yeni sunucu eski ön yüzle çalışır. Eski ön yüz `baseRevision` göndermez; bu durumda sunucu revizyon kontrolünü yapmaz.
- Eski ön yüzün gönderdiği tarayıcı kuralları yok sayılır ve raporlanır.
- Bu yüzden **sunucu önce** yayınlanır.

## 4. Yedek

```bash
cd my-backend-project
MONGODB_URI=… BACKUP_DIR=/güvenli/yol node scripts/backup.js
```

- `.env` dosyası **okunmaz**. Yereldeki `.env` üretimi gösterdiği için bu bilinçli bir koruma.
- Adres `mongodump`'a geçici bir `0600` yapılandırma dosyasıyla verilir, süreç listesinde görünmez. Hata metinleri maskelenir.
- Çıktı:
  - `backup-hastane-<zaman>.archive.gz`
  - `….manifest.json`: koleksiyon başına belge sayısı ve `_id` kümesi özeti. İçerik değil.
  - Dosya izni `0600`; eski yedekler `BACKUP_KEEP_DAYS` (7) sonra silinir.
- Üretim kümesi için `BACKUP_ALLOW_PROD=1` gerekir.
- Yedek **Google Drive / iCloud klasörüne konmaz**. Kişisel veri içerir; şifreli disk veya kurumun yedek alanı kullanılır.

## 5. Geri yükleme ve doğrulama

**Doğrulama** (ayrı veritabanına yükler, karşılaştırır, sonra siler):
```bash
RESTORE_URI=mongodb://127.0.0.1:27018 node scripts/restore-verify.js /yol/backup-hastane-….archive.gz
```

**Gerçek geri dönüş:**
1. Uygulamayı bakım moduna alın: sunucuyu durdurun.
2. Önce **mevcut durumun** yedeğini alın.
3. Yedeği ayrı bir veritabanına yükleyip doğrulayın (`--keep`, hedef ad verin).
4. Kaynakla aynı ada yükleyin: `restore-verify.js <arşiv> hastane --keep`.
   - Bu komut `--drop` ile koleksiyonların üzerine yazar.
   - Üretimde `RESTORE_ALLOW_PROD=1` gerekir ve yalnız onaylı geri dönüş planıyla çalıştırılır.
5. Sunucuyu önceki kod sürümüyle açın, `GET /api/health` ile kontrol edin, sonra bir planı açıp kontrol edin.

**Doğrulanan:**
- 22 Kas 2026, yerel deneme veritabanı: 29 koleksiyon, 63 709 belge. Yedek → ayrı veritabanına geri yükleme → sayılar ve kimlik özetleri birebir aynı.
- Üretim adresiyle çalıştırma denemesi reddedildi.
- **Deneme (Atlas) kümesinde doğrulanmadı:** bağlantı adresi yalnız Render ortam değişkeninde, yerelde yok (§7).

## 6. Kod geri dönüşü (rollback)

| Değişiklik | Geri dönüş | Veri etkisi |
|---|---|---|
| Sunucu kodu | Render/Railway'de önceki dağıtımı yeniden başlat veya `git revert` + yayın | Yeni alanlar (`revision`, `ruleContext`, `publication.version`, `ScheduleChange`) eski kodda yok sayılır; zarar vermez |
| Ön yüz | Vercel'de önceki dağıtımı "Promote" | — |
| Dizinler | `db.requests.dropIndex(...)` vb. | Yok |
| İzin türü düzeltmesi | Yalnız yedekten | Bakiye hakkı / düşülür bayrağı eski hâline döner |
| Kurum kuralları | Arayüzden önceki değerlerle kaydet | Planlar yeniden doğrulanmalı |

**Önemli:** geri dönülen eski sürüm revizyon kontrolü yapmaz. Eş zamanlı düzenlemede sessiz üzerine yazma riski geri gelir.

## 7. Açık işletim konuları

- **Deneme kümesi yedeği:** Atlas deneme adresi yerelde yok.
  - Yetkili kişi Render ortam değişkeninden alıp §4 ve §5'i kendi makinesinde çalıştırabilir.
  - Ya da Atlas'ın ücretsiz planındaki dışa aktarma kullanılabilir.
  - Ücretsiz planda Atlas sürekli yedeği **yok**.
- **Yedek otomasyonu:** zamanlanmış görev (cron) üretim sunucusunda tanımlı değil. Yer ve saklama süresi kurumla belirlenmeli (KVKK).
- **Dağıtım hedefi tutarsız:**
  - `deploy.yml` sunucuyu Railway'e gönderiyor, deneme ortamı Render'da.
  - Üretimin nerede çalışacağı karar bekliyor.
- **Paket açıkları (22 Kas):**
  - Sunucu üretim bağımlılıklarında yüksek/kritik **0**. Kalan: `exceljs` → `uuid` (orta) ve `jest` (yalnız geliştirme).
  - **Ön yüz — `xlsx` (yüksek, düzeltmesi yok):** `package.json`'da geliştirme bağımlılığı görünür, ama Excel içe aktarma ekranlarında (`WorkAreasTab`, `WorkingHoursTab`, `WorkingHoursTimesheet`) **kullanıcıya giden pakete girer**.
    - Risk: yöneticinin açtığı kötü niyetli bir Excel dosyası tarayıcıda prototip kirlenmesi veya donma yaratabilir.
    - Öneri: SheetJS'in güncel CDN sürümüne (`https://cdn.sheetjs.com`) ya da `exceljs`'e geçiş; `xlsx`'i `dependencies`'e taşıyıp denetime dahil etmek.
  - Ön yüz `vite`/`esbuild` (orta/yüksek): yalnız geliştirme sunucusunu etkiler, ana sürüm 5→8 geçişi gerekir.
  - CI denetimi `--omit=dev` ile çalışıyor; `xlsx` bu yüzden şu an CI'da **görünmüyor**.
