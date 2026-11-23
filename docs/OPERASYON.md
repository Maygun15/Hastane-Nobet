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
| 0 | **Yedek al** (§4) | `node scripts/backup.js --target=<hedef>` | — |
| 1 | Kodu yayınla (sunucu önce, sonra ön yüz) | Render/Railway + Vercel | Evet (önceki dağıtım) |
| 2 | **Ortam işareti** (bir kez) | `node scripts/setEnvironmentMarker.js --target=<hedef>` | Evet: `ops_meta` belgesi silinebilir |
| 3 | **Eski tekil dizin taraması** | `node scripts/staleIndexes.js --target=<hedef>` (rapor) → incele → `--apply` | Evet: dizin yeniden oluşturulabilir, veri değişmez |
| 4 | Güvence dizinleri | `node scripts/ensureCommercialIndexes.js --target=<hedef>` (ön tarama + önizleme) → `--apply` → tekrar (0) | Evet: dizinler silinebilir, veri değişmez |
| 5 | Eski otomatik plan kopyaları (isteğe bağlı) | `node scripts/pruneGeneratedSchedules.js --target=<hedef>` (kuru) → `--apply` | Yalnız yedekten |
| 6 | İzin türü düzeltmesi (yalnız "Y" düşülür, 20 gün hak) | `scripts/fixLeaveTypes.js` (kuru) → `--apply` | Yedekten (§5) |
| 7 | Kurum kurallarını gir / taşı | Arayüz (§2.5) | Evet: kural kaydı yeni revizyonla değiştirilebilir |
| 8 | Planları güncel kurallarla doğrula | Yayın çubuğu → "Güncel kurallarla doğrula" (`/monthly/revalidate`) | — |
| 9 | **Dağıtım doğrulaması** | `node scripts/verify-deploy.mjs <hedef>` → "DOĞRULAMA TAMAM" | — |

**Hedef seçimi:** veritabanına yazan her betik `--target=local|staging|production` ister (`scripts/lib/dbTarget.js`).
- `.env` okunmaz.
- Bağlantıdan önce adres–hedef uyumu denetlenir: deneme hedefi üretim kümesini gösteremez.
- Bağlantıdan sonra veritabanındaki `ops_meta.environment` işareti hedefle aynı olmalı.
- Üretim için `PRODUCTION_MONGODB_URI` + `ALLOW_PRODUCTION=1` ve onaylı plan gerekir.

**Deneme adresi:** `STAGING_MONGODB_URI` ortam değişkeni, `~/nöbet/.staging-erisim.env` ya da `~/nöbet/.staging-uri`; izin 600 olmalı.

**Üretim için önemli (22 Kas 2026 bulgusu):** deneme veritabanında çok kurumlu yapıdan önce kalmış 7 eski tekil dizin vardı.
- Bu dizinler ikinci kurumun aynı izin kodunu, kural kaydını ve izin takvimini kullanmasını engelliyordu.
- Deneme ortamında silindi.
- Üretim veritabanı aynı eski koddan oluştuğu için **büyük olasılıkla aynı dizinleri taşıyor**. Adım 3 üretimde mutlaka kuru çalıştırılmalı.

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

**Elle:**
```bash
cd my-backend-project
BACKUP_DIR=/güvenli/yol node scripts/backup.js --target=staging --record
```

- Adres hedefe göre gelir (§3 "Hedef seçimi"). Veritabanının ortam işareti hedefle aynı değilse yedek **alınmaz**.
- Adres `mongodump`'a geçici bir `0600` dosyayla verilir; süreç listesinde görünmez, hata metinleri maskelenir.
- Çıktı:
  - `backup-<hedef>-hastane-<zaman>.archive.gz`
  - `….manifest.json`: koleksiyon başına belge sayısı, `_id` özeti ve dizin listesi.
  - Döküm sürerken yazılan koleksiyonlar (ör. `auditlogs`) önce/sonra sayımıyla işaretlenir.
- `--record` başarı zamanını `ops_meta.backupStatus`'a yazar. Bu bilgi `/api/version` → `backup` alanında görünür; 36 saatten eskiyse `stale: true`.
- Zaman aşımı `BACKUP_TIMEOUT_MIN` (varsayılan 60).
  - Atlas ücretsiz katmanında döküm yavaştır: deneme ortamında 7,4 MB / 3 704 belge yaklaşık 20 dakika sürdü.
  - Süreyi uzatan, eski otomatik plan kopyalarıydı (§3 adım 5).
- Yedek **Google Drive / iCloud klasörüne konmaz**; kişisel veri içerir.

**Otomatik (GitHub Actions, `.github/workflows/staging-backup.yml`):**
- Her gün 05:30 TSİ. Zamanlama yalnız `main` dalındaki dosyadan çalışır; o zamana kadar deneme dalına her gönderimde çalışır.
- Adımlar: yedek → AES-256 (pbkdf2, 200 000 tur) şifreleme → geçici MongoDB'ye geri yükleme (sayı, kimlik özeti, dizin) → uygulama geri yüklenen veriyle açılır ve `/api/version` okunur → sonuç `ops_meta.backupStatus`'a yazılır.
- Şifreli yedek 7 gün çalışma eki olarak saklanır.
- Başarısız çalışmayı GitHub e-postayla bildirir.
- Gerekli depo gizli değerleri:
  - `STAGING_MONGODB_URI`
  - `BACKUP_PASSPHRASE` (≥32 karakter; ayrıca güvenli yerde saklanmalı, yoksa yedek açılamaz)
- Şifreli yedeği açmak:
  ```bash
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in <dosya>.enc -out <dosya> -pass env:BACKUP_PASSPHRASE
  ```

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
- **Paket açıkları (23 Kas):**
  - Ön yüz ve sunucu üretim bağımlılıklarında yüksek/kritik **0**.
  - `xlsx` 0.20.3'e yükseltildi (SheetJS resmî paketi, `vendor/`, ayrıntı `vendor/README.md`).
  - Kalan: ön yüz `vite`/`esbuild` (yalnız geliştirme sunucusu; ana sürüm 5→8 gerekir), sunucuda `exceljs` → `uuid` (orta) ve `jest` (geliştirme).
