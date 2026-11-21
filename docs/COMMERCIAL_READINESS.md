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

## Commit'ler
(her paketten sonra eklenir)

## Açık engeller
- **Deneme sitesinde izin onayı testi — bekliyor:** Render deneme sitesinin yönetici oturumu kapalı; şifre kullanıcıda. Aynı senaryo yerelde F paketinde test edilecek.

## Sıradaki somut işlem
C — eş zamanlı düzenleme ve tekrar koruması.
