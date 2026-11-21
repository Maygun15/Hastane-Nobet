# Ürün Durum Raporu ve Geliştirme Sırası — Hastane Nöbet Planlama

**Tarih:** 17 Kasım 2026 · **Dal:** `vercel-preview-stabilizasyon` (son commit `258ff30`)

**Kapsam ve yöntem:**
- Kaynak kod okundu.
- Testler ve derleme çalıştırıldı.
- Deneme sitesinde (`nobet-staging.onrender.com`, canlı verinin anonimleştirilmiş kopyası) yönetici turu yapıldı.
- Deneme veritabanında salt-okur ölçümler alındı.
- Canlı sisteme dokunulmadı.

**Kanıt gösterimi:**
- `dosya:satır` = kod kanıtı
- **[ölçüm]** = veritabanı veya çalıştırma sonucu
- **[ekran]** = deneme sitesinde gözlem
- **[doğrulanamadı]** = kanıta erişilemedi

---

## 1. Mevcut proje

### 1.1 Teknoloji

| Katman | Teknoloji | Kanıt |
|---|---|---|
| Ön yüz | React 18, Vite, Tailwind, react-router-dom, zustand (kısmi), sonner (bildirim), xlsx, jspdf | `package.json` |
| Sunucu | Node ≥20, Express, Mongoose, JWT (+ yenileme çerezi), bcrypt, helmet, rate-limit, express-mongo-sanitize, hpp, exceljs, nodemailer, Sentry | `my-backend-project/package.json`, `index.js` |
| Veritabanı | MongoDB Atlas, tek veritabanı `hastane` (adı kodda sabit) | `index.js:157` |
| Durum yönetimi | Ağırlıkla bileşen state'i + **tarayıcı localStorage** (59 dosyada). Az sayıda zustand store | `src/store/`, `grep localStorage` **[ölçüm]** |
| Barındırma | Canlı: Vercel (ön yüz) + Railway (sunucu, deneme süresi bitmiş, Mart'tan beri kapalı). Deneme: Render (ücretsiz) + Atlas M0 | `docs/CANLIYA_ALMA_PLANI.md` |
| CI | GitHub Actions: ön yüz derleme, sunucu `npm audit`, sözdizimi kontrolü, `npm test` | `.github/workflows/ci.yml`, `deploy.yml` |

### 1.2 Giriş noktaları ve yapı
- **Ön yüz:** `src/main.jsx` → `AuthProvider` → `App.jsx` → `routes.jsx`. İşlevler `src/tabs/` (26), `src/pages/` (19) ve `src/components/` (54) altında. Planlama motorunun tarayıcı kopyası `src/engine/`, `src/lib/` altında.
- **Sunucu:** `my-backend-project/index.js`
  - Bütün iş uçları `secureTenant = [auth, ensureActive, extractHospital, applyHospitalContext]` zinciriyle bağlanıyor (`index.js:462`).
  - 21 rota dosyası, 86 servis dosyası, 28 model.
  - Planlama motoru `services/scheduler/` altında: `engine.js`, `candidateBuilder/`, `constraints.js`, `policies/`, `scoring.js`.
- **İlişki:** Ön yüz planlama ekranları sunucudaki `/api/scheduler`, `/api/schedules/monthly`, `/publish` uçlarını çağırıyor. Personel, parametre ve izin ekranları ise **hem API'yi hem localStorage önbelleğini** kullanıyor.

### 1.3 Veri nerede tutuluyor

| Veri | Tarayıcı | Sunucu / VT | Not |
|---|---|---|---|
| Aylık çizelge (görev satırı, isimler, yayın durumu) | önbellek (`scheduleRowsV2`) | ✅ `monthlyschedules` + `assignments` | Kaydetme tüm belgeyi bir kerede yazıyor (son yazan kazanır) |
| Personel, kullanıcı, servis, izin türü, vardiya, tatil | önbellek (`nurses`, `doctors`, `peopleV2`, `leaveTypesV2`, `workingHours`…) | ✅ | Çift kaynak. Önbellek bayatlayabilir |
| **Nöbet kuralları ve değerleri** | **✅ `dutyRulesV2`** | VT kaydı boş **[ölçüm]** | Motor kural değerlerini tarayıcının gönderdiği yükten alıyor. `PlanTab.jsx` `readDutyRulesFromLS()`, `constraints.js:244` |
| Süpervizör ayarı / havuzu | **✅ yalnız tarayıcı** (`supervisorConfig`, `supervisorPool`) | ❌ | `PlanTab.jsx` `LS.get("supervisorConfig")` |
| İzin günleri | önbellek | ✅ `settings.leavesV2` (anahtar-değer belge) | İzinler tek büyük ayar belgesinde |
| Talepler, bakiyeler, bildirim, işlem günlüğü | — | ✅ | |

**Sonuç:** Aynı hastanede iki planlayıcı farklı bilgisayarda farklı kural değerleriyle plan üretebilir. Bu ticari ürün için birinci sıradaki mimari risk.

### 1.4 Roller ve sunucudaki erişim kontrolü
- **Roller:** `user` (personel), `staff` (yetkili / sorumlu), `admin`, `superadmin`. Eski adlar bunlara eşleniyor (`models/User.js:10`, `middleware/authz.js:2`).
- **Kontroller:**
  - `requireRole` (`authz.js:15`)
  - `sameServiceOrAdmin`: `staff` yalnız kendi servisleri; `user` yalnız okuma (`authz.js:33`)
  - `requireSpecificServiceScope`
  - Kurum ayrımı: `hospitalScope` eklentisi her sorguya `hospitalId` ekliyor (`models/plugins/hospitalScope.js`)
- **Örnek:** Çizelge kaydetme `PUT /api/schedules/monthly` → servis kapsamı + `sameServiceOrAdmin` (`schedules.routes.js:1351`). Yayınlama `requireRole('admin','authorized','manager')` (`:2686`).
- **Meslek ile erişim rolü:** Kodda ayrı alanlar: `Person.role` = Nurse/Doctor (meslek), `User.role` = erişim. ✅ Doğru ayrım. Ama **beceri / sertifika / kıdem** alanları kurala bağlı değil (yalnız `areas` ve `shiftCodes` kullanılıyor).
- **Test:** `tenant-isolation.security`, `serviceScopeGuard`, `scheduleAssignDeleteScope`, `aiConfirmActionRoleGuard` testleri geçiyor **[ölçüm]**.

### 1.5 Test ve derleme (gerçek sonuçlar, 17 Kas)

| Kontrol | Sonuç |
|---|---|
| Ön yüz birim testleri (`node --test`) | 16 / 16 ✅ |
| Ön yüz bileşen testleri (vitest) | 41 / 41 ✅ |
| Sunucu testleri (jest) | 32 dosya, 387 / 387 ✅ |
| Ön yüz derleme (vite) | ✅ (büyük paket uyarısı) |
| ESLint | ❌ çalışmıyor: `@eslint/js` paketi yok (`eslint.config.js`) |
| `npm audit` ön yüz | 1 kritik (`dompurify`), 3 yüksek (`react-router`, `zod`) |
| `npm audit` sunucu | orta düzey (`@opentelemetry/*`, Sentry bağımlılığı) |
| CI'da ön yüz testleri | ❌ yalnız derleme çalışıyor; vitest / node testleri CI'da yok |

---

## 2. Ürün modülleri

Durum gösterimi: ✅ çalışıyor · 🟡 kısmen · ❌ yok / bozuk

| Modül | Durum | Kanıt ve not | Bağımlı olduğu |
|---|---|---|---|
| Kurum / servis / birim / çalışma alanı | 🟡 | 1 hastane, 54 servis, 12 alan **[ölçüm]**. Kurum yönetim ekranı yok. Eski kayıtların bir kısmı hastanesizdi (taşıma yazıldı) | — |
| Personel, meslek, beceri, alan uygunluğu | 🟡 | Alan ve vardiya kodu uygunluğu motorda uygulanıyor: Aralık'ta 486 atamada 0 uygunsuz **[ölçüm]**. Beceri / sertifika / kıdem / gebelik-sağlık kısıtı veri modeli ve kural yok | Kurum, alan |
| Vardiya kodları ve günlük ihtiyaç | ✅ | 11 vardiya, görev satırı bazlı günlük kişi sayısı (Çizelge Yapısı). Şablon en son dolu aydan taşınıyor (düzeltildi) | Vardiya |
| İzin türleri, bireysel takvim, toplu izin | 🟡 | Toplu izin matrisi ve kişi takvimi çalışıyor **[ekran]**. Bakiye mantığı bu oturumda düzeltildi. Kişi bazlı yıllık hak (20/30 gün) girilmemiş | Personel |
| Manuel atama ve otomatik planlama | ✅ / 🟡 | Otomatik: Aralık 486 atama, 0 dinlenme ihlali, 0 izin çakışması **[ölçüm]**. Üç ayrı üretim yolu var ("Çizelgeden Doldur", Planlama "Planla", "AI Çizelge"); hangisinin esas olduğu belirsiz | Kurallar, izin |
| Çakışma ve ihlal açıklamaları | 🟡 | Risk paneli boş görevi ve nedenini veriyor, ama teknik dille: `SERVICE_SUPERVISOR_ONLY x47` **[ekran]**. Planlama ekranında yanıltıcı "Planlama çalıştırılamadı" | Motor |
| Taslak / yayın / revizyon | 🟡 | Taslak ↔ yayınlandı var, risk kararı kaydı var (`schedulePublicationService.js`). **Revize** durumu, sürüm geçmişi ve değişiklik bildirimi yok | Çizelge |
| Saat ve nöbet dağılım raporları | 🟡 | Adillik raporu, aylık mesai, fazla mesai çalışıyor. Gece tanımı ve bazı etiketler çelişkili; saat normu açığı (768 sa) | Çizelge |
| Excel içe / dışa aktarma | 🟡 | 24 dosyada Excel kullanımı; personel, parametre, kullanıcı, çizelge. Uçtan uca indirme / yükleme bu turda denenmedi **[doğrulanamadı]** | Hepsi |
| Hesap, yetki, işlem geçmişi | 🟡 | Roller çalışıyor; geçici şifre hatası düzeltildi. İşlem günlüğü her GET'i kaydediyor, iş olaylarını (kim hangi atamayı değiştirdi) ayrı tutmuyor; 90 gün sonra siliniyor (`models/AuditLog.js:18`) | Kullanıcı |

---

## 3. Nöbet kuralları — görünürlük

Ayrıntılı envanter `docs/KURAL_ENVANTERI.md` belgesinde. Ekranda her kural kartında rozet var.

| Kural | Mevcut davranış | Nerede | Doğrulama |
|---|---|---|---|
| İzinle çakışan atama | **Zorunlu**: izin günü atama yapılmaz | `candidateBuilder/rules/leaveBlock.rule.js` | Aralık 0 çakışma **[ölçüm]** (Aralık'ta izin azdı → sınırlı kanıt) |
| Aynı gün çift / örtüşen görev | **Zorunlu**: günde tek vardiya | `oneShiftPerDay.rule.js` | 0 örtüşme **[ölçüm]** |
| Gece sonrası çalışma | **Zorunlu**: `N` sonrası ertesi gün yok. `V2` "gece eşdeğeri" ayrı | `restAfterNight.rule.js`, `utils/nightShift.js:4` | `scheduler.restAfterNight` testi ✅, 0 ihlal **[ölçüm]** |
| Dinlenme süresi (11 / 12 saat) | **Koşullu**: yalnız kural değeri istekle gelirse | `constraints.js:244`; değer tarayıcıdaki `dutyRulesV2`'den | Aralık'ta 0 ihlal, ama başka tarayıcıda aynı sonuç **[doğrulanamadı]** |
| Ardışık gün / haftalık nöbet sınırı | **Koşullu**: değer verilirse | `maxConsecutiveDays.rule.js:9`, `maxWeeklyShifts.rule.js:14` | Değer 0 ise kural kapalı |
| Aylar arası geçiş | ❌ **Önceki ay motor girdisinde yok**. Ayın 1'inde "dün gece nöbetteydi" ve ardışık gün sayacı sıfırdan başlıyor | `inputBuilder.js` yalnız seçili ayın günleri; `contracts/staff.js:24` `consecutiveDays: 0`; risk paneli de ay içi (`scheduleRiskService.js:135`) | Kod incelemesi; testle **[doğrulanamadı]** |
| Alan uygunluğu | **Zorunlu** | `taskPlaceTaxonomy.js:235` (`person.areas`) | 0 uygunsuz **[ölçüm]** |
| Günlük ihtiyacın karşılanması | **Hedef**: aday yoksa boş bırakılır ve risk olarak gösterilir | `engine.js` (`NO_CANDIDATE`), `scheduleRiskService.js:229` | Aralık'ta 2 boş görev (7 ve 28 Ara) **[ekran]** |
| Adalet (gece / hafta sonu / toplam yük) | **Tercih** (puanlama) | `fairnessCounters.js`, `scoring.js` | `schedulerFairnessBalance` testi ✅; dağılım 7–20 nöbet **[ölçüm]** |

**Zorunlu ile tercih ayrımı:**
- Kodda iki katman var: `candidateBuilder/rules/*` aday eler (**zorunlu**); `scoring.js` / `policies/` sıralar (**tercih**).
- Ekrandaki 70 kuralın 11'i zorunlu katmanda, 7'si tercih katmanında, 12'si şablon üzerinden karşılanıyor. 40'ı hiçbir katmanda yok.

**Plan kurulamadığında açıklama:** Boş görev için "havuz 57 → uygun 47 → 0" ve engel sayıları üretiliyor. Bu iyi bir temel. Ama dil teknik, "ne yapmalıyım" önerisi yok.

**Kural kaynağı (mevzuat / kurum / tercih):**
- Kodda bu ayrım **yok**.
- Sayısal değerler (11 saat, 6 gün, 80 saat, 184 saat normu, 20 günlük yıllık izin) ekranda veya betikte **varsayım** olarak duruyor.
- Hiçbiri bir mevzuat maddesine bağlanmamış. Hukuki doğrulama bu incelemenin kapsamında değil.

---

## 4. UX akışı (planlayıcı: hazırlık → yayın)

Akış: Personel → Parametreler (alan, vardiya, izin türü, tatil) → Toplu izin → Çizelgeler (servis + ay seç) → şablon taşıma → Çizelgeden Doldur → risk paneli → Yayınla → Adillik raporu.

| Durum | Bulgu |
|---|---|
| İlk açılış / boş veri | Planlama ekranı varsayılan "Tümü" serviste boş tablo gösteriyor; ne yapılacağını söylemiyor. Personel tarafında yayınlanmamış ayda yönetici talimatı görünüyor ("Çizelgeden Doldur çalıştırın") **[ekran]** |
| Yükleme ve kaydetme | Çizelge otomatik kaydediliyor (1,2 sn sonra). "Son kayıt" zamanı sunucu yanıtından geliyor ✅ (`DutyRowsEditor.jsx` `setLastSavedInfo`) |
| Geçersiz giriş / kural ihlali | Risk paneli yayın öncesi karar istiyor ✅. Riskli elle atamada onay soruluyor (`SchedulePublishBar.jsx:55`). Onaylar `window.confirm` ile; erişilebilir değil, telefonda kaba |
| Sunucu hatası / yeniden deneme | Kayıt hatasında "Kaydetme hatası: …" gösteriliyor. Otomatik yeniden deneme ve girilen verinin korunması ayrıca test edilmedi **[doğrulanamadı]**. İzin onayı hatasında işlem geri alınıyor, talep "beklemede" kalıyor ✅ **[ekran]** |
| Başarı mesajı sunucuya dayanıyor mu | Personel ve hesap işlemlerinde `await` sonrası bildirim ✅. Kural ekranındaki bazı değişiklikler önce tarayıcıya yazılıyor, sunucuya gitmeyebilir **[doğrulanamadı]** |
| Telefon | Yatay taşma yok ✅. Menü "⋮" arkasında, AI düğmesi ana düğmeyi örtüyor, kart metinleri taşıyor **[ekran]** |
| Klavye | Test edilmedi **[doğrulanamadı]** |

---

## 5. Ticari kullanıma hazırlık

| Konu | Mevcut kanıt | Eksik |
|---|---|---|
| Kurum + rol erişimi | `hospitalScope` + rol ara katmanları; güvenlik testleri ✅ | Eski veride tip ve eksik `hospitalId` (taşıma betiği hazır); kurum yöneticisi ekranı yok |
| Kurumlar arası ayrım | Sorgu düzeyinde var | Eski **global benzersiz indeksler** (`settings.key_1_serviceId_1`, `dutyrules`, `monthlyschedules`, `services.code`) ikinci kurumda çakışır **[ölçüm]**. Çok kurumdan önce indeks taşıması şart |
| Eş zamanlı düzenleme | ❌ | `PUT /monthly` tüm belgeyi sürüm kontrolsüz yazıyor (`schedules.routes.js:1298`); otomatik kayıt 1,2 sn. İki planlayıcı birbirinin işini sessizce siler |
| Tekrarlanan istek | 🟡 | İzin onayında durum karşılaştırmalı güncelleme var (`requestService.js` `casRequest`). Talep oluşturma, yayınlama, toplu hesap açmada idempotency anahtarı yok |
| Kim, neyi, ne zaman | 🟡 | `AuditLog` her isteği tutuyor (gövde maskeli); iş olayı ayrımı yok; 90 gün TTL |
| Yedek / geri yükleme / sürüm geri dönüşü | 🟡 | Canlı Atlas M0'da otomatik yedek **yok** **[ölçüm 16 Kas]**; elle `mongodump` alındı. Geri yükleme deneme ortamında prova edildi ✅. Uygulama sürümü git ile geri alınabilir; şema taşımaları için geri dönüş betikleri yok |
| Hata izleme / destek / kurulum | 🟡 | Sunucuda Sentry (DSN tanımlıysa); ön yüzde yok. Kurulum belgeleri var (`KURULUM_ADIMLAR.md`, `DEPLOYMENT.md`); müşteri kurulum otomasyonu yok |
| Kişisel veri | 🟡 | TC / telefon / e-posta maskeli gösterim; deneme anonimleştirme betiği; AI özellikleri dış sağlayıcıya veri gönderebilir. Atlas ve Render **Frankfurt** → yurt dışı aktarım konusu. Aydınlatma metni, saklama süresi politikası ve erişim kaydı yok. **Hukuki uygunluk değerlendirilmedi**; uzman incelemesi gerekli |

**Dağıtım seçenekleri**

| | Kurum başına kurulum | Çok kurumlu çevrimiçi hizmet (SaaS) |
|---|---|---|
| Mevcut mimariye uyum | Yüksek: tek hastane varsayımı (`dbName` sabit, global indeksler) zaten böyle | Orta: `hospitalScope` hazır; global indeksler, kurum açma akışı ve kurum yöneticisi gerekli |
| Veri yeri / KVKK | Hastanenin kendi sunucusu veya TR bulut → aktarım sorunu azalır | Türkiye'de barındırma gerekebilir (karar ve hukuki inceleme) |
| Bakım maliyeti | Her kurum ayrı güncelleme, sürüm dağınıklığı | Tek sürüm; operasyon tek yerde |
| Öneri | Pilot ve ilk 1–3 kurum | 3+ kurumda geçiş; indeks ve kurum yönetimi işleri önce |

**Açık ticari kararlar:** lisans / abonelik modeli (kurum başı mı, personel başı mı), barındırmayı kimin yapacağı, destek düzeyi, veri sorumlusu / işleyen rolleri.

**Pilotta denenmesi gereken gerçek senaryolar:**
1. Aralık'ı sıfırdan kurup yayınlamak
2. Yayından sonra hastalık raporu yüzünden 3 nöbeti değiştirmek (revizyon)
3. İki personelin takası
4. Personelin telefondan izin istemesi ve onay
5. Ay sonu fazla mesai çıktısının resmi forma aktarılması
6. Bayram / arife günleri
7. Ayın 31'inde gece nöbeti tutan kişinin 1'inde yazılmaması
8. Sorumlu yokken ikinci planlayıcının düzenlemesi

---

## 6. Yol haritası

Aşamalar: Problem / kullanıcı → gereksinim → plan → UX → UI → mimari → VT / backend / frontend → test → yayın → bakım.

Her iş paketi aynı döngüyle yürür:
1. Kısa tasarım notu (ekran taslağı + veri değişikliği)
2. Uygulama
3. Otomatik test (başarı, hata, sınır)
4. Deneme ortamında kabul
5. Canlıya taşıma: kuru çalıştırma → onay → uygula

**Bu oturumda tamamlananlar** (tekrar planlanmadı):
- Boş ay kopyalama
- Hastanesiz / metin tipli kayıtlar
- İzin onayı ve bakiye
- Şablon taşıma
- Geçici şifre
- Maskeleme
- Kural rozetleri
- Deneme anonimleştirme
- Hesap denetimi

### Sıralı iş paketleri

| # | İş paketi | Öncelik | Büyüklük | Pilot öncesi? |
|---|---|---|---|---|
| 1 | Planlama girdileri sunucuda tek kaynak | P0 | M | ✅ |
| 2 | Aylar arası geçiş | P0 | S–M | ✅ |
| 3 | Eş zamanlı düzenleme koruması | P0 | M | ✅ (en azından uyarı) |
| 4 | Acil zorunlu kural seti + kural kaynağı | P1 | M | kısmen |
| 5 | Plan revizyonu ve değişiklik bildirimi | P1 | M | pilot sırasında |
| 6 | İzin hakkı ve saat normu politikası | P1 | S–M | ✅ (karar + veri) |
| 7 | Anlaşılır açıklamalar ve mesajlar | P1 | S | ✅ |
| 8 | İş olayı denetim kaydı | P2 | M | pilot sırasında |
| 9 | Kod sağlığı: lint, CI testleri, bağımlılık açıkları | P1 | S | ✅ |
| 10 | Operasyon: yedek, izleme, geri dönüş | P0 | S–M | ✅ |
| 11 | KVKK paketi | P1 | M | başlat |
| 12 | Ürün sadeleştirme: tek üretim yolu, gizli dev ekranları, mobil menü | P2 | M | kısmen |
| 13 | Çok kurum hazırlığı: indeksler, kurum açma | P3 | L | ❌ |

### İş paketi ayrıntıları

**İP-1 · Planlama girdileri sunucuda tek kaynak**
- **Fayda:** Aynı ay için hangi bilgisayardan üretilirse üretilsin aynı kurallarla aynı plan. Planlayıcı değişse de kurallar kaybolmaz.
- **Kanıt:**
  - Kural değerleri `dutyRulesV2` (localStorage); `PlanTab.jsx` `readDutyRulesFromLS()`; süpervizör ayarı yalnız tarayıcıda.
  - Veritabanındaki kural kaydı boş **[ölçüm]**.
  - `constraints.js:244` dinlenme kuralı değer gelmezse çalışmıyor.
- **Modüller:** Parametreler (kurallar, süpervizör), `PlanTab`, `DutyRowsEditor`, `/api/scheduler`, `/api/duty-rules`, `services/scheduler/inputBuilder.js`.
- **Ön koşul:** Yok.
- **Kabul:**
  1. Planlama isteği kural değeri içermese de sunucu kayıtlı kuralı kullanır.
  2. İki farklı tarayıcıdan aynı ay için üretilen plan aynı kısıtlarla doğrulanır.
  3. Kural ekranında kaydet → sayfayı yenile → değer sunucudan gelir.
- **Testler:**
  - Başarı: kayıtlı `MIN_REST_HOURS=11` ile V1 (08–24) → ertesi gün M (08–16) atanmaz.
  - Hata: kural kaydı yoksa güvenli varsayılan + uyarı.
  - Sınır: değer 0 / boş / metin.
- **Veri geçişi:** Tarayıcıdaki `dutyRulesV2` ve `supervisorConfig` ilk açılışta tek seferlik "sunucuya aktar" ile taşınır; eski anahtar okunmaya devam eder (geri uyum).
- **Geri dönüş:** Sunucu kaydı silinirse eski davranışa düşer.
- **Belirsizlik:** Hangi kural değerleri kurum kararı, hangileri mevzuat → İP-4 ile birlikte netleşir.

**İP-2 · Aylar arası geçiş**
- **Fayda:** Ayın 31'inde gece nöbeti tutan kişi ayın 1'inde yazılmaz; ardışık gün sınırı ay dönümünde doğru sayılır.
- **Kanıt:** `inputBuilder.js` yalnız seçili ay; `contracts/staff.js:24` `consecutiveDays: 0`; risk servisi ay içi.
- **Modüller:** Motor girdisi, risk servisi.
- **Ön koşul:** İP-1 (aynı girdi hattı).
- **Kabul:** Önceki ayın son 7 günü salt-okunur girdi olarak eklenir; ayın 1'i için gece sonrası dinlenme ve ardışık gün kuralı uygulanır; risk paneli ay dönümü ihlalini gösterir.
- **Testler:**
  - 30 Kas `N` → 1 Ara atanamaz.
  - Önceki ay yoksa uyarı ("Kasım verisi yok; ay başı kontrolü sınırlı").
  - Şubat → Mart ve yıl dönümü (Ara → Oca).
- **Veri:** Değişiklik yok.
- **Belirsizlik:** Pilotta Kasım verisi sistemde yok; ya Kasım'ın son 2–3 günü girilir ya da elle kontrol edilir.

**İP-3 · Eş zamanlı düzenleme koruması**
- **Fayda:** İki planlayıcı aynı ayı açtığında birinin işi sessizce silinmez.
- **Kanıt:** `schedules.routes.js:1298` sürüm kontrolsüz `findOneAndUpdate`; otomatik kayıt 1,2 sn.
- **Modüller:** `PUT /monthly`, `DutyRowsEditor`.
- **Kabul:**
  - Kayıt isteği son bilinen `updatedAt` / sürümü taşır.
  - Sunucu farklıysa **409** döner.
  - Ekran "Bu ay başka bir kullanıcı tarafından değiştirildi: [kim, ne zaman]. Yenile / benimkini koru" seçeneği sunar.
  - Otomatik kayıt çakışmada durur.
- **Testler:** Eşzamanlı iki kayıt → biri 409; aynı kullanıcı ardışık kayıt → çakışma yok; sürüm alanı olmayan eski istemci → geri uyum modu (uyarı kaydı).
- **Veri:** Belgeye `revision` sayacı eklenir (eski belgelerde yoksa 0 kabul).
- **Geri dönüş:** Alan yok sayılabilir.

**İP-4 · Acil zorunlu kural seti ve kural kaynağı**
- **Fayda:** Yöneticiye "bu plan şu kuralları kesin sağlar" güvencesi.
- **Kanıt:** 70 kuralın 40'ı motorda yok (`docs/KURAL_ENVANTERI.md`). Gebelik / sağlık kısıtı veri modeli yok.
- **Kabul:**
  - Her kuralda `kaynak` (mevzuat / kurum kararı / tercih) ve `tür` (zorunlu / tercih) alanı var.
  - Acil için seçilen 4–6 kural motorda uygulanıyor ve testli.
  - Personel kartında "gece yok / yalnız gündüz / en fazla N nöbet" kısıtı var.
- **Testler:** Her kural için ihlal üreten senaryo; kısıt varken ihtiyaç karşılanamıyorsa açıklama.
- **Veri:** Personel kartına kısıt alanları (isteğe bağlı, geri uyumlu).
- **Belirsizlik:** Hangi değerler mevzuattan geliyor → kurum ve hukuk teyidi.

**İP-5 · Plan revizyonu**
- **Fayda:** Yayından sonra yapılan değişiklik izlenir, personel bilgilendirilir.
- **Kanıt:** Yayın durumu yalnız `draft` / `published`.
- **Kabul:**
  - Yayınlanmış ayda değişiklik → "revize" işareti, değişen atamaların listesi, sürüm numarası.
  - Etkilenen personele bildirim.
  - Önceki sürüm görüntülenebilir.
- **Testler:** Yayın → değişiklik → bildirim yalnız etkilenene; geri al.
- **Veri:** `publication.revision`, ayrı sürüm koleksiyonu.

**İP-6 · İzin hakkı ve saat normu**
- **Fayda:** Doğru bakiye, doğru fazla mesai.
- **Kanıt:**
  - Bakiye düzeltmesi yapıldı.
  - Kişi bazlı hak yok.
  - Aralık iş ihtiyacı 9.904 sa < norm 10.672 sa **[ölçüm]**.
- **Kabul:** Kişi bazlı yıllık hak (Excel ile); norm politikası (devir / tamamlama) ayarlanabilir.
- **Testler:** Hak 20 / 30, devir hesabı.
- **Belirsizlik:** Norm politikası (açık soru 2).

**İP-7 · Anlaşılır açıklamalar ve mesajlar**
- **Fayda:** Planlayıcı "neden boş, ne yapmalıyım" sorusuna ekranda cevap bulur.
- **Kanıt:** `SERVICE_SUPERVISOR_ONLY x47`; "Planlama çalıştırılamadı"; personelde "0% tamamlanmış" ve yönetici talimatı **[ekran]**.
- **Kabul:** Engel kodları Türkçe cümleye çevrilir + öneri ("Servis Sorumlusu alanına bir kişi daha ekleyin"); yanıltıcı 4 mesaj düzeltilir.
- **Testler:** Bileşen testleri (vitest).

**İP-8 · İş olayı denetim kaydı**
- **Fayda:** "Ali'nin 5 Aralık nöbetini kim, ne zaman değiştirdi?" sorusu cevaplanır.
- **Kanıt:** `auditLogger` her GET'i yazıyor; 90 gün TTL.
- **Kabul:** Atama değişikliği, yayın, onay, rol değişikliği ayrı olay tipi; önce/sonra değeri; ekranda filtre; saklama süresi ayarlanabilir.
- **Veri:** Yeni koleksiyon; eski günlük dokunulmaz.

**İP-9 · Kod sağlığı**
- **Kanıt:** ESLint çalışmıyor; ön yüz testleri CI'da yok; `dompurify` kritik, `react-router` / `zod` yüksek açık.
- **Kabul:** Lint geçer; CI'da 3 test seti; yüksek / kritik açık 0.
- **Uyumluluk:** `react-router` güncellemesi yönlendirmeleri etkileyebilir → yönlendirme testleri eklenir.

**İP-10 · Operasyon**
- **Fayda:** Veri kaybı ve görünmeyen hata riski azalır.
- **Kanıt:** Canlı M0'da yedek yok; Railway kapalı; ön yüzde hata izleme yok.
- **Kabul:**
  - Günlük otomatik yedek + aylık geri yükleme provası
  - Sağlık izleme ve uyarı
  - Ön yüz hata izleme
  - Sürüm geri dönüş adımları yazılı
- **Belirsizlik:** Barındırma ve bütçe kararı.

**İP-11 · KVKK paketi**
- Kapsam: veri envanteri, aydınlatma metni, saklama / imha süreleri, erişim kaydı, AI kapalı varsayılan, yurt dışı barındırma kararı.
- **Hukuki görüş gerekli**; bu rapor yalnız teknik tespit içerir.

**İP-12 · Ürün sadeleştirme**
- Tek plan üretim yolu seçilir ("Çizelgeden Doldur").
- "Planlama Yönetimi", "Projection / Scheduler Health", "AI Maliyet" yöneticiden gizlenir.
- Telefonda sol menü.
- `window.confirm` yerine erişilebilir onay penceresi.

**İP-13 · Çok kurum hazırlığı**
- Global benzersiz indeksleri `hospitalId` içerecek şekilde yeniden kurma (çevrimiçi taşıma).
- Kurum açma sihirbazı, kurum yöneticisi rolü.
- **Ön koşul:** Dağıtım modeli kararı.

---

## 7. İlk ele alınması önerilen iş: İP-1

**Neden İP-1 önce:**
1. **Doğruluk kaynağı belirsizliği bütün sonuçları etkiliyor.** Bugün Aralık planı 0 ihlalle üretildi, ama dinlenme ve ardışık gün kurallarının değerleri planlayıcının tarayıcısından geliyor. Başka bilgisayarda, temizlenmiş tarayıcıda ya da yeni bir planlayıcıda aynı güvence **kanıtlanamıyor**. Ticari bir ürün "kurallarım uygulandı mı?" sorusuna her cihazda aynı cevabı vermeli.
2. **İP-2 (ay geçişi), İP-3 (eş zamanlılık) ve İP-4 (kural seti) aynı girdi hattını kullanıyor.** Önce hattı sunucuya taşımak, sonraki işlerin her birini daha küçük ve test edilebilir yapar.
3. **Geri uyumlu yapılabilir.** Eski tarayıcı anahtarları okunmaya devam eder; veri kaybı riski düşük.
4. **Pilot öncesi sığar.** Büyüklük orta. Kabul ölçütü net: iki tarayıcı, aynı ay, aynı kısıtlar.

Pilot takvimi sıkışırsa asgari güvenlik: İP-2'nin yalnız "ay başı uyarısı" kısmı ile İP-3'ün yalnız "409 + uyarı" kısmı, İP-1 ile aynı haftada yapılabilir.
