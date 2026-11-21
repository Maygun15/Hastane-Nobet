# Ticari Hazırlık — Çalışma Kaydı

Bu dosya tek çalışma kaydıdır. Oturum kesilirse bu dosya + `git log ticari-hazirlik` ile devam edilir.

- **Dal:** `ticari-hazirlik` (`vercel-preview-stabilizasyon`'dan, 258ff30)
- **Başlangıç:** 2026-11-21 22:44 · **Hedef bitiş:** 2026-11-22 06:44 (8 saat; son ~1 saat bütünleşik doğrulama + teslim)
- **Yetki kapsamı:** Yerel deneme ortamı ve deneme veritabanı (Render/Atlas staging). Canlı veri, canlı yayın, ücretli altyapı ve erişim bilgisi değişikliği **yok**.

## Başlangıç durumu (22:44)

| Kontrol | Komut | Sonuç |
|---|---|---|
| Sunucu testleri | `cd my-backend-project && npx jest --testPathPatterns='test/'` | 34 dosya, 407/407 ✅ (İP-1 değişiklikleri dahil, commit edilmemiş) |
| Ön yüz birim | `npm test` | 16/16 ✅ |
| Ön yüz bileşen | `npx vitest run` | 50/50 ✅ |
| Derleme | `npx vite build` | ✅ |
| Lint | `npx eslint src` | ❌ `@eslint/js` paketi yok |
| Bağımlılıklar | `package.json` | Ön yüz: React 18.3, Vite, react-router-dom, zustand, zod, sonner, xlsx, jspdf. Sunucu: Express, Mongoose, jsonwebtoken, bcrypt, helmet, Sentry, exceljs. Node ≥20 (yerelde 25.6) |
| Giriş noktaları | `src/main.jsx` → `App.jsx` → `routes.jsx`; `my-backend-project/index.js` (`secureTenant` zinciri) | Rapor ile aynı ✅ |

Önceki rapordaki açık bulgular (başlangıç noktası): `docs/URUN_DURUM_RAPORU_2026-11-17.md` §1.5, §3, §5.

## Öncelik sırası
A merkezi kurallar → B aylar arası → C eş zamanlı düzenleme → D zorunlu kurallar → E yayın/revizyon/geçmiş → F izin/saat/UX → G kod sağlığı/işletim.

## E2E (uçtan uca) senaryoları
`node scripts/e2e/run.mjs [A,B,C,E,F]`. Yalnız yerel çalışır (API `localhost:3100`, MongoDB `localhost:27018`); giriş bilgisi `~/nöbet/.prova-db/prova-giris.txt` dosyasından okunur, ekrana yazılmaz. Yerel sunucular: `.claude/launch.json` → `nobet-prova-db`, `nobet-prova-api`, `nobet-prova-web-5175`.

## İş paketleri

### A. Kuralların sunucuda merkezi yönetimi — ✅ tamamlandı
**Önceki davranış (kanıt):**
- Kural değerleri tarayıcıdaydı (`dutyRulesV2`).
- Sunucu kaydı tip uyuşmazlığıyla boş yazılıyordu (`dutyRules.routes.js`, nesne → `[]`).
- Motor istemci değerini sunucunun üstüne uyguluyordu (`schedulerService.js` `{...dbRules, ...payload.rules}`).
- Plan kural sürümü tutmuyordu.

**Kabul kriterleri:**
1. İki oturum aynı sürüm.
2. İstemci değeri motoru etkilemez.
3. Yetkisiz ve başka hastane değiştiremez.
4. Eksik zorunlu → açıklayıcı 422.
5. Kural değişince plan kaydı / yayın 409.
6. Eski plan "sürüm bilinmiyor".
7. Geçiş tekrarlanabilir.

**Değişiklik:**
- `services/institutionRules.js`: 7 motor kuralı kataloğu; genel → meslek → servis → servis + meslek katmanları; sürüm, kaynak, eksik zorunlu kontrolü.
- `DutyRule.policy` alanı.
- Uçlar: `GET /api/duty-rules/effective`, `PUT /policy` (expectedRevision), `POST /policy/migrate` (migrationKey).
- Planlama yalnız sunucu değerleri; `ruleContext` plana yazılır.
- `PUT /monthly` → `ruleVersion` kontrolü; `/publish` → güncel sürüm şartı; `POST /monthly/revalidate`.
- Ön yüz:
  - `InstitutionRulesPanel` (kaydet / hata / yeniden dene / geçiş önizleme / uyuşmazlık)
  - Yayın çubuğunda kural sürümü satırı
  - Düzenleyici sürüm bildirir, çakışmada otomatik kayıt durur, düzenlemeler korunur
- **Ek hata:** `ruleEngine.js` `.lean()` belgede `taskRequirements?.get is not a function`. Herhangi bir kural kaydı varken plan üretimi çöküyordu; deneme ortamında hastane taşımasından sonra da tetiklenirdi.

**Test:**
- Sunucu 407 + 3 (`ruleEngineMapLike`) ✅
- vitest 50 ✅
- E2E A 13/13 ✅ (`node scripts/e2e/run.mjs A`)

### B. Aylar arası planlama — ✅ tamamlandı
**Önceki davranış (kanıt):** Motor girdisi yalnız seçili ayın günleri (`inputBuilder.js`); kişi sayaçları `consecutiveDays: 0` ile başlıyordu (`contracts/staff.js:24`); risk paneli ay içi. 1 Ocak'ta 31 Aralık gece nöbetçisi yazılabiliyordu: önceki görev olmadan 40 denemenin 19'unda.

**Kabul kriterleri:**
1. Geriye bakış etkin kurallardan türetilir.
2. Önceki görevler kişi durumunu kurar ve aday kurallarında görünür; çıktıya ve bu ayın toplamlarına girmez.
3. Gece yarısını aşan vardiya, yıl değişimi ve ay uzunlukları doğru.
4. Önceki dönem yoksa "missing" + açıklama.
5. Planlama ve risk/yayın kontrolü aynı veri ve aynı kural.

**Değişiklik:**
- `services/scheduler/monthBoundary.js`
  - `computeLookbackDays`: dinlenme = ⌈(en uzun vardiya + en az dinlenme)/24⌉, gece sonrası 1, ardışık N, haftalık ISO pazartesi; üst sınır 31.
  - `loadPriorAssignments`: Assignment koleksiyonu, personel bazında, servisler arası. Projeksiyon yoksa önceki ay planı. İsimle eşleşen eski kayıtlar da alınır.
  - `seedPersonStateFromPrior`
- `generateMonthlyPlan({priorAssignments})`
- `buildCandidateContext`: önceki görevleri ekler.
- `scheduleRiskService.auditAssignments({priorAssignments})`: ihlal yalnız bu ayın görevine yazılır.
- Planlama yanıtı ve `ruleContext.boundary`, `/risks` ve `/revalidate` → `boundary`.
- Ön yüz: yayın çubuğunda "Ay başı kontrolü" satırı; planlama sonrası "missing" uyarısı.

**Test:**
- `test/monthBoundary.test.js` 15/15. Motor senaryoları 20'şer tekrar, kural kontrolüyle.
- Ayırt edicilik kanıtı: aynı senaryo önceki görevsiz 40 denemede 19 ihlal, önceki görevle 0.
- vitest 52 ✅.
- E2E B 5/5: 31 Ara gece nöbetçisi 10 kişi → 1 Oca ihlal 0; V1 sonrası dinlenme ihlali 0; Mart yokken "missing".

### C. Eş zamanlı düzenlemede veri kaybını önleme — ✅ tamamlandı
**Önceki davranış (kanıt):** `PUT /monthly` tüm belgeyi sürüm kontrolsüz yazıyordu (son yazan kazanır); otomatik kayıt 1,2 sn.

**Kabul kriterleri:**
1. Eski revizyonla kayıt 409 + kim / ne zaman.
2. Karşılaştırma ve güncelleme atomik.
3. Aynı anda iki kayıtta biri 409.
4. Aynı işlem kimliği tekrarı yazmaz.
5. Kullanıcının düzenlemeleri korunur; güncel plan görülür ve değişiklikler yeniden değerlendirilir.

**Değişiklik:**
- `MonthlySchedule.revision`, `lastOpId`, `updatedByName`.
- `PUT /monthly`:
  - `baseRevision` + `opId`
  - Filtre okunan revizyonu içerir, `$inc revision`.
  - Kaçan CAS / eşzamanlı ilk kayıt → 409 `SCHEDULE_REVISION_CONFLICT`.
  - Aynı `opId` → `replayed`.
- İçerik değiştiren tüm yollar revizyonu artırır: `/assign`, `DELETE /assign`, planlama write-back, geri alma, şablon taşıma, AI yürütücü.
- Düzenleyici:
  - Revizyon + işlem kimliği gönderir; ağ hatasında aynı kimlikle güvenli tekrar.
  - Çakışmada otomatik kayıt durur, değişiklikler tarayıcıya yedeklenir.
  - Seçenekler: "Güncel planı yükle", "Yedekteki değişikliklerimi geri getir", "Benimkini kaydet".
  - Aynı sayfada "Yerine ata" yapılınca güncel plan yeniden yüklenir.
- **Bulunan ek hata (veri kaybı):** GET isim tablosundan atama döndürüyor (personId yok); geri kaydedilince personId siliniyordu. Artık kaydederken önce mevcut kayıttan, sonra hastanede benzersiz isimli personelden geri yazılıyor (`restorePersonIds`). Yerel veride 486/486 personId geri geldi.

**Test:**
- `scheduleRevisionConcurrency.test.js` 7/7.
- E2E C 5/5: iki oturum; tekrar; `Promise.all` ile aynı anda iki kayıt → 200 / 409.

### E. Yayın ve işlem geçmişi — ✅ tamamlandı
**Önceki davranış (kanıt):**
- Yayın yalnız taslak / yayınlandı; her "Yayınla" herkese yeniden bildirim gönderiyordu.
- Yayından sonraki değişiklik kayıtsız ve bildirimsizdi.
- İşlem günlüğü yalnız HTTP istekleri.

**İlişki (karar):**
- Taslak → yayın (sürüm 1).
- Yayından sonra içerik değişirse "yayınlanmamış değişiklik var". Personel güncel hâli görür (ayrı yayın kopyası tutulmaz) ama bildirim almaz.
- "Değişiklikleri yayınla" → sürüm 2; önceki yayına göre fark yalnız etkilenen kişilere uygulama içi bildirim olarak gider.
- İçerik değişmeden tekrar yayın: işlem ve bildirim yok.

**Değişiklik:**
- `models/ScheduleChange.js`, `services/scheduleChangeService.js`: fark, kayıt, yayın hazırlığı (önceki yayın anlık görüntüsü).
- `publication.contentRevision` + `version`; `hasUnpublishedChanges`.
- `GET /api/schedules/changes`.
- `sendScheduleRevised` (mevcut uygulama içi bildirim altyapısı). E-posta / SMS ayrı karar, ek ücretli servis yok.
- Yayın çubuğu: sürüm, "Yayından sonra değişiklik" uyarısı, "Değişiklikleri yayınla (sürüm N)", işlem geçmişi listesi.

**Test:**
- `scheduleChangeService.test.js` 4.
- Yayın testleri +2 (tekrar yayın, revizyon yayını).
- vitest +2.
- E2E E 7/7: sürüm 1 → tekrar yayın bildirimsiz → değişiklik → geçmişte "Prova Yönetici −1 (03.12 V1 ABDULLAH AYDOĞDU)" → yeni risk kararsızken yayın engellendi → sürüm 2, tek etkilenene 1 bildirim.

### E2E tekrarlanabilirlik
`scripts/e2e/run.mjs` başta ilgili koleksiyonların anlık görüntüsünü alır, sonda geri yükler (`E2E_KEEP_DATA=1` ile tutulur). Tam koşu 30/30, art arda iki kez aynı sonuç.

### D. Pilot için zorunlu kurallar — ✅ tamamlandı (kalanlar somut görev olarak devredildi)
**Kanıt / bulgular:**
- Risk paneli kaynaksız **72 saat/hafta** sınırı uyguluyordu (`scheduleRiskService.js` `DEFAULT_LIMITS`); motor uygulamıyordu.
- Bağımsız denetimli motor testi bu yüzden kırıldı: "HAFTALIK_SAAT 2026-W50".

**Değişiklik:**
- `MAX_WEEKLY_HOURS` kurum kuralı (isteğe bağlı, kaynaklı). Motor `constraints.js` + `person.weeklyHours`; ay dönümünde de tohumlanır.
- Risk servisinde gizli varsayılan yok.
- Engel kodları Türkçe + öneri: `ISSUE_REASON_LABELS` / `ISSUE_REASON_HINTS`, `describeCandidatePipeline`.
- Uygulanma tablosu: `docs/KURAL_ENVANTERI.md`.

**Test:**
- `mandatoryRules.test.js` 3: 14 gün × 15 tekrar, bağımsız denetçi 0 ihlal; izin, alan, ihtiyaç; karşılanamayan ihtiyaç açıklaması; haftalık saat.
- `scheduleRiskService` testleri kurum değerleriyle güncellendi.
- vitest `issueExplanations` 2.
- Sunucu 441 ✅, vitest 56 ✅.

### F. İzin, çalışma saati ve kullanıcı deneyimi — ✅ tamamlandı
**Bulgular (kanıt):**
- İzin türü oluşturma/güncelleme API'si **kısaltmayı (code) ve "düşülür" bilgisini kaydetmiyordu** (`parameters.routes.js`). Onay türü kısaltmayla aradığı için API ile tanımlanan tür onayda hiç bulunamazdı.
- Talep formunda bağlantı koparsa sonuç bilinmiyordu; tekrar gönderim talebi çoğaltabilirdi.

**Değişiklik:**
- `POST/PUT /api/parameters/leave-types`: `code` (1–6 karakter) ve `isDeductible` (varsayılan false).
- `Request.clientRequestId` (kullanıcı + kimlik benzersiz). `POST /api/requests` aynı kimlikte mevcut talebi döndürür; eşzamanlı ikinci gönderim de (E11000) mevcut talebi döndürür.
- Talep formu:
  - Form başına kimlik.
  - Bağlantı kopunca "talebin ulaşıp ulaşmadığı bilinmiyor; tekrar göndermek güvenli". Form korunur, başarı mesajı yalnız sunucu yanıtından sonra.
- Aylık mesai çizelgesi: "Eksik saat devri: kurum kararı bekliyor" görünür açık karar.

**Test:**
- vitest +1 (bağlantı kopması → aynı kimlikle tekrar, form korunur).
- E2E F 7/7:
  - İzin türleri API ile kısaltmalı.
  - `fixLeaveTypes` iki kez → ikinci kuru çalıştırma 0 değişiklik.
  - Aynı kimlikle iki gönderim → 1 kayıt.
  - Rapor onayı yıllık bakiyeyi etkilemedi.
  - 3 günlük yıllık izin 20 → 17; çift onay ikinci kez düşmedi.
  - İzin günleri takvime işlendi.
  - Planlama izinli kişiyi o günlere atamadı.
- **Deneme sitesinde (Render) aynı test: doğrulama bekliyor** (yönetici girişi kullanıcıda).

### G. Kod sağlığı ve işletim — ✅ tamamlandı (açıklar aşağıda)
**Lint (G1):**
- ESLint kuruldu (`npm run lint`). Başlangıç: 335 hata, 40 uyarı. Şimdi: **0 hata**, 177 uyarı.
- Uyarılar: kullanılmayan değişken 115, kanca bağımlılığı 40, diğer 22.
- Lint'in bulduğu **gerçek hatalar**:
  - `HospitalRosterApp`, `ServicesTab`, `PinningModal`: erken `return` sonrası kanca çağrısı (oturum açınca/kapatınca "Rendered more hooks" çökmesi riski). Oturumlu gövde ayrı bileşene alındı.
  - `DutyRowsEditor` çakışma yedeği: `payload` `catch` içinde tanımsızdı (C paketinde benim hatam). Yedek alınamıyordu.
  - Tanımsız `emitPlannerAiPlan` çağrısı; `finally` içinde `return`.
  - `RosterTable` eksik `</div>` (ölü dosya); `validators.js` ESM'de `module.exports`.

**Paket açıkları (G2):**
- `npm audit fix` yalnız uyumlu sürümlerle uygulandı.
- Ön yüz 17 → 3 bulgu. Sunucu 43 → 20 orta; yüksek/kritik 0 (mongoose, proxy-addr, multer, axios, body-parser …).
- Kullanılmayan `nodemailer` (yüksek) kaldırıldı; e-posta Resend API ile gidiyor.
- Kalan: `xlsx` (yüksek, düzeltmesi yok, **pakete giriyor**), `vite`/`esbuild` (ana sürüm), `exceljs` → `uuid`.

**CI (G3):** ön yüzde lint + node testleri + vitest + üretim bağımlılığı denetimi (engelleyici) + tüm paket denetimi (bilgi) + derleme; sunucuda denetim + sözdizimi + jest. Adımlar yerelde çalıştırıldı.

**Günlük hijyeni (G4):**
- `utils/safeLog.js`: e-posta, TC/telefon, `mongodb://` adresi ve Bearer jetonu maskelenir.
- Mongo çift kayıt hatasında değer değil alan adı yazılır.
- 27 rota hata kaydı ve genel hata yakalayıcı buna geçti.
- Personel pasifleştirmede ad yerine kimlik yazılır; geliştirme istek günlüğünde sorgu dizgesi yazılmaz.
- Sentry: `sendDefaultPii: false`, `beforeSend` gövde, çerez ve yetki başlığını çıkarır.
- Test: `safeLog.test.js` 3.

**Yedek / geri yükleme (G5):**
- Bulgu: eski `backup.js` `.env`'i okuyordu. Yereldeki `.env` **üretim kümesini** gösteriyor. Adres komut satırına yazılıyor, hata mesajında açığa çıkabiliyordu.
- Yeni `backup.js` + `restore-verify.js` + `backupLib.js`:
  - `.env` okunmaz; adres 0600 geçici dosyayla verilir.
  - Üretim kümesi açık izin (`BACKUP_ALLOW_PROD=1`) olmadan reddedilir.
  - Manifest: koleksiyon sayısı ve `_id` özeti.
- **Doğrulandı (yerel):** 29 koleksiyon, 63 709 belge; yedek → ayrı veritabanı → birebir aynı. Üretim adresiyle deneme reddedildi.
- **Deneme (Atlas) kümesinde doğrulanmadı:** adres yalnız Render'da (engel).

**Dizin taşıması (G5):**
- Bulgu: üretimde `autoIndex` kapalı. F'nin tekrar gönderim koruması (`clientRequestId` tekil dizini) ve E'nin geçmiş dizinleri **üretimde kendiliğinden oluşmazdı**. Koruma yalnız "önce ara" mantığıyla çalışırdı; aynı anda iki gönderimde çift kayıt olabilirdi.
- `scripts/ensureCommercialIndexes.js`: kuru çalıştırma varsayılan; yalnız oluşturur; çift kayıt kontrolü yapar.
- Boş veritabanında doğrulandı: 11 dizin oluştu, ikinci çalıştırmada 0.

**Belge:** `docs/OPERASYON.md` — kurulum, güncelleme sırası, yedek, geri yükleme, kod geri dönüşü, açık işletim konuları.

**Test:** sunucu 444, vitest 57, node 16, derleme ✅, E2E 37/37 (paket güncellemelerinden sonra).

## Commit'ler
| Commit | Paket |
|---|---|
| 80a217b | A — kurum kuralları sunucuda, kural sürümü |
| b70750d | B — aylar arası planlama |
| c94a552 | C + E — revizyon kontrolü, yayın sürümleri, işlem geçmişi |
| 49e9b62 | D — zorunlu kurallar, haftalık saat, açıklamalar |
| 812afd6 | F — izin türü kısaltması, tekrar güvenli talep |
| be58c56 | G1 — ESLint, 0 hata, kanca hataları |
| ea917d0 | G2 — paket güncellemeleri |
| 0189be7 | G3 — CI |
| 34d8b6d | G4 — günlük hijyeni |
| 0180001 | G5 — yedek/geri yükleme, dizin taşıması |

## Açık engeller
- **Deneme sitesinde izin onayı testi — bekliyor:** Render deneme sitesinin yönetici oturumu kapalı; şifre kullanıcıda. Aynı senaryo yerelde F paketinde geçti (7/7).
- **Deneme kümesinde yedek/geri yükleme — bekliyor:** Atlas deneme adresi yalnız Render ortam değişkeninde. Erişim bilgisi alınmadı (yetki kapsamı dışında).
- **Bu dal deneme sitesine yayınlanmadı:** `render.yaml` `vercel-preview-stabilizasyon` dalını izliyor. Dal gönderimi (push) ve birleştirme onay bekliyor.

## Sıradaki somut işlem
Bütünleşik doğrulama (tarayıcıda yerel arayüz) ve teslim raporu.
